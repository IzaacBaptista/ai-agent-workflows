import { JiraIssue } from "./jiraTypes";

const MAX_DESCRIPTION_LINES = 18;
const MAX_DESCRIPTION_CHARS = 1800;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 17)).trimEnd()}\n\n[truncated]`;
}

function sanitizeJiraDescription(description: string): string {
  const noisePatterns = [
    /^[-=_]{3,}$/i,
    /informações do movidesk/i,
    /^aberto por:/i,
    /^solicitante\(s\):/i,
    /^ticket:\s*/i,
    /^título:\s*/i,
  ];

  const sanitizedLines: string[] = [];
  let previousWasBlank = false;

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    const isBlank = line.length === 0;

    if (isBlank) {
      if (!previousWasBlank && sanitizedLines.length > 0) {
        sanitizedLines.push("");
      }
      previousWasBlank = true;
      continue;
    }

    if (noisePatterns.some((pattern) => pattern.test(line))) {
      continue;
    }

    sanitizedLines.push(line);
    previousWasBlank = false;

    if (sanitizedLines.filter((entry) => entry !== "").length >= MAX_DESCRIPTION_LINES) {
      sanitizedLines.push("", "[truncated]");
      break;
    }
  }

  return truncateText(sanitizedLines.join("\n").trim(), MAX_DESCRIPTION_CHARS);
}

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
    const description = sanitizeJiraDescription(issue.description);
    if (description) {
      lines.push("", "Description:", description);
    }
  }

  return lines.join("\n");
}
