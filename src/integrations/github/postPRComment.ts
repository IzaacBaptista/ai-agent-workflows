import axios from "axios";

export async function postPRComment(
  repository: string,
  prNumber: number,
  comment: string,
  githubToken: string,
): Promise<void> {
  const parts = repository.split("/");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format "${repository}". Expected "owner/repo".`);
  }

  const [owner, repo] = parts;

  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    { body: comment },
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
}
