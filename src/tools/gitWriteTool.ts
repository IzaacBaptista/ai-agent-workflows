import { spawn } from "child_process";

interface GitWriteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

type GitWriteExecutor = (args: string[], cwd?: string) => Promise<GitWriteResult>;

async function defaultGitWriteExecutor(args: string[], cwd?: string): Promise<GitWriteResult> {
  return new Promise<GitWriteResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn("git", args, {
      cwd: cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
      });
    });
  });
}

let gitWriteExecutor: GitWriteExecutor = defaultGitWriteExecutor;

function assertGitWriteSuccess(result: GitWriteResult, action: string): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode ?? "null"}`;
  throw new Error(`${action} failed: ${detail}`);
}

export function setGitWriteExecutorForTesting(executor?: GitWriteExecutor): void {
  gitWriteExecutor = executor ?? defaultGitWriteExecutor;
}

export async function getCurrentGitBranch(cwd?: string): Promise<string> {
  const result = await gitWriteExecutor(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  assertGitWriteSuccess(result, "git rev-parse --abbrev-ref HEAD");
  return result.stdout.trim();
}

export async function ensureLocalBranch(branchName: string, cwd?: string): Promise<void> {
  const existsResult = await gitWriteExecutor(["rev-parse", "--verify", branchName], cwd);
  const args =
    existsResult.exitCode === 0 ? ["checkout", branchName] : ["checkout", "-b", branchName];
  const result = await gitWriteExecutor(args, cwd);
  assertGitWriteSuccess(result, `git ${args.join(" ")}`);
}

export async function stageFiles(files: string[], cwd?: string): Promise<void> {
  const result = await gitWriteExecutor(["add", "--", ...files], cwd);
  assertGitWriteSuccess(result, "git add");
}

export async function commitStagedChanges(message: string, cwd?: string): Promise<void> {
  const result = await gitWriteExecutor(["commit", "-m", message], cwd);
  assertGitWriteSuccess(result, "git commit");
}

export async function pushBranch(branchName: string, cwd?: string): Promise<void> {
  const result = await gitWriteExecutor(["push", "-u", "origin", branchName], cwd);
  assertGitWriteSuccess(result, `git push -u origin ${branchName}`);
}
