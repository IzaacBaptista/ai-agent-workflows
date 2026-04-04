import {
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

  if (run.artifacts.reviewerAssessment) {
    evidence.push("reviewer_assessment");
  }

  if (run.artifacts.result) {
    evidence.push("result_candidate");
  }

  return evidence;
}

export function buildWorkingMemory(run: WorkflowRunRecord): WorkingMemorySnapshot {
  return {
    workflowName: run.workflowName,
    triage: run.artifacts.triage,
    lastCritique: safeArray<WorkflowCritique>(run.artifacts.critiques).slice(-1)[0],
    toolCalls: safeArray<WorkflowToolCallRecord>(run.artifacts.toolCalls),
    delegations: safeArray<WorkflowDelegationRecord>(run.artifacts.delegations),
    forcedFinalizationReason:
      typeof run.artifacts.forcedFinalAnalysisReason === "string"
        ? run.artifacts.forcedFinalAnalysisReason
        : undefined,
    validationErrors: safeArray<WorkflowValidationError>(run.artifacts.validationErrors),
    evidence: buildEvidence(run),
  };
}

export function summarizeWorkingMemory(memory: WorkingMemorySnapshot): string {
  return [
    `Workflow: ${memory.workflowName}`,
    `Has triage: ${memory.triage ? "yes" : "no"}`,
    `Tool calls: ${memory.toolCalls.length}`,
    `Delegations: ${memory.delegations.length}`,
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
    delegationCount: memory.delegations.length,
  });
}
