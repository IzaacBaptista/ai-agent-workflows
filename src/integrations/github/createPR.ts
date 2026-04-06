import axios from "axios";

export interface CreatePROptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  githubToken: string;
}

export interface CreatedPR {
  prUrl: string;
  prNumber: number;
}

export async function createPR(options: CreatePROptions): Promise<CreatedPR> {
  const url = `https://api.github.com/repos/${options.owner}/${options.repo}/pulls`;

  const response = await axios.post<{ html_url: string; number: number }>(
    url,
    {
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
    },
    {
      headers: {
        Authorization: `Bearer ${options.githubToken}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  return {
    prUrl: response.data.html_url,
    prNumber: response.data.number,
  };
}
