import {
  AppliedCodePatchResult,
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

function buildPatchSignals(patchResults: AppliedCodePatchResult[]): string[] {
  return uniqueStrings(
    patchResults.flatMap((result) => {
      const validationOutcome = result.validationOutcome ?? "not_run";
      const unexpectedChangedFiles = result.unexpectedChangedFiles ?? [];
      const signals = [`patch_${validationOutcome}`];

      if (result.validationCommand) {
        signals.push(`patch_${result.validationCommand}_${validationOutcome}`);
      }

      if (unexpectedChangedFiles.length > 0) {
        signals.push("patch_unexpected_changes");
      }

      if (result.worktreeCleanedUp === false) {
        signals.push("patch_cleanup_failed");
      }

      return signals;
    }),
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

  if (run.artifacts.patchResults) {
    evidence.push("patch_results");
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
  const patchResults = safeArray<AppliedCodePatchResult>(run.artifacts.patchResults);

  return {
    workflowName: run.workflowName,
    triage: run.artifacts.triage,
    lastCritique: safeArray<WorkflowCritique>(run.artifacts.critiques).slice(-1)[0],
    toolCalls: safeArray<WorkflowToolCallRecord>(run.artifacts.toolCalls),
    patchResults,
    patchSignals: buildPatchSignals(patchResults),
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
  const latestPatch = memory.patchResults[memory.patchResults.length - 1];

  return [
    `Workflow: ${memory.workflowName}`,
    `Has triage: ${memory.triage ? "yes" : "no"}`,
    `Tool calls: ${memory.toolCalls.length}`,
    `Patch results: ${memory.patchResults.length}`,
    `Patch signals: ${memory.patchSignals.join(", ") || "none"}`,
    `Delegations: ${memory.delegations.length}`,
    `Command results: ${memory.commandResults.length}`,
    `Command signals: ${memory.commandSignals.join(", ") || "none"}`,
    `Latest command: ${latestCommand ? `${latestCommand.command}:${getCommandStatus(latestCommand)}:${latestCommand.exitCode ?? "null"}` : "none"}`,
    `Latest patch: ${
      latestPatch
        ? `${latestPatch.edits.length} edits${latestPatch.validationCommand ? ` validated with ${latestPatch.validationCommand}` : ""}, outcome=${latestPatch.validationOutcome ?? "not_run"}, unexpectedChangedFiles=${latestPatch.unexpectedChangedFiles?.length ?? 0}, cleanup=${latestPatch.worktreeCleanedUp === false ? "failed" : "ok"}`
        : "none"
    }`,
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
    patchResults: memory.patchResults.map((result) => ({
      edits: result.edits.map((edit) => `${edit.changeType}:${edit.path}`),
      validationCommand: result.validationCommand ?? "",
      validationOutcome: result.validationOutcome ?? "not_run",
      unexpectedChangedFiles: result.unexpectedChangedFiles ?? [],
      worktreeCleanedUp: result.worktreeCleanedUp ?? true,
    })),
    patchSignals: memory.patchSignals,
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
    patchResults: memory.patchResults.map((result) => ({
      edits: result.edits.map((edit) => `${edit.changeType}:${edit.path}`),
      validationCommand: result.validationCommand ?? "",
      validationOutcome: result.validationOutcome ?? "not_run",
      unexpectedChangedFiles: result.unexpectedChangedFiles ?? [],
      worktreeCleanedUp: result.worktreeCleanedUp ?? true,
    })),
    patchSignals: memory.patchSignals,
    nonCommandToolCalls: memory.toolCalls
      .filter((call) => call.toolName !== "run_command")
      .map((call) => `${call.toolName}:${call.signature}:${call.suppressed ? "suppressed" : "executed"}`),
    delegationCount: memory.delegations.length,
  });
}
