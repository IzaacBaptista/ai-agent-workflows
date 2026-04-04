import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { PRAgent } from "../agents/prAgent";
import { PRTriageAgent } from "../agents/prTriageAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { PRReview, PRTriage, WorkflowResult } from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
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

function buildPRCritiqueContext(diff: string, workflowContext: string): string {
  return [
    "Original input:",
    diff,
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

const prWorkflowDefinition: WorkflowDefinition<PRTriage, PRReview> = {
  workflowName: "PRReviewWorkflow",
  triageAgentName: "PRTriageAgent",
  finalAgentName: "PRAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow("PRReviewWorkflow", input, memoryContext, availableTools, delegatableAgents);
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow("PRReviewWorkflow", context, memoryContext, availableTools, delegatableAgents);
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review("PRReviewWorkflow", context, candidateResult, workingMemory, memoryContext);
  },
  runTriage: async (task, input) => {
    const agent = new PRTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Code changes:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new PRAgent();
    return agent.run([`Task:\n${task}`, "", context].join("\n"));
  },
  buildFinalContext: (input, runtime, triage) => {
    const codeSearchResults = runtime.getRunRecord().artifacts.codeSearchResults as
      | Record<string, CodeSearchResult[]>
      | undefined;
    const fileReadResults = runtime.getRunRecord().artifacts.fileReadResults as
      | FileReadResult[]
      | undefined;
    return buildPRWorkflowContext(input, triage, codeSearchResults, fileReadResults);
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildPRCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `reviewFocus=${triage.reviewFocus.length}`,
  summarizeResult: (result) => `impacts=${result.impacts.length}`,
};

export async function runPRReviewWorkflow(diff: string): Promise<WorkflowResult<PRReview>> {
  const execution = startAgentExecution("PRReviewWorkflow", diff);
  const runtime = new WorkflowRuntime({
    workflowName: "PRReviewWorkflow",
    input: diff,
  });

  try {
    const result = await runtime.runActionQueue(prWorkflowDefinition, diff);
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
