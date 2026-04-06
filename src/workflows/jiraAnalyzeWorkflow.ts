import { CriticAgent } from "../agents/criticAgent";
import { IssueTriageAgent } from "../agents/issueTriageAgent";
import { JiraAnalyzeAgent } from "../agents/jiraAnalyzeAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { env } from "../config/env";
import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  IssueTriage,
  JiraAnalysis,
  RuntimeAction,
  WorkflowValidationError,
  WorkflowResult,
} from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { fetchJiraIssue } from "../integrations/jira/fetchJiraIssue";
import { formatJiraIssue } from "../integrations/jira/formatJiraIssue";
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
  summarizeValidationErrors,
} from "./contextSummary";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { buildLlmPreflightFailure } from "./workflowPreflight";
import { collectTriageContext } from "./contextCollector";

export interface JiraAnalyzeOptions {
  agentic?: boolean;
}

function buildJiraAnalyzeWorkflowContext(
  input: string,
  triage: IssueTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  patchResults: AppliedCodePatchResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
): string {
  return [
    "Jira issue context:",
    input,
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

function buildJiraAnalyzeCritiqueContext(input: string, workflowContext: string): string {
  return [
    "Original Jira issue:",
    input,
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
    "Original Jira issue:",
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
    "- If repository evidence is already sufficient and budget pressure is medium or high, prefer finalize over more search_code/read_file steps.",
  ].join("\n");
}

const jiraAnalyzeWorkflowDefinition: WorkflowDefinition<IssueTriage, JiraAnalysis> = {
  workflowName: "JiraAnalyzeWorkflow",
  triageAgentName: "IssueTriageAgent",
  finalAgentName: "JiraAnalyzeAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow(
      "JiraAnalyzeWorkflow",
      input,
      memoryContext,
      availableTools,
      delegatableAgents,
    );
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow(
      "JiraAnalyzeWorkflow",
      context,
      memoryContext,
      availableTools,
      delegatableAgents,
    );
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review(
      "JiraAnalyzeWorkflow",
      context,
      candidateResult,
      workingMemory,
      memoryContext,
    );
  },
  runTriage: async (task, input) => {
    const agent = new IssueTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Jira issue:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new JiraAnalyzeAgent();
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
    return buildJiraAnalyzeWorkflowContext(
      input,
      triage,
      codeSearchResults,
      fileReadResults,
      patchResults,
      commandResults,
    );
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildJiraAnalyzeCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `investigationAreas=${triage.investigationAreas.length}`,
  summarizeResult: (result) => `implementationPlan=${result.implementationPlan.length}`,
};

const JIRA_ANALYZE_TASK =
  "Analyze the Jira issue and produce a detailed implementation plan with suggested branch and PR title";

export async function runJiraAnalyzeWorkflow(
  issueKey: string,
  options: JiraAnalyzeOptions = {},
): Promise<WorkflowResult<JiraAnalysis>> {
  const preflightFailure = buildLlmPreflightFailure<JiraAnalysis>(
    "JiraAnalyzeWorkflow",
    `Jira issue key: ${issueKey}`,
    { jiraIssueKey: issueKey },
  );
  if (preflightFailure) {
    return preflightFailure;
  }

  const issue = await fetchJiraIssue(issueKey, {
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
  });

  const input = formatJiraIssue(issue);

  const execution = startAgentExecution("JiraAnalyzeWorkflow", input);
  const runtime = new WorkflowRuntime({
    workflowName: "JiraAnalyzeWorkflow",
    input,
  });

  try {
    let result: JiraAnalysis;

    if (options.agentic) {
      result = await runtime.runActionQueue(jiraAnalyzeWorkflowDefinition, input);
    } else {
      result = await runtime.runSimple(
        jiraAnalyzeWorkflowDefinition,
        input,
        JIRA_ANALYZE_TASK,
        async (triage, rt) => {
          const context = await collectTriageContext(triage);
          rt.saveArtifact("codeSearchResults", context.codeSearchResults);
          rt.saveArtifact("fileReadResults", context.fileReadResults);
          rt.saveArtifact("gitStatusResult", context.gitStatus);
          rt.saveArtifact("gitLogResult", context.gitLog);
        },
      );
    }

    runtime.complete();
    logAgentExecutionSuccess(execution, input, result);
    return {
      success: true,
      data: result,
      meta: { ...runtime.getMeta(), jiraIssueKey: issueKey },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, input, error);
    console.error("[JiraAnalyzeWorkflow] Failed:", message);
    return {
      success: false,
      error: message,
      meta: { ...runtime.getMeta(), jiraIssueKey: issueKey },
    };
  }
}
