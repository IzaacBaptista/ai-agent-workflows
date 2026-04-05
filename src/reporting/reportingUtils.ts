import {
  WorkflowExecutionMeta,
  WorkflowResult,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowToolCallRecord,
} from "../core/types";

export interface WorkflowStepGroup {
  logicalId: string;
  displayName: string;
  attempts: WorkflowStepRecord[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateText(value: string | undefined, limit = 160): string {
  if (!value) {
    return "";
  }

  const normalized = normalizeText(value);
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

function getToolCallRecords(runRecord: WorkflowRunRecord | null): WorkflowToolCallRecord[] {
  if (!runRecord) {
    return [];
  }

  const records = runRecord.artifacts?.toolCalls;
  return Array.isArray(records) ? (records as WorkflowToolCallRecord[]) : [];
}

function getRunCommandLabel(step: WorkflowStepRecord, runRecord: WorkflowRunRecord | null): string {
  const toolCalls = getToolCallRecords(runRecord);
  const exactMatch = toolCalls.find((record) => record.signature === step.signature);
  const prefixedMatch =
    exactMatch ??
    toolCalls.find(
      (record) =>
        typeof step.signature === "string" &&
        step.signature.startsWith(`${record.signature}:`) &&
        record.toolName === "run_command",
    );

  const request = prefixedMatch?.request;
  if (
    request &&
    typeof request === "object" &&
    "command" in request &&
    typeof request.command === "string"
  ) {
    return `run_command:${request.command}`;
  }

  return "run_command";
}

export function getStepDisplayName(
  step: WorkflowStepRecord,
  runRecord: WorkflowRunRecord | null,
): string {
  if (step.name === "tool_call" && step.toolName) {
    if (step.toolName === "run_command") {
      return `tool_call(${getRunCommandLabel(step, runRecord)})`;
    }

    return `tool_call(${step.toolName})`;
  }

  if (step.name === "delegate" && step.targetAgent) {
    return `delegate(${step.targetAgent})`;
  }

  return step.name;
}

function getLogicalStepId(stepId: string): string {
  const segments = stepId.split(":");
  if (segments.length < 3) {
    return stepId;
  }

  return `${segments.slice(0, -1).join(":")}`;
}

export function groupWorkflowSteps(runRecord: WorkflowRunRecord | null): WorkflowStepGroup[] {
  if (!runRecord) {
    return [];
  }

  const groups: WorkflowStepGroup[] = [];
  const groupIndex = new Map<string, WorkflowStepGroup>();

  for (const step of runRecord.steps) {
    const logicalId = getLogicalStepId(step.stepId);
    const existing = groupIndex.get(logicalId);

    if (existing) {
      existing.attempts.push(step);
      continue;
    }

    const created: WorkflowStepGroup = {
      logicalId,
      displayName: getStepDisplayName(step, runRecord),
      attempts: [step],
    };
    groupIndex.set(logicalId, created);
    groups.push(created);
  }

  return groups;
}

export function buildHighLevelFlow(runRecord: WorkflowRunRecord | null): string {
  const groups = groupWorkflowSteps(runRecord);
  const collapsed: string[] = [];

  for (const group of groups) {
    if (collapsed[collapsed.length - 1] !== group.displayName) {
      collapsed.push(group.displayName);
    }
  }

  return collapsed.join(" → ");
}

function getLastFailedStep(runRecord: WorkflowRunRecord | null): WorkflowStepRecord | undefined {
  if (!runRecord) {
    return undefined;
  }

  return [...runRecord.steps].reverse().find((step) => step.status === "failed");
}

export function extractFailureSummary<T>(
  result: WorkflowResult<T>,
  runRecord: WorkflowRunRecord | null,
): string {
  if (!result.success) {
    return truncateText(result.error, 200);
  }

  if (runRecord?.error) {
    return truncateText(runRecord.error, 200);
  }

  return truncateText(getLastFailedStep(runRecord)?.error, 200);
}

function getObjectSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if ("summary" in value && typeof value.summary === "string") {
    return value.summary;
  }

  return undefined;
}

export function extractResultSummary<T>(
  result: WorkflowResult<T>,
  runRecord: WorkflowRunRecord | null,
): string | undefined {
  if (result.success) {
    const summary = getObjectSummary(result.data);
    if (summary) {
      return truncateText(summary, 200);
    }
  }

  const artifactSummary = getObjectSummary(runRecord?.artifacts?.result);
  if (artifactSummary) {
    return truncateText(artifactSummary, 200);
  }

  const finalStep = [...(runRecord?.steps ?? [])]
    .reverse()
    .find((step) => step.name === "finalize" && step.status === "completed");

  return truncateText(finalStep?.outputSummary, 200) || undefined;
}

export function getHumanOutcomeLabel<T>(result: WorkflowResult<T>): string {
  return result.success ? "succeeded" : "failed";
}

function countFailedAttempts(
  runRecord: WorkflowRunRecord | null,
  stepName: string,
  pattern?: RegExp,
): number {
  return (runRecord?.steps ?? []).filter(
    (step) =>
      step.name === stepName &&
      step.status === "failed" &&
      (pattern ? pattern.test(step.error ?? "") : true),
  ).length;
}

function hasStepAttempt(
  runRecord: WorkflowRunRecord | null,
  name: string,
  predicate?: (step: WorkflowStepRecord) => boolean,
): boolean {
  return (runRecord?.steps ?? []).some(
    (step) => step.name === name && !step.suppressed && (!predicate || predicate(step)),
  );
}

function hasCompletedStep(
  runRecord: WorkflowRunRecord | null,
  name: string,
  predicate?: (step: WorkflowStepRecord) => boolean,
): boolean {
  return (runRecord?.steps ?? []).some(
    (step) => step.name === name && step.status === "completed" && !step.blocked && (!predicate || predicate(step)),
  );
}

function formatOccurrence(count: number): string {
  if (count <= 1) {
    return "once";
  }

  if (count === 2) {
    return "twice";
  }

  return `${count} times`;
}

export function buildNarrativeWhatHappened<T>(
  result: WorkflowResult<T>,
  runRecord: WorkflowRunRecord | null,
): string[] {
  const bullets: string[] = [];
  const meta = result.meta;
  const attemptedSearch = hasStepAttempt(runRecord, "tool_call", (step) => step.toolName === "search_code");
  const attemptedRead = hasStepAttempt(runRecord, "tool_call", (step) => step.toolName === "read_file");
  const attemptedCommands = hasStepAttempt(runRecord, "tool_call", (step) => step.toolName === "run_command");
  const usedSearch = hasCompletedStep(runRecord, "tool_call", (step) => step.toolName === "search_code");
  const usedRead = hasCompletedStep(runRecord, "tool_call", (step) => step.toolName === "read_file");
  const usedCommands = hasCompletedStep(runRecord, "tool_call", (step) => step.toolName === "run_command");
  const usedDelegation =
    meta.delegationCount > 0 ||
    (runRecord?.steps ?? []).some(
      (step) => step.actionType === "delegate" && step.status === "completed" && !step.blocked,
    );
  const usedEditPatch =
    meta.editActionCount > 0 ||
    (runRecord?.steps ?? []).some(
      (step) => step.actionType === "edit_patch" && step.status === "completed" && !step.blocked,
    );
  const hasFinalize = (runRecord?.steps ?? []).some((step) => step.name === "finalize");
  const finalizeTimeouts = countFailedAttempts(runRecord, "finalize", /timed out/i);
  const failureSummary = extractFailureSummary(result, runRecord).toLowerCase();
  const hasToolAttempt = attemptedSearch || attemptedRead || attemptedCommands;

  if (!hasToolAttempt && !usedDelegation && !usedEditPatch) {
    bullets.push("The system analyzed the issue without using tools.");
  } else if (attemptedSearch && attemptedRead) {
    bullets.push(
      usedSearch && usedRead
        ? "The system performed iterative investigation using code search and file reads."
        : "The system attempted iterative investigation using code search and file reads.",
    );
  } else if (attemptedSearch) {
    bullets.push(
      usedSearch
        ? "The system investigated the repository using code search."
        : "The system attempted to investigate the repository using code search.",
    );
  } else if (attemptedRead) {
    bullets.push(
      usedRead
        ? "The system inspected repository files directly."
        : "The system attempted to inspect repository files directly.",
    );
  } else if (attemptedCommands) {
    bullets.push(
      usedCommands
        ? "The system gathered executable evidence with local command runs."
        : "The system attempted to gather executable evidence with local command runs.",
    );
  }

  if (meta.replanCount >= 2) {
    bullets.push("It repeatedly refined its plan based on new findings.");
  }

  if (usedDelegation) {
    bullets.push("It delegated part of the verification to another agent.");
  } else if (usedEditPatch) {
    bullets.push("It attempted an autonomous code patch.");
  } else if (hasFinalize && !hasToolAttempt && finalizeTimeouts > 0) {
    bullets.push("It attempted to generate a final proposal.");
  }

  if (finalizeTimeouts > 0) {
    bullets.push(`The finalize step timed out ${formatOccurrence(finalizeTimeouts)}.`);
  } else if (!result.success && failureSummary.includes("maxsteps")) {
    bullets.push("It did not converge before hitting the execution limit.");
  }

  return bullets.slice(0, 3);
}

export function humanizeFailureSummary<T>(
  result: WorkflowResult<T>,
  runRecord: WorkflowRunRecord | null,
): string {
  const failure = extractFailureSummary(result, runRecord);
  const timedOutMatch = failure.match(/^Step "([^"]+)" timed out$/i);
  if (timedOutMatch?.[1]) {
    return `The ${timedOutMatch[1]} step exceeded the allowed execution time.`;
  }

  const maxStepsMatch = failure.match(/maxSteps=(\d+)/);
  if (maxStepsMatch?.[1]) {
    return `Execution policy exceeded maxSteps=${maxStepsMatch[1]}.`;
  }

  return failure;
}

export function getBehaviorSignal(meta: WorkflowExecutionMeta, runRecord: WorkflowRunRecord | null): string | undefined {
  const failure = (runRecord?.error ?? "").toLowerCase();
  const forcedReason = String(runRecord?.artifacts?.forcedFinalAnalysisReason ?? "").toLowerCase();
  const hasDelegateStep = (runRecord?.steps ?? []).some(
    (step) => step.actionType === "delegate" && !step.suppressed,
  );
  const hasEditPatchStep = (runRecord?.steps ?? []).some(
    (step) => step.actionType === "edit_patch" && !step.suppressed,
  );
  const hasToolStep = (runRecord?.steps ?? []).some(
    (step) => step.actionType === "tool_call" && !step.suppressed,
  );
  const hasLoopSignal =
    meta.replanCount >= 3 || failure.includes("maxsteps") || forcedReason.includes("no progress");

  if (meta.editActionCount > 0 || hasEditPatchStep) {
    return "autonomous patch attempt";
  }

  if (meta.delegationCount > 0 || hasDelegateStep) {
    return "delegated verification";
  }

  if (hasLoopSignal && hasToolStep) {
    return "iterative investigation with replanning loop";
  }

  if (meta.toolCallCount > 0 || hasToolStep) {
    return "tool-driven investigation";
  }

  if (!hasToolStep && meta.editActionCount === 0 && meta.delegationCount === 0) {
    return "pure reasoning (no tool usage)";
  }

  return undefined;
}
