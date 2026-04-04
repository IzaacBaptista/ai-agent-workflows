import {
  CommandExecutionResult,
  WorkflowCritique,
  WorkflowDelegationRecord,
  WorkflowRunRecord,
  WorkflowToolCallRecord,
  WorkflowValidationError,
  WorkingMemorySnapshot,
} from "../core/types";

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function getCommandStatus(result: CommandExecutionResult): string {
  if (result.timedOut) {
    return "timed_out";
  }

  return result.exitCode === 0 ? "passed" : "failed";
}

function buildCommandSignals(commandResults: CommandExecutionResult[]): string[] {
  return uniqueStrings(
    commandResults.map((result) => `${result.command}_${getCommandStatus(result)}`),
  );
}

function buildEvidence(run: WorkflowRunRecord): string[] {
  const evidence: string[] = [];

  if (run.artifacts.codeSearchResults) {
    evidence.push("code_search_results");
  }

  if (run.artifacts.fileReadResults) {
    evidence.push("file_read_results");
  }

  if (run.artifacts.externalApiResult) {
    evidence.push("external_api_result");
  }

  if (run.artifacts.commandResults) {
    evidence.push("command_results");
  }

  if (run.artifacts.gitStatusResult) {
    evidence.push("git_status_result");
  }

  if (run.artifacts.gitDiffResult) {
    evidence.push("git_diff_result");
  }

  if (run.artifacts.reviewerAssessment) {
    evidence.push("reviewer_assessment");
  }

  if (run.artifacts.result) {
    evidence.push("result_candidate");
  }

  return evidence;
}

export function buildWorkingMemory(run: WorkflowRunRecord): WorkingMemorySnapshot {
  const commandResults = safeArray<CommandExecutionResult>(run.artifacts.commandResults);

  return {
    workflowName: run.workflowName,
    triage: run.artifacts.triage,
    lastCritique: safeArray<WorkflowCritique>(run.artifacts.critiques).slice(-1)[0],
    toolCalls: safeArray<WorkflowToolCallRecord>(run.artifacts.toolCalls),
    delegations: safeArray<WorkflowDelegationRecord>(run.artifacts.delegations),
    commandResults,
    commandSignals: buildCommandSignals(commandResults),
    forcedFinalizationReason:
      typeof run.artifacts.forcedFinalAnalysisReason === "string"
        ? run.artifacts.forcedFinalAnalysisReason
        : undefined,
    validationErrors: safeArray<WorkflowValidationError>(run.artifacts.validationErrors),
    evidence: buildEvidence(run),
  };
}

export function summarizeWorkingMemory(memory: WorkingMemorySnapshot): string {
  const latestCommand = memory.commandResults[memory.commandResults.length - 1];

  return [
    `Workflow: ${memory.workflowName}`,
    `Has triage: ${memory.triage ? "yes" : "no"}`,
    `Tool calls: ${memory.toolCalls.length}`,
    `Delegations: ${memory.delegations.length}`,
    `Command results: ${memory.commandResults.length}`,
    `Command signals: ${memory.commandSignals.join(", ") || "none"}`,
    `Latest command: ${latestCommand ? `${latestCommand.command}:${getCommandStatus(latestCommand)}:${latestCommand.exitCode ?? "null"}` : "none"}`,
    `Last critique: ${memory.lastCritique?.summary ?? "none"}`,
    `Forced finalization reason: ${memory.forcedFinalizationReason ?? "none"}`,
    `Validation errors: ${memory.validationErrors.length}`,
    `Evidence: ${memory.evidence.join(", ") || "none"}`,
  ].join("\n");
}

export function getWorkingMemorySignature(memory: WorkingMemorySnapshot): string {
  return JSON.stringify({
    workflowName: memory.workflowName,
    triageSummary:
      memory.triage && typeof memory.triage === "object" && "summary" in memory.triage
        ? (memory.triage as { summary?: string }).summary ?? ""
        : "",
    lastCritique: memory.lastCritique?.summary ?? "",
    forcedFinalizationReason: memory.forcedFinalizationReason ?? "",
    validationErrors: memory.validationErrors.map((entry) => entry.message),
    evidence: memory.evidence,
    commandSignals: memory.commandSignals,
    commandResults: memory.commandResults.map((result) => ({
      command: result.command,
      status: getCommandStatus(result),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    })),
    delegationCount: memory.delegations.length,
  });
}

export function getCommandDecisionSignature(memory: WorkingMemorySnapshot): string {
  return JSON.stringify({
    workflowName: memory.workflowName,
    triageSummary:
      memory.triage && typeof memory.triage === "object" && "summary" in memory.triage
        ? (memory.triage as { summary?: string }).summary ?? ""
        : "",
    lastCritique: memory.lastCritique?.summary ?? "",
    forcedFinalizationReason: memory.forcedFinalizationReason ?? "",
    validationErrors: memory.validationErrors.map((entry) => entry.message),
    nonCommandEvidence: memory.evidence.filter((item) => item !== "command_results"),
    nonCommandToolCalls: memory.toolCalls
      .filter((call) => call.toolName !== "run_command")
      .map((call) => `${call.toolName}:${call.signature}:${call.suppressed ? "suppressed" : "executed"}`),
    delegationCount: memory.delegations.length,
  });
}
