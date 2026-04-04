import { env } from "../config/env";

type LogLevel = "debug" | "info" | "error";

interface AgentExecutionContext {
  agentName: string;
  startedAt: number;
}

interface AgentExecutionLog {
  agent: string;
  timestamp: string;
  event: "started" | "completed" | "failed";
  durationMs?: number;
  inputSize?: number;
  outputSize?: number;
  error?: string;
  inputPreview?: string;
  outputPreview?: string;
}

interface WorkflowStepLog {
  workflow: string;
  stepId: string;
  stepName: string;
  status: "running" | "completed" | "failed";
  timestamp: string;
  attempt: number;
  agentName?: string;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  error: 30
};

function normalizeLogLevel(value: string): LogLevel {
  if (value === "debug" || value === "info" || value === "error") {
    return value;
  }

  return "info";
}

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = normalizeLogLevel(env.LOG_LEVEL);
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function buildPreview(value: string, limit = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

function writeLog(level: LogLevel, payload: AgentExecutionLog | WorkflowStepLog): void {
  if (!shouldLog(level)) {
    return;
  }

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export function startAgentExecution(agentName: string, input: string): AgentExecutionContext {
  writeLog("info", {
    agent: agentName,
    timestamp: new Date().toISOString(),
    event: "started",
    inputSize: input.length,
    ...(env.LOG_FULL_PAYLOADS ? { inputPreview: buildPreview(input) } : {})
  });

  return {
    agentName,
    startedAt: Date.now()
  };
}

export function logAgentExecutionSuccess(
  context: AgentExecutionContext,
  input: string,
  output: unknown,
): void {
  const outputText = safeSerialize(output);

  writeLog("info", {
    agent: context.agentName,
    timestamp: new Date().toISOString(),
    event: "completed",
    durationMs: Date.now() - context.startedAt,
    inputSize: input.length,
    outputSize: outputText.length,
    ...(env.LOG_FULL_PAYLOADS
      ? {
          inputPreview: buildPreview(input),
          outputPreview: buildPreview(outputText)
        }
      : {})
  });
}

export function logAgentExecutionFailure(
  context: AgentExecutionContext,
  input: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);

  writeLog("error", {
    agent: context.agentName,
    timestamp: new Date().toISOString(),
    event: "failed",
    durationMs: Date.now() - context.startedAt,
    inputSize: input.length,
    error: message,
    ...(env.LOG_FULL_PAYLOADS ? { inputPreview: buildPreview(input) } : {})
  });
}

export function logWorkflowStep(workflowName: string, step: {
  stepId: string;
  name: string;
  status: "running" | "completed" | "failed";
  attempt: number;
  agentName?: string;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}): void {
  const payload: WorkflowStepLog = {
    workflow: workflowName,
    stepId: step.stepId,
    stepName: step.name,
    status: step.status,
    timestamp: new Date().toISOString(),
    attempt: step.attempt,
    agentName: step.agentName,
    ...(step.inputSummary ? { inputSummary: buildPreview(step.inputSummary) } : {}),
    ...(step.outputSummary ? { outputSummary: buildPreview(step.outputSummary) } : {}),
    ...(step.error ? { error: step.error } : {}),
  };

  writeLog(step.status === "failed" ? "error" : "info", payload);
}
