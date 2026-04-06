export interface GitHubPRPayload {
  repository: string;
  prNumber: number;
  title: string;
  description: string;
  diff: string;
}

const MAX_DESCRIPTION_CHARS = 4000;
const MAX_DIFF_CHARS = 12000;
const MAX_CHANGED_FILES = 20;

function truncateText(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  const normalized = value.trim();

  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }

  return {
    text: `${normalized.slice(0, maxChars)}\n...[truncated]`,
    truncated: true,
  };
}

function extractChangedFiles(diff: string): string[] {
  return Array.from(
    new Set(
      diff
        .split("\n")
        .filter((line) => line.startsWith("--- "))
        .map((line) => line.slice(4).trim())
        .filter((line) => line.length > 0),
    ),
  );
}

export function buildGitHubPRReviewInput(payload: GitHubPRPayload): string {
  const description = truncateText(payload.description, MAX_DESCRIPTION_CHARS);
  const diff = truncateText(payload.diff, MAX_DIFF_CHARS);
  const changedFiles = extractChangedFiles(payload.diff);
  const changedFilesPreview = changedFiles.slice(0, MAX_CHANGED_FILES);

  return [
    `Repository: ${payload.repository}`,
    `PR Number: ${payload.prNumber}`,
    `Title: ${payload.title}`,
    "Description:",
    description.text.length > 0 ? description.text : "(empty)",
    "",
    `Changed files: ${changedFiles.length}`,
    ...changedFilesPreview.map((file) => `- ${file}`),
    ...(changedFiles.length > changedFilesPreview.length
      ? [`- ... ${changedFiles.length - changedFilesPreview.length} additional file(s) omitted`]
      : []),
    "",
    "Patch excerpts:",
    diff.text.length > 0 ? diff.text : "(empty)",
    ...(description.truncated || diff.truncated
      ? [
          "",
          "Notes:",
          ...(description.truncated ? ["- Description was truncated for planner input."] : []),
          ...(diff.truncated ? ["- Diff was truncated for planner input."] : []),
        ]
      : []),
  ].join("\n");
}
