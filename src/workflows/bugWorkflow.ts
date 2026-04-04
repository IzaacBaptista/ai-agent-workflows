import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { BugAgent } from "../agents/bugAgent";
import { BugTriageAgent } from "../agents/bugTriageAgent";
import {
  BugAnalysis,
  BugTriage,
  WorkflowCritique,
  WorkflowPlan,
  WorkflowPlanStep,
  WorkflowReplan,
  WorkflowResult,
  WorkflowToolResult,
} from "../core/types";
import { WorkflowRuntime } from "../core/workflowRuntime";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
import { executeWorkflowTool } from "../tools/toolExecutor";

function buildBugWorkflowContext(
  bugDescription: string,
  triage: BugTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  externalApiResult: unknown,
): string {
  return [
    `Bug description: ${bugDescription}`,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    "Initial hypotheses:",
    ...(triage?.hypotheses ?? []).map((item) => `- ${item}`),
    "",
    "Suggested API checks:",
    ...(triage?.apiChecks ?? []).map((item) => `- ${item}`),
    "",
    "Code search results:",
    ...Object.entries(codeSearchResults ?? {}).flatMap(([term, matches]) => {
      if (matches.length === 0) {
        return [`- ${term}: no matches found`];
      }

      return [
        `- ${term}:`,
        ...matches.map(
          (match) => `  - ${match.file}:${match.line} ${match.snippet.replace(/\n/g, " ").trim()}`,
        ),
      ];
    }),
    "",
    "Read file results:",
    ...(fileReadResults ?? []).map((file) => `- ${file.file}: ${file.content.replace(/\n/g, " ").trim()}`),
    "",
    "External API result:",
    externalApiResult ? JSON.stringify(externalApiResult) : "No external API result",
  ].join("\n");
}

function buildBugCritiqueContext(
  bugDescription: string,
  workflowContext: string,
): string {
  return [
    "Original input:",
    bugDescription,
    "",
    "Analysis context:",
    workflowContext,
  ].join("\n");
}

function ensureValidPlan(plan: WorkflowPlan): WorkflowPlan {
  const finalStep = plan.steps[plan.steps.length - 1];

  if (!finalStep || finalStep.action !== "final_analysis") {
    throw new Error('Workflow plan must end with "final_analysis"');
  }

  return plan;
}

function ensureValidRemainingSteps(steps: WorkflowPlanStep[]): WorkflowPlanStep[] {
  const finalStep = steps[steps.length - 1];

  if (!finalStep || finalStep.action !== "final_analysis") {
    throw new Error('Workflow plan must end with "final_analysis"');
  }

  return steps;
}

function buildReplanContext(
  workflowName: string,
  originalInput: string,
  completedAction: string,
  runtime: WorkflowRuntime,
  remainingSteps: WorkflowPlanStep[],
): string {
  const run = runtime.getRunRecord();

  return [
    `Workflow: ${workflowName}`,
    "Original input:",
    originalInput,
    "",
    `Completed action: ${completedAction}`,
    "Current artifacts:",
    JSON.stringify(run.artifacts),
    "",
    "Executed steps:",
    JSON.stringify(run.steps),
    "",
    "Current remaining actions:",
    JSON.stringify(remainingSteps),
  ].join("\n");
}

function fallbackToFinalAnalysis(runtime: WorkflowRuntime, reason: string): WorkflowPlanStep[] {
  runtime.forceFinalAnalysis(reason);
  return [
    {
      action: "final_analysis",
      purpose: `Fallback to final analysis: ${reason}`,
    },
  ];
}

export async function runBugWorkflow(bugDescription: string): Promise<WorkflowResult<BugAnalysis>> {
  const execution = startAgentExecution("BugWorkflow", bugDescription);
  const runtime = new WorkflowRuntime({
    workflowName: "BugWorkflow",
    input: bugDescription,
  });

  try {
    const plan = ensureValidPlan(await runtime.executeStep(
      "plan",
      async () => {
        const plannerAgent = new PlannerAgent();
        return plannerAgent.runForWorkflow("BugWorkflow", bugDescription);
      },
      {
        agentName: "PlannerAgent",
        inputSummary: bugDescription,
        outputSummary: (value) => `steps=${(value as WorkflowPlan).steps.map((step) => step.action).join(",")}`,
      },
    ));

    runtime.savePlan(plan);

    let triage: BugTriage | undefined;
    let workflowContext = bugDescription;
    let result: BugAnalysis | undefined;
    let critiqueRevisionCount = 0;
    let remainingSteps = [...plan.steps];

    while (remainingSteps.length > 0) {
      const plannedStep = remainingSteps.shift();
      if (!plannedStep) {
        break;
      }

      if (plannedStep.action === "triage") {
        triage = await runtime.executeStep(
          "triage",
          async () => {
            const triageAgent = new BugTriageAgent();
            return triageAgent.run(bugDescription);
          },
          {
            agentName: "BugTriageAgent",
            inputSummary: plannedStep.purpose,
            outputSummary: (value) => `hypotheses=${(value as BugTriage).hypotheses.length}`,
          },
        );

        runtime.saveArtifact("triage", triage);
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "BugWorkflow",
                buildReplanContext("BugWorkflow", bugDescription, plannedStep.action, runtime, remainingSteps),
              );
            },
            {
              agentName: "ReplannerAgent",
              inputSummary: plannedStep.purpose,
              outputSummary: (value) => `steps=${(value as WorkflowReplan).steps.map((step) => step.action).join(",")}`,
            },
          );

          runtime.saveReplan(replan);
          remainingSteps = ensureValidRemainingSteps(replan.steps);
        }
        continue;
      }

      if (plannedStep.action === "search_code") {
        if (!triage) {
          throw new Error('Cannot execute "search_code" before "triage"');
        }
        const currentTriage = triage;

        const toolResult = await runtime.executeStep(
          "search_code",
          async () => executeWorkflowTool({ tool: "search_code", terms: currentTriage.codeSearchTerms }),
          {
            inputSummary: plannedStep.purpose,
            outputSummary: (value) => (value as WorkflowToolResult).summary,
          },
        );

        runtime.saveArtifact("codeSearchResults", toolResult.data);
        const searchSignature = currentTriage.codeSearchTerms.map((term) => term.trim().toLowerCase()).sort().join("|");
        const searchMatches = Object.values(
          toolResult.data as Record<string, CodeSearchResult[]>,
        ).reduce((count, matches) => count + matches.length, 0);
        runtime.recordProgress("search_code", searchSignature, searchMatches > 0);
        if (runtime.shouldForceFinalAnalysis()) {
          remainingSteps = fallbackToFinalAnalysis(
            runtime,
            "Repeated search_code steps produced no new matches",
          );
          continue;
        }
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "BugWorkflow",
                buildReplanContext("BugWorkflow", bugDescription, plannedStep.action, runtime, remainingSteps),
              );
            },
            {
              agentName: "ReplannerAgent",
              inputSummary: plannedStep.purpose,
              outputSummary: (value) => `steps=${(value as WorkflowReplan).steps.map((step) => step.action).join(",")}`,
            },
          );

          runtime.saveReplan(replan);
          remainingSteps = ensureValidRemainingSteps(replan.steps);
        }
        continue;
      }

      if (plannedStep.action === "read_file") {
        const codeSearchResults = runtime.getRunRecord().artifacts.codeSearchResults as
          | Record<string, CodeSearchResult[]>
          | undefined;

        if (!codeSearchResults) {
          throw new Error('Cannot execute "read_file" before "search_code"');
        }

        const files = Object.values(codeSearchResults)
          .flat()
          .map((entry) => entry.file)
          .slice(0, 3);

        const toolResult = await runtime.executeStep(
          "read_file",
          async () => executeWorkflowTool({ tool: "read_file", files }),
          {
            inputSummary: plannedStep.purpose,
            outputSummary: (value) => (value as WorkflowToolResult).summary,
          },
        );

        runtime.saveArtifact("fileReadResults", toolResult.data);
        const readSignature = files.slice().sort().join("|");
        const readFilesCount = (toolResult.data as FileReadResult[]).length;
        runtime.recordProgress("read_file", readSignature, readFilesCount > 0);
        if (runtime.shouldForceFinalAnalysis()) {
          remainingSteps = fallbackToFinalAnalysis(
            runtime,
            "Repeated read_file steps inspected the same files without progress",
          );
          continue;
        }
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "BugWorkflow",
                buildReplanContext("BugWorkflow", bugDescription, plannedStep.action, runtime, remainingSteps),
              );
            },
            {
              agentName: "ReplannerAgent",
              inputSummary: plannedStep.purpose,
              outputSummary: (value) => `steps=${(value as WorkflowReplan).steps.map((step) => step.action).join(",")}`,
            },
          );

          runtime.saveReplan(replan);
          remainingSteps = ensureValidRemainingSteps(replan.steps);
        }
        continue;
      }

      if (plannedStep.action === "call_external_api") {
        const endpoint = triage?.apiChecks[0] ?? "bug-investigation";
        const toolResult = await runtime.executeStep(
          "call_external_api",
          async () => executeWorkflowTool({ tool: "call_external_api", endpoint }),
          {
            inputSummary: plannedStep.purpose,
            outputSummary: (value) => (value as WorkflowToolResult).summary,
          },
        );

        runtime.saveArtifact("externalApiResult", toolResult.data);
        runtime.recordProgress("call_external_api", endpoint, true);
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "BugWorkflow",
                buildReplanContext("BugWorkflow", bugDescription, plannedStep.action, runtime, remainingSteps),
              );
            },
            {
              agentName: "ReplannerAgent",
              inputSummary: plannedStep.purpose,
              outputSummary: (value) => `steps=${(value as WorkflowReplan).steps.map((step) => step.action).join(",")}`,
            },
          );

          runtime.saveReplan(replan);
          remainingSteps = ensureValidRemainingSteps(replan.steps);
        }
        continue;
      }

      result = await runtime.executeStep(
        "final_analysis",
        async () => {
          const codeSearchResults = runtime.getRunRecord().artifacts.codeSearchResults as
            | Record<string, CodeSearchResult[]>
            | undefined;
          const fileReadResults = runtime.getRunRecord().artifacts.fileReadResults as
            | FileReadResult[]
            | undefined;
          const externalApiResult = runtime.getRunRecord().artifacts.externalApiResult;
          workflowContext = buildBugWorkflowContext(
            bugDescription,
            triage,
            codeSearchResults,
            fileReadResults,
            externalApiResult,
          );
          runtime.saveArtifact("context", workflowContext);
          const agent = new BugAgent();
          return agent.run(workflowContext);
        },
        {
          agentName: "BugAgent",
          inputSummary: plannedStep.purpose,
          outputSummary: (value) => `possibleCauses=${(value as BugAnalysis).possibleCauses.length}`,
        },
      );

      const critique = await runtime.executeStep(
        "critique",
        async () => {
          const critic = new CriticAgent();
          return critic.review("BugWorkflow", buildBugCritiqueContext(bugDescription, workflowContext), result);
        },
        {
          agentName: "CriticAgent",
          inputSummary: plannedStep.purpose,
          outputSummary: (value) => `approved=${(value as WorkflowCritique).approved}`,
        },
      );

      runtime.saveCritique(critique);

      if (!critique.approved && critiqueRevisionCount < 1) {
        critiqueRevisionCount += 1;
        result = undefined;
        remainingSteps = ensureValidRemainingSteps(
          critique.recommendedActions.length > 0
            ? critique.recommendedActions.map((action) => ({
                action,
                purpose: `Critic follow-up: ${critique.summary}`,
              }))
            : [
                {
                  action: "final_analysis",
                  purpose: `Critic retry: ${critique.summary}`,
                },
              ],
        );
      }
    }

    if (!result) {
      throw new Error('Workflow plan did not produce a "final_analysis" result');
    }

    runtime.saveArtifact("result", result);
    runtime.complete();
    logAgentExecutionSuccess(execution, bugDescription, result);
    return { success: true, data: result, meta: runtime.getMeta() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, bugDescription, error);
    console.error("[BugWorkflow] Failed:", message);
    return { success: false, error: message, meta: runtime.getMeta() };
  }
}
