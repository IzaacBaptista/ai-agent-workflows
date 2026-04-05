import { BugTriageAgent } from "../agents/bugTriageAgent";
import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { RepoInvestigateAgent } from "../agents/repoInvestigateAgent";
import {
  AppliedCodePatchResult,
  BugTriage,
  CommandExecutionResult,
  GitLogResult,
  RepoInvestigationResult,
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
  summarizeGitLogResult,
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

function buildRepoInvestigateWorkflowContext(
  query: string,
  triage: BugTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  patchResults: AppliedCodePatchResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
  gitLogResult: GitLogResult | undefined,
): string {
  return [
    `Investigation query: ${query}`,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    ...summarizeStringList("Initial hypotheses:", triage?.hypotheses),
    "",
    ...summarizeCodeSearchResults(codeSearchResults),
    "",
    ...summarizeFileReadResults(fileReadResults),
    "",
    ...summarizePatchResults(patchResults),
    "",
    ...summarizeCommandResults(commandResults),
    "",
    ...summarizeGitLogResult(gitLogResult),
  ].join("\n");
}

function buildRepoInvestigateCritiqueContext(query: string, workflowContext: string): string {
  return [
    "Original investigation query:",
    query,
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
    "Original investigation query:",
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
    "- Prefer git_log to understand recent changes in relevant files before running code search.",
    "- If repository evidence is already sufficient, prefer finalize over more search_code/read_file steps.",
  ].join("\n");
}

const repoInvestigateWorkflowDefinition: WorkflowDefinition<BugTriage, RepoInvestigationResult> = {
  workflowName: "RepoInvestigateWorkflow",
  triageAgentName: "BugTriageAgent",
  finalAgentName: "RepoInvestigateAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow(
      "RepoInvestigateWorkflow",
      input,
      memoryContext,
      availableTools,
      delegatableAgents,
    );
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow(
      "RepoInvestigateWorkflow",
      context,
      memoryContext,
      availableTools,
      delegatableAgents,
    );
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review(
      "RepoInvestigateWorkflow",
      context,
      candidateResult,
      workingMemory,
      memoryContext,
    );
  },
  runTriage: async (task, input) => {
    const agent = new BugTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Investigation query:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new RepoInvestigateAgent();
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
    const gitLogResult = runtime.getRunRecord().artifacts.gitLogResult as
      | GitLogResult
      | undefined;
    return buildRepoInvestigateWorkflowContext(
      input,
      triage,
      codeSearchResults,
      fileReadResults,
      patchResults,
      commandResults,
      gitLogResult,
    );
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildRepoInvestigateCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `hypotheses=${triage.hypotheses.length}`,
  summarizeResult: (result) => `relevantFiles=${result.relevantFiles.length}`,
};

export async function runRepoInvestigateWorkflow(
  query: string,
): Promise<WorkflowResult<RepoInvestigationResult>> {
  const execution = startAgentExecution("RepoInvestigateWorkflow", query);
  const runtime = new WorkflowRuntime({
    workflowName: "RepoInvestigateWorkflow",
    input: query,
  });

  try {
    const result = await runtime.runActionQueue(repoInvestigateWorkflowDefinition, query);
    runtime.complete();
    logAgentExecutionSuccess(execution, query, result);
    return { success: true, data: result, meta: runtime.getMeta() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, query, error);
    console.error("[RepoInvestigateWorkflow] Failed:", message);
    return { success: false, error: message, meta: runtime.getMeta() };
  }
}
