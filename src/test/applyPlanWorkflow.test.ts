import test from "node:test";
import assert from "node:assert/strict";
import * as llmClient from "../core/llmClient";
import {
  setCodePatchApplierForTesting,
  setEditableFileContextLoaderForTesting,
} from "../tools/editPatchTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";
import { runApplyPlanWorkflow } from "../workflows/applyPlanWorkflow";
import { JiraAnalysis } from "../core/types";

function buildLlmResponse(payload: Record<string, unknown>): { output_text: string } {
  return { output_text: JSON.stringify(payload) };
}

function makeAnalysis(overrides: Partial<JiraAnalysis> = {}): JiraAnalysis {
  return {
    summary: "Add a new feature",
    implementationPlan: ["Step 1: update foo.ts"],
    acceptanceCriteria: ["Feature works correctly"],
    risks: [],
    testScenarios: [],
    suggestedBranchName: "feat/test-123",
    suggestedPRTitle: "feat: test feature",
    ...overrides,
  };
}

const MOCK_PATCH_PLAN = {
  summary: "Apply feature",
  edits: [
    {
      path: "src/foo.ts",
      changeType: "update" as const,
      content: "export const foo = 1;",
      reason: "update foo",
    },
  ],
};

const MOCK_APPLIED_RESULT = {
  summary: "Applied feature",
  edits: [{ path: "src/foo.ts", changeType: "update" as const, bytesWritten: 20 }],
  validationOutcome: "not_run" as const,
  unexpectedChangedFiles: [],
  isolationMode: "direct" as const,
};

test("runApplyPlanWorkflow returns success with applied patch", async () => {
  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => buildLlmResponse(MOCK_PATCH_PLAN);

  setEditableFileContextLoaderForTesting(() => []);
  setCodePatchApplierForTesting(() => MOCK_APPLIED_RESULT);

  try {
    const result = await runApplyPlanWorkflow("TEST-1", makeAnalysis());

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.deepEqual(result.patchResult, MOCK_APPLIED_RESULT);
    assert.equal(result.validationResult, undefined);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
  }
});

test("runApplyPlanWorkflow returns failure when CoderAgent throws", async () => {
  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    throw new Error("LLM unavailable");
  };

  try {
    const result = await runApplyPlanWorkflow("TEST-2", makeAnalysis());

    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /CoderAgent failed/);
    assert.match(result.error, /LLM unavailable/);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runApplyPlanWorkflow returns failure when CoderAgent produces no edits", async () => {
  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () =>
    buildLlmResponse({ summary: "no changes needed", edits: [] });

  try {
    const result = await runApplyPlanWorkflow("TEST-3", makeAnalysis());

    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /no file edits/i);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runApplyPlanWorkflow returns failure when applyCodePatchPlan throws", async () => {
  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => buildLlmResponse(MOCK_PATCH_PLAN);

  setEditableFileContextLoaderForTesting(() => []);
  setCodePatchApplierForTesting(() => {
    throw new Error("cannot write outside allowed scope");
  });

  try {
    const result = await runApplyPlanWorkflow("TEST-4", makeAnalysis());

    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /Patch application failed/);
    assert.match(result.error, /cannot write outside allowed scope/);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
  }
});

test("runApplyPlanWorkflow runs validation command when patch plan specifies one", async () => {
  const patchPlanWithValidation = { ...MOCK_PATCH_PLAN, validationCommand: "build" as const };

  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => buildLlmResponse(patchPlanWithValidation);

  setEditableFileContextLoaderForTesting(() => []);
  setCodePatchApplierForTesting(() => ({
    ...MOCK_APPLIED_RESULT,
    validationCommand: "build" as const,
  }));

  const mockValidationResult = {
    command: "build" as const,
    exitCode: 0,
    stdout: "Build succeeded",
    stderr: "",
    timedOut: false,
    durationMs: 1000,
  };
  setRunCommandExecutorForTesting(async () => mockValidationResult);

  try {
    const result = await runApplyPlanWorkflow("TEST-5", makeAnalysis());

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(result.validationResult, mockValidationResult);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
    setRunCommandExecutorForTesting();
  }
});

test("runApplyPlanWorkflow returns success even when validation command throws", async () => {
  const patchPlanWithValidation = { ...MOCK_PATCH_PLAN, validationCommand: "test" as const };

  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => buildLlmResponse(patchPlanWithValidation);

  setEditableFileContextLoaderForTesting(() => []);
  setCodePatchApplierForTesting(() => ({
    ...MOCK_APPLIED_RESULT,
    validationCommand: "test" as const,
  }));
  setRunCommandExecutorForTesting(async () => {
    throw new Error("test runner crashed");
  });

  try {
    const result = await runApplyPlanWorkflow("TEST-6", makeAnalysis());

    // patch succeeded; validation exception is swallowed (best-effort)
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.validationResult, undefined);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
    setRunCommandExecutorForTesting();
  }
});

test("runApplyPlanWorkflow includes issueKey and analysis plan in the prompt", async () => {
  let capturedPrompt = "";
  const originalCallLlm = llmClient.callLLM;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    capturedPrompt = prompt;
    return buildLlmResponse(MOCK_PATCH_PLAN);
  };

  setEditableFileContextLoaderForTesting(() => []);
  setCodePatchApplierForTesting(() => MOCK_APPLIED_RESULT);

  const analysis = makeAnalysis({
    summary: "Implement rate limiting",
    implementationPlan: ["Add rate limit middleware", "Wire it up in router"],
  });

  try {
    await runApplyPlanWorkflow("RATE-99", analysis);

    assert.ok(capturedPrompt.includes("RATE-99"), "prompt should contain issue key");
    assert.ok(capturedPrompt.includes("Implement rate limiting"), "prompt should include summary");
    assert.ok(capturedPrompt.includes("Add rate limit middleware"), "prompt should include plan step 1");
    assert.ok(capturedPrompt.includes("Wire it up in router"), "prompt should include plan step 2");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
  }
});
