import {
  CommandExecutionResult,
  RelevantMemoryContext,
  WorkflowCritique,
  WorkflowRunRecord,
  WorkflowToolCallRecord,
} from "../core/types";
import { getAllRunMemories } from "./simpleMemory";

interface RelevantRunsInput {
  workflowName: string;
  input: string;
  excludeRunId?: string;
  limit?: number;
}

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function getCritiqueMissingEvidence(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray((value as { missingEvidence?: unknown }).missingEvidence)) {
    return (value as { missingEvidence: string[] }).missingEvidence;
  }

  if (Array.isArray((value as { gaps?: unknown }).gaps)) {
    return (value as { gaps: string[] }).gaps;
  }

  return [];
}

function getRunSearchText(run: WorkflowRunRecord): string {
  return [
    run.workflowName,
    run.input,
    run.error ?? "",
    typeof run.artifacts.forcedFinalAnalysisReason === "string"
      ? run.artifacts.forcedFinalAnalysisReason
      : "",
    JSON.stringify(run.artifacts.commandResults ?? []),
    JSON.stringify(run.artifacts.critiques ?? []),
    JSON.stringify(run.artifacts.validationErrors ?? []),
  ].join(" ");
}

function scoreRun(run: WorkflowRunRecord, workflowName: string, inputTokens: string[]): number {
  const runText = getRunSearchText(run);
  const runTokens = new Set(normalizeTokens(runText));
  const overlap = inputTokens.filter((token) => runTokens.has(token)).length;
  const sameWorkflowBonus = run.workflowName === workflowName ? 10 : 0;
  const failedBonus = run.status === "failed" ? 3 : 0;
  const forcedFinalizationBonus =
    typeof run.artifacts.forcedFinalAnalysisReason === "string" ? 2 : 0;

  return overlap * 2 + sameWorkflowBonus + failedBonus + forcedFinalizationBonus;
}

export function getRelevantRuns({
  workflowName,
  input,
  excludeRunId,
  limit = 5,
}: RelevantRunsInput): WorkflowRunRecord[] {
  const inputTokens = uniqueStrings(normalizeTokens(input));

  return getAllRunMemories()
    .filter((run) => run.runId !== excludeRunId)
    .map((run) => ({ run, score: scoreRun(run, workflowName, inputTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.run.startedAt.localeCompare(left.run.startedAt);
    })
    .slice(0, limit)
    .map((entry) => entry.run);
}

export function extractFailurePatterns(runs: WorkflowRunRecord[]): string[] {
  return uniqueStrings(
    runs.flatMap((run) => {
      const patterns: string[] = [];

      if (run.error) {
        patterns.push(run.error);
      }

      if (typeof run.artifacts.forcedFinalAnalysisReason === "string") {
        patterns.push(run.artifacts.forcedFinalAnalysisReason);
      }

      return patterns;
    }),
  ).slice(0, 5);
}

export function extractCritiquePatterns(runs: WorkflowRunRecord[]): string[] {
  return uniqueStrings(
    runs.flatMap((run) =>
      (((run.artifacts.critiques as WorkflowCritique[] | undefined) ?? []) as unknown[]).flatMap(
        (critique) => [
          typeof (critique as { summary?: unknown }).summary === "string"
            ? ((critique as { summary: string }).summary)
            : "",
          ...getCritiqueMissingEvidence(critique),
        ],
      ),
    ),
  )
    .filter((entry) => entry.length > 0)
    .slice(0, 5);
}

export function extractToolLoopPatterns(runs: WorkflowRunRecord[]): string[] {
  return uniqueStrings(
    runs.flatMap((run) =>
      ((run.artifacts.toolCalls as WorkflowToolCallRecord[] | undefined) ?? [])
        .filter((call) => call.suppressed || call.cached)
        .map((call) => `${call.toolName}:${call.signature}`),
    ),
  ).slice(0, 5);
}

function getCommandStatus(result: CommandExecutionResult): string {
  if (result.timedOut) {
    return "timed_out";
  }

  return result.exitCode === 0 ? "passed" : "failed";
}

export function extractCommandPatterns(runs: WorkflowRunRecord[]): string[] {
  return uniqueStrings(
    runs.flatMap((run) =>
      (((run.artifacts.commandResults as CommandExecutionResult[] | undefined) ?? [])).map(
        (result) => `${result.command}_${getCommandStatus(result)}`,
      ),
    ),
  ).slice(0, 5);
}

export function summarizeRelevantRuns(runs: WorkflowRunRecord[]): string {
  if (runs.length === 0) {
    return "No relevant memory found.";
  }

  return runs
    .map((run) => {
      const critiqueCount = Array.isArray(run.artifacts.critiques)
        ? run.artifacts.critiques.length
        : 0;
      const forcedReason =
        typeof run.artifacts.forcedFinalAnalysisReason === "string"
          ? run.artifacts.forcedFinalAnalysisReason
          : "none";
      const commandSummary = (((run.artifacts.commandResults as CommandExecutionResult[] | undefined) ?? []))
        .map((result) => `${result.command}:${getCommandStatus(result)}:${result.exitCode ?? "null"}`)
        .join(", ") || "none";

      return [
        `- ${run.workflowName} (${run.status})`,
        `  input=${run.input.slice(0, 120)}`,
        `  critiques=${critiqueCount}`,
        `  forcedFinalization=${forcedReason}`,
        `  commands=${commandSummary}`,
      ].join("\n");
    })
    .join("\n");
}

export function buildRelevantMemoryContext(
  workflowName: string,
  input: string,
  excludeRunId?: string,
): RelevantMemoryContext {
  const runs = getRelevantRuns({ workflowName, input, excludeRunId, limit: 5 });
  const failurePatterns = extractFailurePatterns(runs);
  const critiquePatterns = extractCritiquePatterns(runs);
  const toolLoopPatterns = extractToolLoopPatterns(runs);
  const commandPatterns = extractCommandPatterns(runs);

  return {
    summary: [
      "Relevant memory:",
      summarizeRelevantRuns(runs),
      "",
      "Failure patterns:",
      ...(failurePatterns.length > 0 ? failurePatterns.map((item) => `- ${item}`) : ["- none"]),
      "",
      "Critique patterns:",
      ...(critiquePatterns.length > 0 ? critiquePatterns.map((item) => `- ${item}`) : ["- none"]),
      "",
      "Tool loop patterns:",
      ...(toolLoopPatterns.length > 0 ? toolLoopPatterns.map((item) => `- ${item}`) : ["- none"]),
      "",
      "Command patterns:",
      ...(commandPatterns.length > 0 ? commandPatterns.map((item) => `- ${item}`) : ["- none"]),
    ].join("\n"),
    runs,
    failurePatterns,
    critiquePatterns,
    toolLoopPatterns,
    commandPatterns,
    memoryHits: runs.length,
  };
}
