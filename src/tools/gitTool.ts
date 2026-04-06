import { spawn } from "child_process";
import { GitDiffResult, GitLogEntry, GitLogResult, GitStatusEntry, GitStatusResult } from "../core/types";

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface GitToolExecutor {
  getStatus(cwd?: string): Promise<GitStatusResult>;
  getDiff(staged: boolean, cwd?: string): Promise<GitDiffResult>;
  getLog(path?: string, maxCommits?: number, cwd?: string): Promise<GitLogResult>;
}

const MAX_DIFF_CHARS = 8000;
const MAX_LOG_COMMITS = 20;
export const DEFAULT_LOG_COMMITS = 10;
const UNIT_SEP = "\x1f";

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

async function runGitCommand(args: string[], cwd?: string): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
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

async function defaultGitToolExecutorStatus(cwd?: string): Promise<GitStatusResult> {
  const result = await runGitCommand(["status", "--short"], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git status failed: ${result.stderr.trim() || `exit code ${result.exitCode ?? "null"}`}`);
  }

  return {
    entries: parseGitStatus(result.stdout),
    raw: result.stdout.trim(),
  };
}

async function defaultGitToolExecutorDiff(staged: boolean, cwd?: string): Promise<GitDiffResult> {
  const args = staged ? ["diff", "--cached", "--no-ext-diff", "--unified=3"] : ["diff", "--no-ext-diff", "--unified=3"];
  const result = await runGitCommand(args, cwd);
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

function parseGitLog(output: string, query?: string, limit?: number): GitLogResult {
  const commits: GitLogEntry[] = [];
  let currentEntry: { hash: string; subject: string; author: string; date: string; files: string[] } | null = null;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.includes(UNIT_SEP)) {
      if (currentEntry) {
        commits.push(currentEntry);
      }

      const parts = line.split(UNIT_SEP);
      currentEntry = {
        hash: (parts[0] ?? "").trim(),
        subject: (parts[1] ?? "").trim(),
        author: (parts[2] ?? "").trim(),
        date: (parts[3] ?? "").trim(),
        files: [],
      };
    } else if (currentEntry && line.trim().length > 0) {
      currentEntry.files.push(line.trim());
    }
  }

  if (currentEntry) {
    commits.push(currentEntry);
  }

  // Truncated when the number of commits returned equals the requested limit,
  // indicating there may be more commits beyond what was fetched.
  const truncated = limit !== undefined && commits.length >= limit;

  return { commits, query, truncated };
}

async function defaultGitToolExecutorLog(
  path?: string,
  maxCommits?: number,
  cwd?: string,
): Promise<GitLogResult> {
  const limit = Math.min(Math.max(1, maxCommits ?? DEFAULT_LOG_COMMITS), MAX_LOG_COMMITS);
  const format = `%H${UNIT_SEP}%s${UNIT_SEP}%an${UNIT_SEP}%ad`;
  const args = [
    "log",
    `--pretty=format:${format}`,
    "--date=short",
    "--name-only",
    `-n`,
    String(limit),
  ];

  if (path && path.trim().length > 0) {
    args.push("--", path.trim());
  }

  const result = await runGitCommand(args, cwd);

  if (result.exitCode !== 0) {
    throw new Error(`git log failed: ${result.stderr.trim() || `exit code ${result.exitCode ?? "null"}`}`);
  }

  return parseGitLog(result.stdout, path, limit);
}

let gitToolExecutor: GitToolExecutor = {
  getStatus: defaultGitToolExecutorStatus,
  getDiff: defaultGitToolExecutorDiff,
  getLog: defaultGitToolExecutorLog,
};

export function setGitToolExecutorForTesting(executor?: Partial<GitToolExecutor>): void {
  gitToolExecutor = {
    getStatus: executor?.getStatus ?? defaultGitToolExecutorStatus,
    getDiff: executor?.getDiff ?? defaultGitToolExecutorDiff,
    getLog: executor?.getLog ?? defaultGitToolExecutorLog,
  };
}

export async function getGitStatus(): Promise<GitStatusResult> {
  return gitToolExecutor.getStatus();
}

export async function getGitStatusAt(cwd: string): Promise<GitStatusResult> {
  return gitToolExecutor.getStatus(cwd);
}

export async function getGitDiff(staged = false): Promise<GitDiffResult> {
  return gitToolExecutor.getDiff(staged);
}

export async function getGitDiffAt(cwd: string, staged = false): Promise<GitDiffResult> {
  return gitToolExecutor.getDiff(staged, cwd);
}

export async function getGitLog(path?: string, maxCommits?: number): Promise<GitLogResult> {
  return gitToolExecutor.getLog(path, maxCommits);
}
