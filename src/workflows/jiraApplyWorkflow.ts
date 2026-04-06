import { CoderAgent } from "../agents/coderAgent";
import { env } from "../config/env";
import {
  CodePatchPlan,
  EditableFileContext,
  IssueRepositoryContext,
  JiraAnalysis,
  JiraApplyResult,
  WorkflowResult,
} from "../core/types";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { findLatestSuccessfulWorkflowRun } from "../helpers/findLatestWorkflowRun";
import { collectIssueRepositoryContext } from "../helpers/collectIssueRepositoryContext";
import { fetchJiraIssue } from "../integrations/jira/fetchJiraIssue";
import { formatJiraIssue } from "../integrations/jira/formatJiraIssue";
import { applyCodePatchPlan, loadEditableFileContexts } from "../tools/editPatchTool";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { runAllowedCommand } from "../tools/runCommandTool";
import { runJiraAnalyzeWorkflow } from "./jiraAnalyzeWorkflow";
import { buildLlmPreflightFailure } from "./workflowPreflight";

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function buildJiraApplyPrompt(
  issueContext: string,
  analysis: JiraAnalysis,
  repositoryContext: IssueRepositoryContext,
  editableFiles: EditableFileContext[],
): string {
  return [
    "Task:",
    "Apply the approved Jira analysis using the smallest safe patch in the listed files only.",
    "",
    "Jira issue context:",
    issueContext,
    "",
    "Approved analysis summary:",
    analysis.summary,
    "",
    "Relevant files from the approved analysis:",
    ...(analysis.relevantFiles.length > 0 ? analysis.relevantFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    "Implementation plan:",
    ...analysis.implementationPlan.map((step) => `- ${step}`),
    "",
    "Acceptance criteria:",
    ...analysis.acceptanceCriteria.map((step) => `- ${step}`),
    "",
    "Risks:",
    ...analysis.risks.map((step) => `- ${step}`),
    "",
    "Repository context:",
    repositoryContext.promptContext,
    "",
    "Editable file contexts:",
    ...editableFiles.flatMap((file) => [
      `File: ${file.path} (${file.exists ? "exists" : "new"})`,
      "```",
      file.content,
      "```",
    ]),
  ].join("\n");
}

function getMatchingRunPredicate(issueKey: string, repoRoot: string) {
  return (run: { artifacts: Record<string, unknown> }) =>
    run.artifacts.jiraIssueKey === issueKey && run.artifacts.repoRoot === repoRoot;
}

function getLatestSuccessfulJiraAnalysis(
  issueKey: string,
  repoRoot: string,
): { runId: string; analysis: JiraAnalysis } | undefined {
  const run = findLatestSuccessfulWorkflowRun(
    "JiraAnalyzeWorkflow",
    getMatchingRunPredicate(issueKey, repoRoot),
  );

  if (!run) {
    return undefined;
  }

  return {
    runId: run.runId,
    analysis: run.artifacts.result as JiraAnalysis,
  };
}

function summarizeValidation(validationResult?: JiraApplyResult["validationResult"]): string {
  if (!validationResult) {
    return "Patch applied without automatic validation.";
  }

  if (validationResult.timedOut) {
    return `Patch applied but ${validationResult.command} timed out.`;
  }

  if (validationResult.exitCode === 0) {
    return `Patch applied and ${validationResult.command} passed.`;
  }

  return `Patch applied but ${validationResult.command} failed with exit code ${validationResult.exitCode}.`;
}

export async function runJiraApplyWorkflow(
  issueKey: string,
): Promise<WorkflowResult<JiraApplyResult>> {
  const preflightFailure = buildLlmPreflightFailure<JiraApplyResult>(
    "JiraApplyWorkflow",
    `Apply Jira issue key: ${issueKey}`,
    { jiraIssueKey: issueKey, repoRoot: process.cwd() },
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
  const execution = startAgentExecution("JiraApplyWorkflow", input);
  const runtime = new WorkflowRuntime({
    workflowName: "JiraApplyWorkflow",
    input,
    repoRoot: process.cwd(),
  });

  runtime.saveArtifact("jiraIssueKey", issueKey);
  runtime.saveArtifact("jiraIssue", issue);

  try {
    const analysisSource = await runtime.executeStep(
      "load_analysis",
      async () => {
        const existing = getLatestSuccessfulJiraAnalysis(issueKey, process.cwd());
        if (existing) {
          return existing;
        }

        const analysisResult = await runJiraAnalyzeWorkflow(issueKey);
        if (!analysisResult.success) {
          throw new Error(`Unable to reuse analysis: ${analysisResult.error}`);
        }

        return { runId: analysisResult.meta.runId, analysis: analysisResult.data };
      },
      {
        inputSummary: `Load or generate approved analysis for ${issueKey}`,
        outputSummary: (value) =>
          `analysisRunId=${(value as { runId: string }).runId}`,
      },
    );

    runtime.saveArtifact("analysisRunId", analysisSource.runId);
    runtime.saveArtifact("analysis", analysisSource.analysis);

    const repositoryContext = await runtime.executeStep(
      "collect_context",
      async () => collectIssueRepositoryContext(issue, process.cwd()),
      {
        inputSummary: `Collect deterministic repository context for ${issueKey}`,
        outputSummary: (value) => (value as IssueRepositoryContext).summary,
      },
    );

    runtime.saveArtifact("issueRepositoryContext", repositoryContext);
    runtime.saveArtifact("codeSearchResults", repositoryContext.codeSearchResults);
    runtime.saveArtifact("fileReadResults", repositoryContext.fileReadResults);
    runtime.saveArtifact("gitStatusResult", repositoryContext.gitStatus);
    runtime.saveArtifact("gitDiffResult", repositoryContext.gitDiff);

    const editableFilePaths = uniqueStrings([
      ...repositoryContext.relevantFiles,
      ...analysisSource.analysis.relevantFiles,
    ]).slice(0, 3);

    if (editableFilePaths.length === 0) {
      throw new Error("No candidate files were identified for patch generation.");
    }

    const editableFiles = await runtime.executeStep(
      "load_editable_files",
      async () => loadEditableFileContexts(editableFilePaths, process.cwd()),
      {
        inputSummary: "Load editable file contexts for the approved patch scope",
        outputSummary: (value) => `files=${(value as EditableFileContext[]).length}`,
      },
    );

    const patchPlan = await runtime.executeStep(
      "draft_patch",
      async () => {
        const agent = new CoderAgent();
        return agent.run(
          buildJiraApplyPrompt(input, analysisSource.analysis, repositoryContext, editableFiles),
        );
      },
      {
        agentName: "CoderAgent",
        inputSummary: "Generate the smallest safe patch for the approved Jira issue",
        outputSummary: (value) =>
          `edits=${(value as CodePatchPlan).edits.length},validation=${(value as CodePatchPlan).validationCommand ?? "none"}`,
      },
    );

    runtime.saveArtifact("patchPlan", patchPlan);

    if (patchPlan.edits.length === 0) {
      throw new Error("No safe code patch could be produced from the available evidence.");
    }

    const patchResult = await runtime.executeStep(
      "apply_patch",
      async () => applyCodePatchPlan(patchPlan, editableFilePaths, process.cwd()),
      {
        inputSummary: "Apply the generated localized patch to the target repository",
        outputSummary: (value) =>
          `edits=${(value as { edits: Array<unknown> }).edits.length}`,
      },
    );

    runtime.saveArtifact("patchResult", patchResult);

    const validationResult = patchPlan.validationCommand
      ? await runtime.executeStep(
          "validate",
          async () => runAllowedCommand(patchPlan.validationCommand!, { cwd: process.cwd() }),
          {
            inputSummary: `Validate the applied patch with ${patchPlan.validationCommand}`,
            outputSummary: (value) =>
              `command=${(value as { command: string }).command},exitCode=${(value as { exitCode: number | null }).exitCode ?? "null"}`,
          },
        )
      : undefined;

    if (validationResult) {
      runtime.saveArtifact("validationResult", validationResult);
      runtime.saveArtifact("commandResults", [validationResult]);
    }

    const result: JiraApplyResult = {
      summary: summarizeValidation(validationResult),
      analysis: analysisSource.analysis,
      patchSummary: patchPlan.summary,
      editedFiles: patchResult.edits.map((edit) => edit.path),
      validationCommand: patchPlan.validationCommand,
      validationResult,
      suggestedBranchName: analysisSource.analysis.suggestedBranchName,
      suggestedPRTitle: analysisSource.analysis.suggestedPRTitle,
    };

    runtime.saveArtifact("result", result);
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
    console.error("[JiraApplyWorkflow] Failed:", message);
    return {
      success: false,
      error: message,
      meta: { ...runtime.getMeta(), jiraIssueKey: issueKey },
    };
  }
}
