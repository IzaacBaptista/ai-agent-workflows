import { JiraIssue } from "./jiraTypes";

export function formatJiraIssue(issue: JiraIssue): string {
  const lines: string[] = [
    `Jira Issue: ${issue.key}`,
    `URL: ${issue.url}`,
    `Summary: ${issue.summary}`,
    `Type: ${issue.issueType}`,
    `Status: ${issue.status}`,
    `Priority: ${issue.priority}`,
  ];

  if (issue.assignee) {
    lines.push(`Assignee: ${issue.assignee}`);
  }

  if (issue.labels.length > 0) {
    lines.push(`Labels: ${issue.labels.join(", ")}`);
  }

  if (issue.components.length > 0) {
    lines.push(`Components: ${issue.components.join(", ")}`);
  }

  if (issue.description) {
    lines.push("", "Description:", issue.description);
  }

  return lines.join("\n");
}
