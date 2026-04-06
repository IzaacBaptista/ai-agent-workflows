import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { PRAgent } from "../agents/prAgent";
import { PRTriageAgent } from "../agents/prTriageAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  GitDiffResult,
  GitStatusResult,
  PRReview,
  PRTriage,
  RuntimeAction,
  WorkflowValidationError,
  WorkflowResult,
} from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
import {
  summarizeCodeSearchResults,
  summarizeCompletedAction,
  summarizeCommandResults,
  summarizeEvidenceOverview,
  summarizeFileReadResults,
  summarizeGitDiffResult,
  summarizeGitStatusResult,
  summarizePatchResults,
  summarizeRecentSteps,
  summarizeRemainingActions,
  summarizeRuntimeBudget,
  summarizeStringList,
  summarizeValidationErrors,
} from "./contextSummary";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { buildLlmPreflightFailure } from "./workflowPreflight";

function buildPRWorkflowContext(
  diff: string,
  triage: PRTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  patchResults: AppliedCodePatchResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
  gitStatusResult: GitStatusResult | undefined,
  gitDiffResult: GitDiffResult | undefined,
): string {
  return [
    "Pull request input:",
    diff,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    ...summarizeStringList("Review focus:", triage?.reviewFocus),
    "",
    ...summarizeStringList("Regression checks:", triage?.regressionChecks),
    "",
    ...summarizeCodeSearchResults(codeSearchResults),
    "",
    ...summarizeFileReadResults(fileReadResults),
    "",
    ...summarizePatchResults(patchResults),
    "",
    ...summarizeCommandResults(commandResults),
    "",
    ...summarizeGitStatusResult(gitStatusResult),
    "",
    ...summarizeGitDiffResult(gitDiffResult),
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
  remainingActions: RuntimeAction[],
): string {
  const run = runtime.getRunRecord();
  const meta = runtime.getMeta();
  const validationErrors = run.artifacts.validationErrors as
    | WorkflowValidationError[]
    | undefined;

  return [
    "Original input:",
    originalInput,
    "",
    ...summarizeCompletedAction(completedAction),
    "",
    ...summarizeRuntimeBudget(run, meta),
    "",
    ...summarizeEvidenceOverview(run),
    "",
    ...summarizeRecentSteps(run.steps),
    "",
    ...summarizeValidationErrors(validationErrors),
    "",
    ...summarizeRemainingActions(remainingActions),
    "",
    "Guidance:",
    "- If build/test evidence already supports a bounded review, prefer finalize over additional repository inspection when budget pressure rises.",
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
    const patchResults = runtime.getRunRecord().artifacts.patchResults as
      | AppliedCodePatchResult[]
      | undefined;
    const commandResults = runtime.getRunRecord().artifacts.commandResults as
      | CommandExecutionResult[]
      | undefined;
    const gitStatusResult = runtime.getRunRecord().artifacts.gitStatusResult as
      | GitStatusResult
      | undefined;
    const gitDiffResult = runtime.getRunRecord().artifacts.gitDiffResult as
      | GitDiffResult
      | undefined;
    return buildPRWorkflowContext(
      input,
      triage,
      codeSearchResults,
      fileReadResults,
      patchResults,
      commandResults,
      gitStatusResult,
      gitDiffResult,
    );
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildPRCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `reviewFocus=${triage.reviewFocus.length}`,
  summarizeResult: (result) => `impacts=${result.impacts.length}`,
};

export async function runPRReviewWorkflow(diff: string): Promise<WorkflowResult<PRReview>> {
  const preflightFailure = buildLlmPreflightFailure<PRReview>("PRReviewWorkflow", diff);
  if (preflightFailure) {
    return preflightFailure;
  }

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
