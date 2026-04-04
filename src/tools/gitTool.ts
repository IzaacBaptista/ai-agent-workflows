import { spawn } from "child_process";
import { GitDiffResult, GitStatusEntry, GitStatusResult } from "../core/types";

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface GitToolExecutor {
  getStatus(): Promise<GitStatusResult>;
  getDiff(staged: boolean): Promise<GitDiffResult>;
}

const MAX_DIFF_CHARS = 8000;

function truncateDiff(value: string): { diff: string; truncated: boolean } {
  if (value.length <= MAX_DIFF_CHARS) {
    return { diff: value, truncated: false };
  }

  return {
    diff: `${value.slice(0, MAX_DIFF_CHARS)}...`,
    truncated: true,
  };
}

function parseGitStatus(raw: string): GitStatusEntry[] {
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3)
    .map((line) => ({
      indexStatus: line[0],
      workingTreeStatus: line[1],
      path: line.slice(3),
    }));
}

function parseChangedFiles(diff: string): string[] {
  const files = diff
    .split("\n")
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice("+++ b/".length).trim());

  return Array.from(new Set(files));
}

async function runGitCommand(args: string[]): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn("git", args, {
      cwd: process.cwd(),
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

async function defaultGitToolExecutorStatus(): Promise<GitStatusResult> {
  const result = await runGitCommand(["status", "--short"]);
  if (result.exitCode !== 0) {
    throw new Error(`git status failed: ${result.stderr.trim() || `exit code ${result.exitCode ?? "null"}`}`);
  }

  return {
    entries: parseGitStatus(result.stdout),
    raw: result.stdout.trim(),
  };
}

async function defaultGitToolExecutorDiff(staged: boolean): Promise<GitDiffResult> {
  const args = staged ? ["diff", "--cached", "--no-ext-diff", "--unified=3"] : ["diff", "--no-ext-diff", "--unified=3"];
  const result = await runGitCommand(args);
  if (result.exitCode !== 0) {
    throw new Error(`git diff failed: ${result.stderr.trim() || `exit code ${result.exitCode ?? "null"}`}`);
  }

  const truncated = truncateDiff(result.stdout);

  return {
    staged,
    diff: truncated.diff.trim(),
    changedFiles: parseChangedFiles(result.stdout),
    truncated: truncated.truncated,
  };
}

let gitToolExecutor: GitToolExecutor = {
  getStatus: defaultGitToolExecutorStatus,
  getDiff: defaultGitToolExecutorDiff,
};

export function setGitToolExecutorForTesting(executor?: GitToolExecutor): void {
  gitToolExecutor = executor ?? {
    getStatus: defaultGitToolExecutorStatus,
    getDiff: defaultGitToolExecutorDiff,
  };
}

export async function getGitStatus(): Promise<GitStatusResult> {
  return gitToolExecutor.getStatus();
}

export async function getGitDiff(staged = false): Promise<GitDiffResult> {
  return gitToolExecutor.getDiff(staged);
}
