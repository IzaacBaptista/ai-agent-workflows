import axios from "axios";
import { JiraIssue } from "./jiraTypes";

interface JiraFetchOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function adfToPlainText(node: unknown): string {
  if (!isRecord(node)) {
    return "";
  }

  const type = typeof node.type === "string" ? node.type : "";

  if (type === "text") {
    return typeof node.text === "string" ? node.text : "";
  }

  if (type === "hardBreak") {
    return "\n";
  }

  if (type === "mention") {
    if (isRecord(node.attrs) && typeof node.attrs.text === "string") {
      return `@${node.attrs.text}`;
    }
    return "@mention";
  }

  const content = Array.isArray(node.content) ? node.content : [];
  const childText = content.map(adfToPlainText).join("");

  switch (type) {
    case "paragraph":
      return childText.trim().length > 0 ? `${childText.trim()}\n` : "";
    case "heading":
      return `${childText.trim()}\n`;
    case "listItem":
      return `- ${childText.trim()}\n`;
    case "bulletList":
    case "orderedList":
      return childText;
    case "codeBlock":
      return `\`\`\`\n${childText}\`\`\`\n`;
    case "blockquote":
      return childText
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ""))
        .join("\n")
        .trim() + "\n";
    default:
      return childText;
  }
}

function extractDescription(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }

  if (isRecord(body)) {
    return adfToPlainText(body).trim();
  }

  return "";
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown) => {
      if (typeof item === "string") return item;
      if (isRecord(item) && typeof item.name === "string") return item.name;
      return null;
    })
    .filter((item): item is string => item !== null);
}

export async function fetchJiraIssue(
  issueKey: string,
  options: JiraFetchOptions,
): Promise<JiraIssue> {
  if (!options.baseUrl) {
    throw new Error(
      "JIRA_BASE_URL is not configured. Set it in .env or ai-agent.config.json.",
    );
  }

  if (!options.email || !options.apiToken) {
    throw new Error(
      "JIRA_EMAIL and JIRA_API_TOKEN must be set in .env to fetch Jira issues.",
    );
  }

  const url = `${options.baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${encodeURIComponent(issueKey)}`;

  const token = Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");

  const response = await axios.get<Record<string, unknown>>(url, {
    headers: {
      Authorization: `Basic ${token}`,
      Accept: "application/json",
    },
  });

  const data = response.data;
  const fields = isRecord(data.fields) ? data.fields : {};
  const issueTypeField = isRecord(fields.issuetype) ? fields.issuetype : {};
  const statusField = isRecord(fields.status) ? fields.status : {};
  const priorityField = isRecord(fields.priority) ? fields.priority : {};
  const assigneeField = isRecord(fields.assignee) ? fields.assignee : null;

  return {
    key: typeof data.key === "string" ? data.key : issueKey,
    summary: typeof fields.summary === "string" ? fields.summary : "",
    description: extractDescription(fields.description),
    issueType:
      typeof issueTypeField.name === "string" ? issueTypeField.name : "Unknown",
    status:
      typeof statusField.name === "string" ? statusField.name : "Unknown",
    priority:
      typeof priorityField.name === "string" ? priorityField.name : "Unknown",
    assignee:
      assigneeField && typeof assigneeField.displayName === "string"
        ? assigneeField.displayName
        : undefined,
    labels: extractStringArray(fields.labels),
    components: extractStringArray(fields.components),
    url: `${options.baseUrl.replace(/\/$/, "")}/browse/${issueKey}`,
  };
}
