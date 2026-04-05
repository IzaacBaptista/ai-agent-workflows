import { CriticAgent } from "../agents/criticAgent";
import { IssueAgent } from "../agents/issueAgent";
import { IssueTriageAgent } from "../agents/issueTriageAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  IssueAnalysis,
  IssueTriage,
  WorkflowResult,
} from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
import {
  summarizeCodeSearchResults,
  summarizeCommandResults,
  summarizeFileReadResults,
  summarizePatchResults,
  summarizeStringList,
} from "./contextSummary";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

function buildIssueWorkflowContext(
  issue: string,
  triage: IssueTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  patchResults: AppliedCodePatchResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
): string {
  return [
    "Issue input:",
    issue,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    ...summarizeStringList("Investigation areas:", triage?.investigationAreas),
    "",
    ...summarizeStringList("Validation checks:", triage?.validationChecks),
    "",
    ...summarizeCodeSearchResults(codeSearchResults),
    "",
    ...summarizeFileReadResults(fileReadResults),
    "",
    ...summarizePatchResults(patchResults),
    "",
    ...summarizeCommandResults(commandResults),
  ].join("\n");
}

function buildIssueCritiqueContext(issue: string, workflowContext: string): string {
  return [
    "Original input:",
    issue,
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
    "Working artifacts:",
    JSON.stringify(run.artifacts),
    "",
    "Executed steps:",
    JSON.stringify(run.steps),
    "",
    "Remaining actions:",
    JSON.stringify(remainingActions),
  ].join("\n");
}

const REPO_LOCAL_PHRASES = [
  "this repo",
  "this repository",
  "this codebase",
  "this project",
  "repo-local",
  "repository-local",
];
const REPO_LOCAL_IDENTIFIERS = [
  "WorkflowRuntime",
  "PlannerAgent",
  "ReplannerAgent",
  "CriticAgent",
  "IssueWorkflow",
  "BugWorkflow",
  "PRReviewWorkflow",
];

function isClearlyRepoLocalIssue(issue: string): boolean {
  const normalized = issue.toLowerCase();

  if (REPO_LOCAL_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  if (/\bsrc\//i.test(issue) || /\bpackage\.json\b/i.test(issue) || /\breadme\b/i.test(issue)) {
    return true;
  }

  if (/\b[a-z0-9_./-]+\.(?:ts|js|md|json)\b/i.test(issue)) {
    return true;
  }

  return REPO_LOCAL_IDENTIFIERS.some((identifier) => normalized.includes(identifier.toLowerCase()));
}

function hasSuccessfulIssueCodeEvidence(runtime: WorkflowRuntime): boolean {
  const toolCalls = runtime.getRunRecord().artifacts.toolCalls as
    | Array<{ toolName: string; result?: unknown }>
    | undefined;

  return (toolCalls ?? []).some(
    (record) =>
      (record.toolName === "search_code" || record.toolName === "read_file") && record.result != null,
  );
}

function extractIssueSearchTerms(issue: string): string[] {
  const identifierTerms = REPO_LOCAL_IDENTIFIERS.filter((identifier) =>
    issue.toLowerCase().includes(identifier.toLowerCase()),
  );
  const fileTerms = Array.from(
    new Set(
      Array.from(
        issue.matchAll(/\b(?:src\/[A-Za-z0-9_./-]+|package\.json|README|[A-Za-z0-9_-]+\.(?:ts|js|md|json))\b/g),
      ).map((match) => match[0]),
    ),
  );
  const genericTerms = Array.from(
    new Set(
      Array.from(issue.matchAll(/\b[A-Za-z][A-Za-z0-9_]{4,}\b/g))
        .map((match) => match[0])
        .filter((term) => !REPO_LOCAL_PHRASES.includes(term.toLowerCase())),
    ),
  );

  return [...identifierTerms, ...fileTerms, ...genericTerms].slice(0, 3);
}

const issueWorkflowDefinition: WorkflowDefinition<IssueTriage, IssueAnalysis> = {
  workflowName: "IssueWorkflow",
  triageAgentName: "IssueTriageAgent",
  finalAgentName: "IssueAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow("IssueWorkflow", input, memoryContext, availableTools, delegatableAgents);
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow("IssueWorkflow", context, memoryContext, availableTools, delegatableAgents);
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review("IssueWorkflow", context, candidateResult, workingMemory, memoryContext);
  },
  runTriage: async (task, input) => {
    const agent = new IssueTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Issue:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new IssueAgent();
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
    return buildIssueWorkflowContext(
      input,
      triage,
      codeSearchResults,
      fileReadResults,
      patchResults,
      commandResults,
    );
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildIssueCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  beforeFinalize: (input, runtime, state, action) => {
    if (typeof runtime.getRunRecord().artifacts.forcedFinalAnalysisReason === "string") {
      return null;
    }

    if (!isClearlyRepoLocalIssue(input) || hasSuccessfulIssueCodeEvidence(runtime)) {
      return null;
    }

    const searchTerms =
      state.triage?.codeSearchTerms?.slice(0, 3).filter((term) => term.trim().length > 0) ??
      [];
    const recoveryTerms = searchTerms.length > 0 ? searchTerms : extractIssueSearchTerms(input);

    return {
      reason: "Repo-local issues require at least one code-inspection step before finalization.",
      recoveryActions: [
        {
          type: "tool_call",
          toolName: "search_code",
          input: { terms: recoveryTerms.length > 0 ? recoveryTerms : ["WorkflowRuntime"] },
          reason: "Need at least one repository code-inspection step before finalizing a repo-local issue",
        },
        action,
      ],
    };
  },
  summarizeTriage: (triage) => `investigationAreas=${triage.investigationAreas.length}`,
  summarizeResult: (result) => `questions=${result.questions.length}`,
};

export async function runIssueWorkflow(issue: string): Promise<WorkflowResult<IssueAnalysis>> {
  const execution = startAgentExecution("IssueWorkflow", issue);
  const runtime = new WorkflowRuntime({
    workflowName: "IssueWorkflow",
    input: issue,
  });

  try {
    const result = await runtime.runActionQueue(issueWorkflowDefinition, issue);
    runtime.complete();
    logAgentExecutionSuccess(execution, issue, result);
    return { success: true, data: result, meta: runtime.getMeta() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, issue, error);
    console.error("[IssueWorkflow] Failed:", message);
    return { success: false, error: message, meta: runtime.getMeta() };
  }
}
