import { fetchJiraIssue } from "../integrations/jira/fetchJiraIssue";
import { formatJiraIssue } from "../integrations/jira/formatJiraIssue";
import { env } from "../config/env";
import { IssueAnalysis, WorkflowResult } from "../core/types";
import { runIssueWorkflow } from "./issueWorkflow";

export async function runJiraIssueWorkflow(
  issueKey: string,
): Promise<WorkflowResult<IssueAnalysis>> {
  const issue = await fetchJiraIssue(issueKey, {
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
  });

  const input = formatJiraIssue(issue);
  const result = await runIssueWorkflow(input);

  return {
    ...result,
    meta: { ...result.meta, jiraIssueKey: issueKey },
  };
}
