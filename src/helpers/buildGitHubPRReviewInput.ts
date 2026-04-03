export interface GitHubPRPayload {
  repository: string;
  prNumber: number;
  title: string;
  description: string;
  diff: string;
}

export function buildGitHubPRReviewInput(payload: GitHubPRPayload): string {
  return [
    `Repository: ${payload.repository}`,
    `PR Number: ${payload.prNumber}`,
    `Title: ${payload.title}`,
    `Description: ${payload.description}`,
    `Diff:`,
    payload.diff,
  ].join("\n");
}
