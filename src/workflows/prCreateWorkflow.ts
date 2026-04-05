import { CriticAgent } from "../agents/criticAgent";
import { PRCreateAgent } from "../agents/prCreateAgent";
import { PRTriageAgent } from "../agents/prTriageAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { env } from "../config/env";
import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  GitDiffResult,
  GitStatusResult,
  PRCreatePlan,
  PRCreateResult,
  PRTriage,
  RuntimeAction,
  WorkflowValidationError,
  WorkflowResult,
} from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { createPR } from "../integrations/github/createPR";
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
import { runJiraAnalyzeWorkflow } from "./jiraAnalyzeWorkflow";

function buildPRCreateWorkflowContext(
  input: string,
  triage: PRTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  patchResults: AppliedCodePatchResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
  gitStatusResult: GitStatusResult | undefined,
  gitDiffResult: GitDiffResult | undefined,
): string {
  return [
    "PR creation context (from Jira analysis):",
    input,
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

function buildPRCreateCritiqueContext(input: string, workflowContext: string): string {
  return [
    "Original context:",
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
    "Original context:",
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
    "- If git context already shows the current branch and diff, prefer finalize over additional search steps.",
  ].join("\n");
}

const prCreateWorkflowDefinition: WorkflowDefinition<PRTriage, PRCreatePlan> = {
  workflowName: "PRCreateWorkflow",
  triageAgentName: "PRTriageAgent",
  finalAgentName: "PRCreateAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow(
      "PRCreateWorkflow",
      input,
      memoryContext,
      availableTools,
      delegatableAgents,
    );
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow(
      "PRCreateWorkflow",
      context,
      memoryContext,
      availableTools,
      delegatableAgents,
    );
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review(
      "PRCreateWorkflow",
      context,
      candidateResult,
      workingMemory,
      memoryContext,
    );
  },
  runTriage: async (task, input) => {
    const agent = new PRTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Context:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new PRCreateAgent();
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
    return buildPRCreateWorkflowContext(
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
    buildPRCreateCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `reviewFocus=${triage.reviewFocus.length}`,
  summarizeResult: (result) => `title=${result.title.slice(0, 40)}`,
};

async function runPRCreateAgenticLoop(
  input: string,
): Promise<WorkflowResult<PRCreatePlan>> {
  const execution = startAgentExecution("PRCreateWorkflow", input);
  const runtime = new WorkflowRuntime({
    workflowName: "PRCreateWorkflow",
    input,
  });

  try {
    const result = await runtime.runActionQueue(prCreateWorkflowDefinition, input);
    runtime.complete();
    logAgentExecutionSuccess(execution, input, result);
    return { success: true, data: result, meta: runtime.getMeta() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, input, error);
    console.error("[PRCreateWorkflow] Failed:", message);
    return { success: false, error: message, meta: runtime.getMeta() };
  }
}

export async function runPRCreateWorkflow(
  issueKey: string,
): Promise<WorkflowResult<PRCreateResult>> {
  const analyzeResult = await runJiraAnalyzeWorkflow(issueKey);

  if (!analyzeResult.success) {
    return {
      success: false,
      error: analyzeResult.error,
      meta: { ...analyzeResult.meta },
    };
  }

  const analysis = analyzeResult.data;
  const input = [
    `Jira Issue: ${issueKey}`,
    `Suggested PR Title: ${analysis.suggestedPRTitle}`,
    `Suggested Branch: ${analysis.suggestedBranchName}`,
    "",
    "Implementation Plan:",
    ...analysis.implementationPlan.map((step) => `- ${step}`),
    "",
    "Acceptance Criteria:",
    ...analysis.acceptanceCriteria.map((c) => `- ${c}`),
    "",
    "Risks:",
    ...analysis.risks.map((r) => `- ${r}`),
    "",
    "Test Scenarios:",
    ...analysis.testScenarios.map((s) => `- ${s}`),
    "",
    `Summary: ${analysis.summary}`,
  ].join("\n");

  const planResult = await runPRCreateAgenticLoop(input);

  if (!planResult.success) {
    return {
      success: false,
      error: planResult.error,
      meta: { ...planResult.meta, jiraIssueKey: issueKey },
    };
  }

  const plan = planResult.data;
  let prUrl: string | undefined;
  let prNumber: number | undefined;

  if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
    const repoParts = env.GITHUB_REPO.split("/");
    if (repoParts.length === 2 && repoParts[0] && repoParts[1]) {
      try {
        const created = await createPR({
          owner: repoParts[0],
          repo: repoParts[1],
          title: plan.title,
          body: plan.description,
          head: plan.suggestedBranchName,
          base: "main",
          githubToken: env.GITHUB_TOKEN,
        });
        prUrl = created.prUrl;
        prNumber = created.prNumber;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[PRCreateWorkflow] GitHub PR creation failed:", message);
      }
    }
  }

  return {
    success: true,
    data: { ...plan, prUrl, prNumber },
    meta: { ...planResult.meta, jiraIssueKey: issueKey },
  };
}
