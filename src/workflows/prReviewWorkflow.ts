import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { PRAgent } from "../agents/prAgent";
import { PRTriageAgent } from "../agents/prTriageAgent";
import {
  PRReview,
  PRTriage,
  WorkflowCritique,
  WorkflowPlan,
  WorkflowPlanStep,
  WorkflowReplan,
  WorkflowResult,
  WorkflowToolResult,
} from "../core/types";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
import { executeWorkflowTool } from "../tools/toolExecutor";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

function buildPRWorkflowContext(
  diff: string,
  triage: PRTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
): string {
  return [
    "Pull request input:",
    diff,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    "Review focus:",
    ...(triage?.reviewFocus ?? []).map((item) => `- ${item}`),
    "",
    "Regression checks:",
    ...(triage?.regressionChecks ?? []).map((item) => `- ${item}`),
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
  ].join("\n");
}

function buildPRCritiqueContext(
  diff: string,
  workflowContext: string,
): string {
  return [
    "Original input:",
    diff,
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

export async function runPRReviewWorkflow(diff: string): Promise<WorkflowResult<PRReview>> {
  const execution = startAgentExecution("PRReviewWorkflow", diff);
  const runtime = new WorkflowRuntime({
    workflowName: "PRReviewWorkflow",
    input: diff,
  });

  try {
    const plan = ensureValidPlan(await runtime.executeStep(
      "plan",
      async () => {
        const plannerAgent = new PlannerAgent();
        return plannerAgent.runForWorkflow("PRReviewWorkflow", diff);
      },
      {
        agentName: "PlannerAgent",
        inputSummary: diff,
        outputSummary: (value) => `steps=${(value as WorkflowPlan).steps.map((step) => step.action).join(",")}`,
      },
    ));

    runtime.savePlan(plan);

    let triage: PRTriage | undefined;
    let workflowContext = diff;
    let result: PRReview | undefined;
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
            const triageAgent = new PRTriageAgent();
            return triageAgent.run(diff);
          },
          {
            agentName: "PRTriageAgent",
            inputSummary: plannedStep.purpose,
            outputSummary: (value) => `reviewFocus=${(value as PRTriage).reviewFocus.length}`,
          },
        );

        runtime.saveArtifact("triage", triage);
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "PRReviewWorkflow",
                buildReplanContext("PRReviewWorkflow", diff, plannedStep.action, runtime, remainingSteps),
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
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "PRReviewWorkflow",
                buildReplanContext("PRReviewWorkflow", diff, plannedStep.action, runtime, remainingSteps),
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
        if (remainingSteps.length > 0) {
          const replan = await runtime.executeStep(
            "replan",
            async () => {
              const replanner = new ReplannerAgent();
              return replanner.runForWorkflow(
                "PRReviewWorkflow",
                buildReplanContext("PRReviewWorkflow", diff, plannedStep.action, runtime, remainingSteps),
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
        const toolResult = await runtime.executeStep(
          "call_external_api",
          async () => executeWorkflowTool({ tool: "call_external_api", endpoint: "pr-regression-check" }),
          {
            inputSummary: plannedStep.purpose,
            outputSummary: (value) => (value as WorkflowToolResult).summary,
          },
        );

        runtime.saveArtifact("externalApiResult", toolResult.data);
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
          workflowContext = buildPRWorkflowContext(diff, triage, codeSearchResults, fileReadResults);
          runtime.saveArtifact("context", workflowContext);
          const agent = new PRAgent();
          return agent.run(workflowContext);
        },
        {
          agentName: "PRAgent",
          inputSummary: plannedStep.purpose,
          outputSummary: (value) => `impacts=${(value as PRReview).impacts.length}`,
        },
      );

      const critique = await runtime.executeStep(
        "critique",
        async () => {
          const critic = new CriticAgent();
          return critic.review("PRReviewWorkflow", buildPRCritiqueContext(diff, workflowContext), result);
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
    logAgentExecutionSuccess(execution, diff, result);
    return { success: true, data: result, meta: runtime.getMeta() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, diff, error);
    console.error("[PRReviewWorkflow] Failed:", message);
    return { success: false, error: message, meta: runtime.getMeta() };
  }
}
