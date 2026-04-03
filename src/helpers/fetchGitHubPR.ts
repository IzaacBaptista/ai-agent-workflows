import axios from "axios";

export interface GitHubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface GitHubPRDetails {
  repository: string;
  prNumber: number;
  title: string;
  description: string;
  diff: string;
}

export async function fetchGitHubPR(
  repository: string,
  prNumber: number,
  githubToken?: string,
): Promise<GitHubPRDetails> {
  const parts = repository.split("/");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format "${repository}". Expected "owner/repo".`);
  }

  const [owner, repo] = parts;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };

  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;

  const [prResponse, filesResponse] = await Promise.all([
    axios.get<{ title: string; body: string | null }>(baseUrl, { headers }),
    axios.get<GitHubPRFile[]>(`${baseUrl}/files`, { headers }),
  ]);

  const title = prResponse.data.title;
  const description = prResponse.data.body ?? "";
  const files: GitHubPRFile[] = filesResponse.data;

  const diff = files
    .map((file) => {
      const lines: string[] = [`--- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`];
      if (file.patch) {
        lines.push(file.patch);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return { repository, prNumber, title, description, diff };
}
