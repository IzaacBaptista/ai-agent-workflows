import { PRCreateAgent } from "../agents/prCreateAgent";
import { env } from "../config/env";
import { JiraApplyResult, JiraPrResult, WorkflowResult } from "../core/types";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { findLatestSuccessfulWorkflowRun } from "../helpers/findLatestWorkflowRun";
import { fetchJiraIssue } from "../integrations/jira/fetchJiraIssue";
import { createPR } from "../integrations/github/createPR";
import { formatJiraIssue } from "../integrations/jira/formatJiraIssue";
import { getGitDiffAt, getGitStatusAt } from "../tools/gitTool";
import {
  commitStagedChanges,
  ensureLocalBranch,
  getCurrentGitBranch,
  pushBranch,
  stageFiles,
} from "../tools/gitWriteTool";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { buildLlmPreflightFailure } from "./workflowPreflight";

function getMatchingRunPredicate(issueKey: string, repoRoot: string) {
  return (run: { artifacts: Record<string, unknown> }) =>
    run.artifacts.jiraIssueKey === issueKey && run.artifacts.repoRoot === repoRoot;
}

function getLatestSuccessfulJiraApply(
  issueKey: string,
  repoRoot: string,
): { runId: string; result: JiraApplyResult } | undefined {
  const run = findLatestSuccessfulWorkflowRun(
    "JiraApplyWorkflow",
    getMatchingRunPredicate(issueKey, repoRoot),
  );

  if (!run) {
    return undefined;
  }

  return {
    runId: run.runId,
    result: run.artifacts.result as JiraApplyResult,
  };
}

function hasPendingEditedFiles(
  gitStatus: Awaited<ReturnType<typeof getGitStatusAt>>,
  editedFiles: string[],
): boolean {
  const dirtyPaths = new Set(gitStatus.entries.map((entry) => entry.path));
  return editedFiles.some((file) => dirtyPaths.has(file));
}

function buildJiraPrContext(
  issueContext: string,
  applyResult: JiraApplyResult,
  branchName: string,
  gitDiffPreview: string,
): string {
  return [
    `Target branch: ${branchName}`,
    "",
    "Jira issue context:",
    issueContext,
    "",
    "Approved analysis summary:",
    applyResult.analysis.summary,
    "",
    "Relevant files:",
    ...(applyResult.analysis.relevantFiles.length > 0
      ? applyResult.analysis.relevantFiles.map((file) => `- ${file}`)
      : ["- none"]),
    "",
    "Implementation plan:",
    ...applyResult.analysis.implementationPlan.map((step) => `- ${step}`),
    "",
    "Applied patch summary:",
    `- ${applyResult.patchSummary}`,
    ...applyResult.editedFiles.map((file) => `- ${file}`),
    "",
    "Validation:",
    `- ${applyResult.summary}`,
    "",
    "Working tree diff preview:",
    "```diff",
    gitDiffPreview.trim() || "# no diff preview available",
    "```",
  ].join("\n");
}

export async function runJiraPrWorkflow(
  issueKey: string,
): Promise<WorkflowResult<JiraPrResult>> {
  const preflightFailure = buildLlmPreflightFailure<JiraPrResult>(
    "JiraPrWorkflow",
    `Open PR for Jira issue key: ${issueKey}`,
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
  const execution = startAgentExecution("JiraPrWorkflow", input);
  const runtime = new WorkflowRuntime({
    workflowName: "JiraPrWorkflow",
    input,
    repoRoot: process.cwd(),
  });

  runtime.saveArtifact("jiraIssueKey", issueKey);
  runtime.saveArtifact("jiraIssue", issue);

  try {
    if (!env.GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN is not configured.");
    }

    if (!env.GITHUB_REPO) {
      throw new Error("GITHUB_REPO is not configured.");
    }

    const applySource = getLatestSuccessfulJiraApply(issueKey, process.cwd());
    if (!applySource) {
      throw new Error(`No successful JiraApplyWorkflow run was found for ${issueKey} in this repository.`);
    }

    if (
      applySource.result.validationResult &&
      (applySource.result.validationResult.timedOut ||
        applySource.result.validationResult.exitCode !== 0)
    ) {
      throw new Error("The latest applied patch did not pass validation, so the PR will not be opened.");
    }

    runtime.saveArtifact("applyRunId", applySource.runId);
    runtime.saveArtifact("applyResult", applySource.result);

    const gitStatus = await runtime.executeStep(
      "collect_status",
      async () => getGitStatusAt(process.cwd()),
      {
        inputSummary: "Inspect the working tree before creating the PR branch",
        outputSummary: (value) => `entries=${(value as { entries: unknown[] }).entries.length}`,
      },
    );
    runtime.saveArtifact("gitStatusResult", gitStatus);

    const currentBranch = await runtime.executeStep(
      "detect_branch",
      async () => getCurrentGitBranch(process.cwd()),
      {
        inputSummary: "Detect the current git branch",
        outputSummary: (value) => `branch=${String(value)}`,
      },
    );

    const branchName =
      currentBranch === "main" || currentBranch === "master" || currentBranch === "HEAD"
        ? applySource.result.suggestedBranchName
        : currentBranch;

    if (currentBranch !== branchName) {
      await runtime.executeStep(
        "prepare_branch",
        async () => ensureLocalBranch(branchName, process.cwd()),
        {
          inputSummary: `Create or switch to the target branch ${branchName}`,
          outputSummary: () => `branch=${branchName}`,
        },
      );
    }

    if (hasPendingEditedFiles(gitStatus, applySource.result.editedFiles)) {
      await runtime.executeStep(
        "stage_changes",
        async () => stageFiles(applySource.result.editedFiles, process.cwd()),
        {
          inputSummary: "Stage the files produced by the approved apply step",
          outputSummary: () => `files=${applySource.result.editedFiles.length}`,
        },
      );

      await runtime.executeStep(
        "commit_changes",
        async () => commitStagedChanges(applySource.result.suggestedPRTitle, process.cwd()),
        {
          inputSummary: "Create a commit for the staged Jira patch",
          outputSummary: () => `commit=${applySource.result.suggestedPRTitle}`,
        },
      );
    } else if (branchName === "main" || branchName === "master") {
      throw new Error("There are no pending applied changes to open as a PR.");
    }

    await runtime.executeStep(
      "push_branch",
      async () => pushBranch(branchName, process.cwd()),
      {
        inputSummary: `Push ${branchName} to origin`,
        outputSummary: () => `branch=${branchName}`,
      },
    );

    const gitDiff = await runtime.executeStep(
      "collect_diff",
      async () => getGitDiffAt(process.cwd(), false),
      {
        inputSummary: "Collect a local diff preview for the PR description",
        outputSummary: (value) => `files=${(value as { changedFiles: string[] }).changedFiles.length}`,
      },
    );
    runtime.saveArtifact("gitDiffResult", gitDiff);

    const prPlan = await runtime.executeStep(
      "draft_pr",
      async () => {
        const agent = new PRCreateAgent();
        return agent.run(buildJiraPrContext(input, applySource.result, branchName, gitDiff.diff));
      },
      {
        agentName: "PRCreateAgent",
        inputSummary: "Draft the final GitHub PR title and body from the approved Jira patch",
        outputSummary: (value) => `title=${(value as { title: string }).title}`,
      },
    );

    const [owner, repo] = env.GITHUB_REPO.split("/");
    if (!owner || !repo) {
      throw new Error(`GITHUB_REPO must be in the format owner/repo. Received: ${env.GITHUB_REPO}`);
    }

    const created = await runtime.executeStep(
      "open_pr",
      async () =>
        createPR({
          owner,
          repo,
          title: prPlan.title,
          body: prPlan.description,
          head: branchName,
          base: "main",
          githubToken: env.GITHUB_TOKEN,
        }),
      {
        inputSummary: "Open the GitHub pull request from the prepared branch",
        outputSummary: (value) => `pr=${(value as { prNumber: number }).prNumber}`,
      },
    );

    const result: JiraPrResult = {
      summary: `Pull request opened from ${branchName}.`,
      branchName,
      commitMessage: applySource.result.suggestedPRTitle,
      title: prPlan.title,
      description: prPlan.description,
      suggestedBranchName: prPlan.suggestedBranchName,
      labels: prPlan.labels,
      prUrl: created.prUrl,
      prNumber: created.prNumber,
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
    console.error("[JiraPrWorkflow] Failed:", message);
    return {
      success: false,
      error: message,
      meta: { ...runtime.getMeta(), jiraIssueKey: issueKey },
    };
  }
}
