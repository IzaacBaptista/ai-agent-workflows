import { spawn } from "child_process";
import { CommandExecutionResult, WorkflowCommandName } from "../core/types";

interface AllowedCommandSpec {
  command: string;
  args: string[];
  timeoutMs: number;
}

const MAX_OUTPUT_CHARS = 4000;

const allowedCommands: Record<WorkflowCommandName, AllowedCommandSpec> = {
  build: {
    command: "npm",
    args: ["run", "build"],
    timeoutMs: 30_000,
  },
  test: {
    command: "npm",
    args: ["run", "test"],
    timeoutMs: 55_000,
  },
};

type RunCommandExecutor = (commandName: WorkflowCommandName) => Promise<CommandExecutionResult>;

function truncateOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_CHARS)}...`;
}

async function defaultRunCommandExecutor(commandName: WorkflowCommandName): Promise<CommandExecutionResult> {
  const spec = allowedCommands[commandName];
  const startedAt = Date.now();

  return new Promise<CommandExecutionResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, spec.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.once("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({
        command: commandName,
        exitCode,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        timedOut,
        durationMs: Date.now() - startedAt,
        signal,
      });
    });
  });
}

let runCommandExecutor: RunCommandExecutor = defaultRunCommandExecutor;

export function isAllowedCommandName(value: string): value is WorkflowCommandName {
  return value in allowedCommands;
}

export function getAllowedCommandNames(): WorkflowCommandName[] {
  return Object.keys(allowedCommands) as WorkflowCommandName[];
}

export function setRunCommandExecutorForTesting(executor?: RunCommandExecutor): void {
  runCommandExecutor = executor ?? defaultRunCommandExecutor;
}

export async function runAllowedCommand(commandName: WorkflowCommandName): Promise<CommandExecutionResult> {
  return runCommandExecutor(commandName);
}
