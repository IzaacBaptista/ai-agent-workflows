import { BugAgent } from "../agents/bugAgent";
import { BugTriageAgent } from "../agents/bugTriageAgent";
import { CriticAgent } from "../agents/criticAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import {
  AppliedCodePatchResult,
  BugAnalysis,
  BugTriage,
  CommandExecutionResult,
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
  summarizePatchResults,
  summarizeRecentSteps,
  summarizeRemainingActions,
  summarizeRuntimeBudget,
  summarizeStringList,
  summarizeUnknownValue,
  summarizeValidationErrors,
} from "./contextSummary";
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
  patchResults: AppliedCodePatchResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
): string {
  return [
    `Bug description: ${bugDescription}`,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    ...summarizeStringList("Initial hypotheses:", triage?.hypotheses),
    "",
    ...summarizeStringList("Suggested API checks:", triage?.apiChecks),
    "",
    ...summarizeCodeSearchResults(codeSearchResults),
    "",
    ...summarizeFileReadResults(fileReadResults),
    "",
    ...summarizeUnknownValue("External API result:", externalApiResult, "No external API result"),
    "",
    ...summarizePatchResults(patchResults),
    "",
    ...summarizeCommandResults(commandResults),
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
    "- If timeout/hang evidence is already localized and executable proof is on hand, prefer finalize or edit_patch over more search_code/read_file steps.",
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
    const patchResults = runtime.getRunRecord().artifacts.patchResults as
      | AppliedCodePatchResult[]
      | undefined;
    const commandResults = runtime.getRunRecord().artifacts.commandResults as
      | CommandExecutionResult[]
      | undefined;
    return buildBugWorkflowContext(
      input,
      triage,
      codeSearchResults,
      fileReadResults,
      externalApiResult,
      patchResults,
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
