import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkflowExecutionMeta,
  WorkflowExecutionPolicy,
  WorkflowResult,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from "../core/types";
import {
  buildNarrativeWhatHappened,
  extractFailureSummary,
  extractResultSummary,
  getBehaviorSignal,
  getHumanOutcomeLabel,
  groupWorkflowSteps,
  getStepDisplayName,
  humanizeFailureSummary,
  truncateText,
} from "../reporting/reportingUtils";

const defaultPolicy: WorkflowExecutionPolicy = {
  maxSteps: 10,
  maxRetriesPerStep: 1,
  timeoutMs: 60_000,
  maxConsecutiveNoProgress: 2,
  maxToolCalls: 5,
  maxRepeatedIdenticalToolCalls: 2,
  maxEditActionsPerRun: 2,
  maxFilesPerEditAction: 3,
  maxDelegationsPerRun: 2,
  maxDelegationDepth: 1,
  maxCriticRedirects: 2,
};

function createMeta(overrides: Partial<WorkflowExecutionMeta> = {}): WorkflowExecutionMeta {
  return {
    runId: "run-123",
    workflowName: "TestWorkflow",
    status: "completed",
    stepCount: 3,
    critiqueCount: 0,
    replanCount: 0,
    toolCallCount: 0,
    editActionCount: 0,
    delegationCount: 0,
    maxDelegationDepthReached: 0,
    memoryHits: 0,
    criticRedirectCount: 0,
    ...overrides,
  };
}

function createRunRecord(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    runId: "run-123",
    workflowName: "TestWorkflow",
    status: "completed",
    input: "test input",
    startedAt: "2026-04-05T13:00:00.000Z",
    completedAt: "2026-04-05T13:01:00.000Z",
    policy: defaultPolicy,
    steps: [],
    artifacts: {},
    ...overrides,
  };
}

function createStep(overrides: Partial<WorkflowStepRecord> = {}): WorkflowStepRecord {
  return {
    stepId: "plan:1:1",
    name: "plan",
    status: "completed",
    attempt: 1,
    startedAt: "2026-04-05T13:00:00.000Z",
    ...overrides,
  };
}

// ─── truncateText ─────────────────────────────────────────────────────────────

test("truncateText returns empty string for undefined", () => {
  assert.equal(truncateText(undefined), "");
});

test("truncateText returns empty string for empty string", () => {
  assert.equal(truncateText(""), "");
});

test("truncateText returns short text unchanged", () => {
  assert.equal(truncateText("hello world"), "hello world");
});

test("truncateText truncates long text with ellipsis at default limit", () => {
  const long = "a".repeat(200);
  const result = truncateText(long);
  assert.equal(result.length, 160);
  assert.ok(result.endsWith("..."));
});

test("truncateText respects custom limit", () => {
  const text = "a".repeat(100);
  const result = truncateText(text, 50);
  assert.equal(result.length, 50);
  assert.ok(result.endsWith("..."));
});

test("truncateText normalizes whitespace", () => {
  const result = truncateText("hello   world\n\nfoo");
  assert.equal(result, "hello world foo");
});

test("truncateText does not truncate text at exactly the limit", () => {
  const text = "a".repeat(160);
  const result = truncateText(text, 160);
  assert.equal(result, text);
  assert.ok(!result.endsWith("..."));
});

// ─── getStepDisplayName ───────────────────────────────────────────────────────

test("getStepDisplayName returns tool_call(toolName) for tool_call steps", () => {
  const step = createStep({ name: "tool_call", toolName: "search_code", actionType: "tool_call" });
  assert.equal(getStepDisplayName(step, null), "tool_call(search_code)");
});

test("getStepDisplayName returns tool_call(run_command:command) when matching tool call record", () => {
  const step = createStep({
    name: "tool_call",
    toolName: "run_command",
    signature: "tool:run_command:build",
    actionType: "tool_call",
  });
  const runRecord = createRunRecord({
    artifacts: {
      toolCalls: [
        {
          toolName: "run_command",
          signature: "tool:run_command:build",
          request: { command: "build" },
          suppressed: false,
          cached: false,
          workingMemorySignature: "wm-1",
          createdAt: "2026-04-05T13:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(getStepDisplayName(step, runRecord), "tool_call(run_command:build)");
});

test("getStepDisplayName returns run_command label for run_command without matching record", () => {
  const step = createStep({ name: "tool_call", toolName: "run_command", actionType: "tool_call" });
  assert.equal(getStepDisplayName(step, null), "tool_call(run_command)");
});

test("getStepDisplayName returns delegate(agentName) for delegate steps", () => {
  const step = createStep({ name: "delegate", targetAgent: "ReviewerAgent", actionType: "delegate" });
  assert.equal(getStepDisplayName(step, null), "delegate(ReviewerAgent)");
});

test("getStepDisplayName returns step name for non-tool and non-delegate steps", () => {
  const step = createStep({ name: "finalize", actionType: "finalize" });
  assert.equal(getStepDisplayName(step, null), "finalize");
});

// ─── groupWorkflowSteps ───────────────────────────────────────────────────────

test("groupWorkflowSteps returns empty array for null run record", () => {
  assert.deepEqual(groupWorkflowSteps(null), []);
});

test("groupWorkflowSteps groups retry attempts under same logical ID", () => {
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "finalize:1:1", name: "finalize", attempt: 1 }),
      createStep({ stepId: "finalize:1:2", name: "finalize", attempt: 2 }),
    ],
  });
  const groups = groupWorkflowSteps(runRecord);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].attempts.length, 2);
});

test("groupWorkflowSteps creates separate groups for different steps", () => {
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "plan:1:1", name: "plan" }),
      createStep({ stepId: "finalize:2:1", name: "finalize" }),
    ],
  });
  const groups = groupWorkflowSteps(runRecord);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].displayName, "plan");
  assert.equal(groups[1].displayName, "finalize");
});

test("groupWorkflowSteps handles short stepId without enough segments", () => {
  const runRecord = createRunRecord({
    steps: [createStep({ stepId: "plan", name: "plan" })],
  });
  const groups = groupWorkflowSteps(runRecord);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].logicalId, "plan");
});

// ─── extractFailureSummary ────────────────────────────────────────────────────

test("extractFailureSummary returns error from failed result", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Step \"finalize\" timed out",
    meta: createMeta({ status: "failed" }),
  };
  const summary = extractFailureSummary(result, null);
  assert.match(summary, /finalize.*timed out/i);
});

test("extractFailureSummary returns run record error for success result with run error", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "done" },
    meta: createMeta(),
  };
  const runRecord = createRunRecord({ error: "Run-level error occurred" });
  const summary = extractFailureSummary(result, runRecord);
  assert.match(summary, /Run-level error occurred/);
});

test("extractFailureSummary returns last failed step error when result succeeded", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "done" },
    meta: createMeta(),
  };
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "finalize:1:1", name: "finalize", status: "failed", error: "last step failed" }),
    ],
  });
  const summary = extractFailureSummary(result, runRecord);
  assert.match(summary, /last step failed/);
});

test("extractFailureSummary returns empty string when success with no errors", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "done" },
    meta: createMeta(),
  };
  const summary = extractFailureSummary(result, createRunRecord());
  assert.equal(summary, "");
});

// ─── extractResultSummary ─────────────────────────────────────────────────────

test("extractResultSummary returns summary from success data", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "Workflow completed successfully" },
    meta: createMeta(),
  };
  const summary = extractResultSummary(result, null);
  assert.equal(summary, "Workflow completed successfully");
});

test("extractResultSummary returns summary from run artifact result when not in data", () => {
  const result: WorkflowResult<Record<string, unknown>> = {
    success: false,
    error: "some error",
    meta: createMeta({ status: "failed" }),
  };
  const runRecord = createRunRecord({
    artifacts: { result: { summary: "Artifact result summary" } },
  });
  const summary = extractResultSummary(result, runRecord);
  assert.equal(summary, "Artifact result summary");
});

test("extractResultSummary returns finalize step outputSummary as fallback", () => {
  const result: WorkflowResult<Record<string, unknown>> = {
    success: false,
    error: "failed",
    meta: createMeta({ status: "failed" }),
  };
  const runRecord = createRunRecord({
    steps: [
      createStep({
        stepId: "finalize:1:1",
        name: "finalize",
        status: "completed",
        outputSummary: "Final output summary text",
        actionType: "finalize",
      }),
    ],
  });
  const summary = extractResultSummary(result, runRecord);
  assert.equal(summary, "Final output summary text");
});

test("extractResultSummary returns undefined when no summary is available", () => {
  const result: WorkflowResult<Record<string, unknown>> = {
    success: false,
    error: "failed",
    meta: createMeta({ status: "failed" }),
  };
  const summary = extractResultSummary(result, createRunRecord());
  assert.equal(summary, undefined);
});

// ─── getHumanOutcomeLabel ─────────────────────────────────────────────────────

test("getHumanOutcomeLabel returns succeeded for success result", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "done" },
    meta: createMeta(),
  };
  assert.equal(getHumanOutcomeLabel(result), "succeeded");
});

test("getHumanOutcomeLabel returns failed for failure result", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "error",
    meta: createMeta({ status: "failed" }),
  };
  assert.equal(getHumanOutcomeLabel(result), "failed");
});

// ─── humanizeFailureSummary ───────────────────────────────────────────────────

test("humanizeFailureSummary humanizes rate limit errors", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Request failed with status code 429",
    meta: createMeta({ status: "failed" }),
  };
  const humanized = humanizeFailureSummary(result, null);
  assert.match(humanized, /rate-limited/i);
});

test("humanizeFailureSummary includes retry time for rate limit with retry-after", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Request failed with status code 429 — retry after approximately 30s",
    meta: createMeta({ status: "failed" }),
  };
  const humanized = humanizeFailureSummary(result, null);
  assert.match(humanized, /Retry after approximately 30s/);
});

test("humanizeFailureSummary humanizes step timeout errors", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: 'Step "finalize" timed out',
    meta: createMeta({ status: "failed" }),
  };
  const humanized = humanizeFailureSummary(result, null);
  assert.match(humanized, /finalize step exceeded the allowed execution time/i);
});

test("humanizeFailureSummary humanizes maxSteps exceeded errors", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Execution policy exceeded maxSteps=10 for workflow",
    meta: createMeta({ status: "failed" }),
  };
  const humanized = humanizeFailureSummary(result, null);
  assert.match(humanized, /maxSteps=10/);
});

test("humanizeFailureSummary returns raw failure for unrecognized errors", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Some unexpected error message",
    meta: createMeta({ status: "failed" }),
  };
  const humanized = humanizeFailureSummary(result, null);
  assert.equal(humanized, "Some unexpected error message");
});

// ─── getBehaviorSignal ────────────────────────────────────────────────────────

test("getBehaviorSignal returns autonomous patch attempt when edit actions were used", () => {
  const meta = createMeta({ editActionCount: 1 });
  const signal = getBehaviorSignal(meta, null);
  assert.equal(signal, "autonomous patch attempt");
});

test("getBehaviorSignal returns delegated verification when delegation count is non-zero", () => {
  const meta = createMeta({ delegationCount: 1 });
  const signal = getBehaviorSignal(meta, null);
  assert.equal(signal, "delegated verification");
});

test("getBehaviorSignal returns tool-driven investigation for tool-only runs", () => {
  const meta = createMeta({ toolCallCount: 2 });
  const signal = getBehaviorSignal(meta, null);
  assert.equal(signal, "tool-driven investigation");
});

test("getBehaviorSignal returns pure reasoning when no tool or action counts", () => {
  const meta = createMeta();
  const signal = getBehaviorSignal(meta, null);
  assert.equal(signal, "pure reasoning (no tool usage)");
});

test("getBehaviorSignal returns iterative investigation with replanning loop on high replan count", () => {
  const meta = createMeta({ replanCount: 3, toolCallCount: 2 });
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "tool_call:1:1", name: "tool_call", actionType: "tool_call" }),
    ],
  });
  const signal = getBehaviorSignal(meta, runRecord);
  assert.equal(signal, "iterative investigation with replanning loop");
});

test("getBehaviorSignal returns planning interrupted by external dependency on rate limit during planning", () => {
  const meta = createMeta();
  const runRecord = createRunRecord({
    error: "Request failed with status code 429",
    steps: [
      createStep({ stepId: "plan:1:1", name: "plan", actionType: "plan" }),
    ],
  });
  const signal = getBehaviorSignal(meta, runRecord);
  assert.equal(signal, "planning interrupted by external dependency");
});

// ─── buildNarrativeWhatHappened ───────────────────────────────────────────────

test("buildNarrativeWhatHappened returns planning failure bullet when only planning steps exist", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Plan failed",
    meta: createMeta({ status: "failed" }),
  };
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "plan:1:1", name: "plan", status: "failed", error: "Plan failed" }),
    ],
  });
  const bullets = buildNarrativeWhatHappened(result, runRecord);
  assert.ok(bullets.some((b) => b.includes("planning")));
});

test("buildNarrativeWhatHappened returns code search bullet when search_code was used", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "done" },
    meta: createMeta({ toolCallCount: 1 }),
  };
  const runRecord = createRunRecord({
    steps: [
      createStep({
        stepId: "tool_call:1:1",
        name: "tool_call",
        status: "completed",
        actionType: "tool_call",
        toolName: "search_code",
      }),
    ],
  });
  const bullets = buildNarrativeWhatHappened(result, runRecord);
  assert.ok(bullets.some((b) => b.includes("code search")));
});

test("buildNarrativeWhatHappened returns analysis bullet when only analyze steps ran without tools", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "done" },
    meta: createMeta(),
  };
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "analyze:1:1", name: "analyze", status: "completed", actionType: "analyze" }),
    ],
  });
  const bullets = buildNarrativeWhatHappened(result, runRecord);
  assert.ok(bullets.some((b) => b.includes("without using tools")));
});

test("buildNarrativeWhatHappened caps output at 3 bullets", () => {
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Execution policy exceeded maxSteps=10",
    meta: createMeta({ status: "failed", replanCount: 3, toolCallCount: 2, delegationCount: 1 }),
  };
  const runRecord = createRunRecord({
    steps: [
      createStep({ stepId: "tool_call:1:1", name: "tool_call", status: "completed", toolName: "search_code", actionType: "tool_call" }),
      createStep({ stepId: "tool_call:2:1", name: "tool_call", status: "completed", toolName: "read_file", actionType: "tool_call" }),
      createStep({ stepId: "delegate:3:1", name: "delegate", status: "completed", targetAgent: "ReviewerAgent", actionType: "delegate" }),
    ],
  });
  const bullets = buildNarrativeWhatHappened(result, runRecord);
  assert.ok(bullets.length <= 3);
});
