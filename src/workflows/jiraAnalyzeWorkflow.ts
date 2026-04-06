import { JiraAnalyzeAgent } from "../agents/jiraAnalyzeAgent";
import { env } from "../config/env";
import { IssueRepositoryContext, JiraAnalysis, WorkflowResult } from "../core/types";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { collectIssueRepositoryContext } from "../helpers/collectIssueRepositoryContext";
import { fetchJiraIssue } from "../integrations/jira/fetchJiraIssue";
import { formatJiraIssue } from "../integrations/jira/formatJiraIssue";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { buildLlmPreflightFailure } from "./workflowPreflight";

function buildJiraAnalyzeAgentInput(
  issueContext: string,
  repositoryContext: IssueRepositoryContext,
): string {
  return [
    "Jira issue context:",
    issueContext,
    "",
    "Repository investigation context:",
    repositoryContext.promptContext,
  ].join("\n");
}

export async function runJiraAnalyzeWorkflow(
  issueKey: string,
): Promise<WorkflowResult<JiraAnalysis>> {
  const preflightFailure = buildLlmPreflightFailure<JiraAnalysis>(
    "JiraAnalyzeWorkflow",
    `Jira issue key: ${issueKey}`,
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
  const execution = startAgentExecution("JiraAnalyzeWorkflow", input);
  const runtime = new WorkflowRuntime({
    workflowName: "JiraAnalyzeWorkflow",
    input,
    repoRoot: process.cwd(),
  });

  runtime.saveArtifact("jiraIssueKey", issueKey);
  runtime.saveArtifact("jiraIssue", issue);

  try {
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
    runtime.saveArtifact("context", repositoryContext.promptContext);

    const result = await runtime.executeStep(
      "finalize",
      async () => {
        const agent = new JiraAnalyzeAgent();
        return agent.run(buildJiraAnalyzeAgentInput(input, repositoryContext));
      },
      {
        agentName: "JiraAnalyzeAgent",
        inputSummary: "Generate a technical plan from the Jira issue and repository evidence",
        outputSummary: (value) =>
          `implementationPlan=${(value as JiraAnalysis).implementationPlan.length},relevantFiles=${(value as JiraAnalysis).relevantFiles.length}`,
      },
    );

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
    console.error("[JiraAnalyzeWorkflow] Failed:", message);
    return {
      success: false,
      error: message,
      meta: { ...runtime.getMeta(), jiraIssueKey: issueKey },
    };
  }
}
