import { BugAgent } from "../agents/bugAgent";
import { BugTriageAgent } from "../agents/bugTriageAgent";
import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { BugAnalysis, BugTriage, CommandExecutionResult, WorkflowResult } from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

function buildBugWorkflowContext(
  bugDescription: string,
  triage: BugTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  externalApiResult: unknown,
  commandResults: CommandExecutionResult[] | undefined,
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
    "",
    "Command results:",
    ...(commandResults ?? []).map(
      (result) =>
        `- ${result.command}: exitCode=${result.exitCode ?? "null"} timedOut=${result.timedOut} stdout=${result.stdout.replace(/\n/g, " ").trim()} stderr=${result.stderr.replace(/\n/g, " ").trim()}`,
    ),
  ].join("\n");
}

function buildBugCritiqueContext(bugDescription: string, workflowContext: string): string {
  return [
    "Original input:",
    bugDescription,
    "",
    "Analysis context:",
    workflowContext,
  ].join("\n");
}

function buildReplanContext(
  originalInput: string,
  completedAction: unknown,
  runtime: WorkflowRuntime,
  remainingActions: unknown[],
): string {
  const run = runtime.getRunRecord();

  return [
    "Original input:",
    originalInput,
    "",
    "Completed action:",
    JSON.stringify(completedAction),
    "",
    "Current artifacts:",
    JSON.stringify(run.artifacts),
    "",
    "Executed steps:",
    JSON.stringify(run.steps),
    "",
    "Remaining actions:",
    JSON.stringify(remainingActions),
  ].join("\n");
}

const bugWorkflowDefinition: WorkflowDefinition<BugTriage, BugAnalysis> = {
  workflowName: "BugWorkflow",
  triageAgentName: "BugTriageAgent",
  finalAgentName: "BugAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow("BugWorkflow", input, memoryContext, availableTools, delegatableAgents);
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow("BugWorkflow", context, memoryContext, availableTools, delegatableAgents);
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review("BugWorkflow", context, candidateResult, workingMemory, memoryContext);
  },
  runTriage: async (task, input) => {
    const agent = new BugTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Bug description:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new BugAgent();
    return agent.run([`Task:\n${task}`, "", context].join("\n"));
  },
  buildFinalContext: (input, runtime, triage) => {
    const codeSearchResults = runtime.getRunRecord().artifacts.codeSearchResults as
      | Record<string, CodeSearchResult[]>
      | undefined;
    const fileReadResults = runtime.getRunRecord().artifacts.fileReadResults as
      | FileReadResult[]
      | undefined;
    const externalApiResult = runtime.getRunRecord().artifacts.externalApiResult;
    const commandResults = runtime.getRunRecord().artifacts.commandResults as
      | CommandExecutionResult[]
      | undefined;
    return buildBugWorkflowContext(
      input,
      triage,
      codeSearchResults,
      fileReadResults,
      externalApiResult,
      commandResults,
    );
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildBugCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `hypotheses=${triage.hypotheses.length}`,
  summarizeResult: (result) => `possibleCauses=${result.possibleCauses.length}`,
};

export async function runBugWorkflow(bugDescription: string): Promise<WorkflowResult<BugAnalysis>> {
  const execution = startAgentExecution("BugWorkflow", bugDescription);
  const runtime = new WorkflowRuntime({
    workflowName: "BugWorkflow",
    input: bugDescription,
  });

  try {
    const result = await runtime.runActionQueue(bugWorkflowDefinition, bugDescription);
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
