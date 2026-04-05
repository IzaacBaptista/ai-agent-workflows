import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawn } from "child_process";

export interface IsolatedWorkspace {
  path: string;
  cleanup: () => Promise<void>;
}

type IsolatedWorkspaceFactory = () => Promise<IsolatedWorkspace>;

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function runGit(args: string[]): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolveResult, reject) => {
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
    child.once("close", (exitCode) => {
      resolveResult({
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}

async function defaultCreateIsolatedWorkspace(): Promise<IsolatedWorkspace> {
  const path = resolve(mkdtempSync(join(tmpdir(), "ai-agent-workflows-worktree-")));
  const addResult = await runGit(["worktree", "add", "--detach", path, "HEAD"]);

  if (addResult.exitCode !== 0) {
    rmSync(path, { recursive: true, force: true });
    throw new Error(
      `git worktree add failed: ${addResult.stderr.trim() || `exit code ${addResult.exitCode ?? "null"}`}`,
    );
  }

  return {
    path,
    cleanup: async () => {
      const removeResult = await runGit(["worktree", "remove", "--force", path]);
      rmSync(path, { recursive: true, force: true });

      if (removeResult.exitCode !== 0) {
        throw new Error(
          `git worktree remove failed: ${removeResult.stderr.trim() || `exit code ${removeResult.exitCode ?? "null"}`}`,
        );
      }
    },
  };
}

let isolatedWorkspaceFactory: IsolatedWorkspaceFactory = defaultCreateIsolatedWorkspace;

export function setIsolatedWorkspaceFactoryForTesting(factory?: IsolatedWorkspaceFactory): void {
  isolatedWorkspaceFactory = factory ?? defaultCreateIsolatedWorkspace;
}

export async function createIsolatedWorkspace(): Promise<IsolatedWorkspace> {
  return isolatedWorkspaceFactory();
}
