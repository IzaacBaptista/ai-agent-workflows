import test from "node:test";
import assert from "node:assert/strict";
import {
  codePatchPlanSchema,
  reviewerAssessmentSchema,
  runtimeActionSchema,
  workflowCritiqueSchema,
  workflowPlanSchema,
  workflowReplanSchema,
} from "../core/actionSchemas";

// ─── runtimeActionSchema ─────────────────────────────────────────────────────

test("runtimeActionSchema accepts a valid analyze action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "analyze",
    stage: "triage",
    task: "Analyze the issue",
    reason: "Need triage first",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema accepts analyze with analysis stage", () => {
  const result = runtimeActionSchema.safeParse({
    type: "analyze",
    stage: "analysis",
    task: "Deep analysis",
    reason: "More depth needed",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema rejects analyze with invalid stage", () => {
  const result = runtimeActionSchema.safeParse({
    type: "analyze",
    stage: "unknown_stage",
    task: "task",
    reason: "reason",
  });
  assert.equal(result.success, false);
});

test("runtimeActionSchema accepts a valid tool_call action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "tool_call",
    toolName: "search_code",
    input: { terms: ["WorkflowRuntime"] },
    reason: "Need to search the codebase",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema accepts all valid tool names", () => {
  const toolNames = ["search_code", "read_file", "call_external_api", "run_command", "git_status", "git_diff"];
  for (const toolName of toolNames) {
    const result = runtimeActionSchema.safeParse({
      type: "tool_call",
      toolName,
      input: {},
      reason: "test",
    });
    assert.equal(result.success, true, `Expected tool_call with toolName="${toolName}" to be valid`);
  }
});

test("runtimeActionSchema rejects tool_call with unknown tool name", () => {
  const result = runtimeActionSchema.safeParse({
    type: "tool_call",
    toolName: "unknown_tool",
    input: {},
    reason: "reason",
  });
  assert.equal(result.success, false);
});

test("runtimeActionSchema accepts a valid edit_patch action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "edit_patch",
    task: "Fix the bug",
    files: ["src/core/workflowRuntime.ts"],
    reason: "Need to fix the bug",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema rejects edit_patch with empty files array", () => {
  const result = runtimeActionSchema.safeParse({
    type: "edit_patch",
    task: "Fix the bug",
    files: [],
    reason: "reason",
  });
  assert.equal(result.success, false);
});

test("runtimeActionSchema rejects edit_patch with more than 3 files", () => {
  const result = runtimeActionSchema.safeParse({
    type: "edit_patch",
    task: "Fix the bug",
    files: ["a.ts", "b.ts", "c.ts", "d.ts"],
    reason: "reason",
  });
  assert.equal(result.success, false);
});

test("runtimeActionSchema accepts a valid delegate action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "delegate",
    targetAgent: "ReviewerAgent",
    task: "Verify evidence",
    reason: "Need reviewer assessment",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema rejects delegate with unknown agent", () => {
  const result = runtimeActionSchema.safeParse({
    type: "delegate",
    targetAgent: "UnknownAgent",
    task: "task",
    reason: "reason",
  });
  assert.equal(result.success, false);
});

test("runtimeActionSchema accepts a valid critique action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "critique",
    task: "Review the output",
    reason: "Quality check",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema accepts a valid replan action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "replan",
    reason: "Need to change direction",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema accepts a valid finalize action", () => {
  const result = runtimeActionSchema.safeParse({
    type: "finalize",
    task: "Produce final output",
    reason: "All evidence gathered",
  });
  assert.equal(result.success, true);
});

test("runtimeActionSchema rejects unknown action type", () => {
  const result = runtimeActionSchema.safeParse({
    type: "unknown_type",
    task: "task",
    reason: "reason",
  });
  assert.equal(result.success, false);
});

test("runtimeActionSchema rejects action missing required fields", () => {
  const result = runtimeActionSchema.safeParse({
    type: "finalize",
    // missing task and reason
  });
  assert.equal(result.success, false);
});

// ─── workflowPlanSchema ──────────────────────────────────────────────────────

test("workflowPlanSchema accepts a valid plan", () => {
  const result = workflowPlanSchema.safeParse({
    summary: "Execute the workflow",
    actions: [
      { type: "finalize", task: "finish", reason: "done" },
    ],
  });
  assert.equal(result.success, true);
});

test("workflowPlanSchema rejects a plan with empty actions array", () => {
  const result = workflowPlanSchema.safeParse({
    summary: "Empty plan",
    actions: [],
  });
  assert.equal(result.success, false);
});

test("workflowPlanSchema rejects a plan with an invalid action", () => {
  const result = workflowPlanSchema.safeParse({
    summary: "Bad plan",
    actions: [{ type: "finalize" }], // missing task and reason
  });
  assert.equal(result.success, false);
});

test("workflowPlanSchema accepts multiple mixed actions", () => {
  const result = workflowPlanSchema.safeParse({
    summary: "Multi-step plan",
    actions: [
      { type: "analyze", stage: "triage", task: "triage", reason: "start" },
      { type: "tool_call", toolName: "search_code", input: {}, reason: "search" },
      { type: "finalize", task: "finish", reason: "done" },
    ],
  });
  assert.equal(result.success, true);
});

// ─── workflowReplanSchema ────────────────────────────────────────────────────

test("workflowReplanSchema accepts a valid replan", () => {
  const result = workflowReplanSchema.safeParse({
    summary: "Revised plan",
    actions: [
      { type: "finalize", task: "wrap up", reason: "enough data" },
    ],
  });
  assert.equal(result.success, true);
});

test("workflowReplanSchema rejects a replan with empty actions", () => {
  const result = workflowReplanSchema.safeParse({
    summary: "Empty replan",
    actions: [],
  });
  assert.equal(result.success, false);
});

// ─── workflowCritiqueSchema ──────────────────────────────────────────────────

test("workflowCritiqueSchema accepts a valid approved critique", () => {
  const result = workflowCritiqueSchema.safeParse({
    approved: true,
    summary: "Looks good",
    missingEvidence: [],
    confidence: "high",
  });
  assert.equal(result.success, true);
});

test("workflowCritiqueSchema accepts a critique with nextAction", () => {
  const result = workflowCritiqueSchema.safeParse({
    approved: false,
    summary: "Missing evidence",
    missingEvidence: ["Test coverage data"],
    confidence: "low",
    nextAction: { type: "tool_call", toolName: "run_command", input: { command: "test" }, reason: "need test run" },
  });
  assert.equal(result.success, true);
});

test("workflowCritiqueSchema rejects invalid confidence level", () => {
  const result = workflowCritiqueSchema.safeParse({
    approved: true,
    summary: "ok",
    missingEvidence: [],
    confidence: "extreme",
  });
  assert.equal(result.success, false);
});

test("workflowCritiqueSchema rejects critique missing required fields", () => {
  const result = workflowCritiqueSchema.safeParse({
    approved: true,
    // missing summary, missingEvidence, confidence
  });
  assert.equal(result.success, false);
});

// ─── reviewerAssessmentSchema ────────────────────────────────────────────────

test("reviewerAssessmentSchema accepts a valid assessment", () => {
  const result = reviewerAssessmentSchema.safeParse({
    supported: true,
    summary: "Evidence is strong",
    missingEvidence: [],
  });
  assert.equal(result.success, true);
});

test("reviewerAssessmentSchema accepts assessment with recommendedAction", () => {
  const result = reviewerAssessmentSchema.safeParse({
    supported: false,
    summary: "More evidence needed",
    missingEvidence: ["Run tests"],
    recommendedAction: { type: "tool_call", toolName: "run_command", input: {}, reason: "run tests" },
  });
  assert.equal(result.success, true);
});

test("reviewerAssessmentSchema rejects assessment missing required fields", () => {
  const result = reviewerAssessmentSchema.safeParse({
    supported: true,
    // missing summary and missingEvidence
  });
  assert.equal(result.success, false);
});

// ─── codePatchPlanSchema ─────────────────────────────────────────────────────

test("codePatchPlanSchema accepts a valid patch plan", () => {
  const result = codePatchPlanSchema.safeParse({
    summary: "Fix the null pointer",
    edits: [
      {
        path: "src/core/workflowRuntime.ts",
        changeType: "update",
        content: "export const x = 1;",
        reason: "Fix null check",
      },
    ],
  });
  assert.equal(result.success, true);
});

test("codePatchPlanSchema accepts patch plan with optional validationCommand", () => {
  const result = codePatchPlanSchema.safeParse({
    summary: "Fix and build",
    edits: [
      {
        path: "src/index.ts",
        changeType: "update",
        content: "// updated",
        reason: "update",
      },
    ],
    validationCommand: "build",
  });
  assert.equal(result.success, true);
});

test("codePatchPlanSchema accepts patch plan with create changeType", () => {
  const result = codePatchPlanSchema.safeParse({
    summary: "Create a new file",
    edits: [
      {
        path: "src/new-file.ts",
        changeType: "create",
        content: "export {};",
        reason: "New module",
      },
    ],
  });
  assert.equal(result.success, true);
});

test("codePatchPlanSchema rejects more than 3 edits", () => {
  const result = codePatchPlanSchema.safeParse({
    summary: "Too many edits",
    edits: [
      { path: "a.ts", changeType: "update", content: "a", reason: "r" },
      { path: "b.ts", changeType: "update", content: "b", reason: "r" },
      { path: "c.ts", changeType: "update", content: "c", reason: "r" },
      { path: "d.ts", changeType: "update", content: "d", reason: "r" },
    ],
  });
  assert.equal(result.success, false);
});

test("codePatchPlanSchema rejects invalid validationCommand", () => {
  const result = codePatchPlanSchema.safeParse({
    summary: "Fix",
    edits: [],
    validationCommand: "run_all_tests",
  });
  assert.equal(result.success, false);
});

test("codePatchPlanSchema accepts all valid validation commands", () => {
  for (const command of ["build", "test", "lint"] as const) {
    const result = codePatchPlanSchema.safeParse({
      summary: "Validate",
      edits: [],
      validationCommand: command,
    });
    assert.equal(result.success, true, `Expected validationCommand="${command}" to be valid`);
  }
});

test("codePatchPlanSchema rejects edit with empty path", () => {
  const result = codePatchPlanSchema.safeParse({
    summary: "Fix",
    edits: [
      { path: "   ", changeType: "update", content: "content", reason: "r" },
    ],
  });
  assert.equal(result.success, false);
});
