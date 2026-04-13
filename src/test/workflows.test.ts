import test from "node:test";
import assert from "node:assert/strict";
import * as llmClient from "../core/llmClient";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { getRunMemory } from "../memory/simpleMemory";
import {
  setCodePatchApplierForTesting,
  setEditableFileContextLoaderForTesting,
} from "../tools/editPatchTool";
import { setGitToolExecutorForTesting } from "../tools/gitTool";
import { setIsolatedWorkspaceFactoryForTesting } from "../tools/isolatedWorkspaceTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";
import { runBugWorkflow } from "../workflows/bugWorkflow";
import { runIssueWorkflow } from "../workflows/issueWorkflow";
import { runPRReviewWorkflow } from "../workflows/prReviewWorkflow";
import { runJiraAnalyzeWorkflow } from "../workflows/jiraAnalyzeWorkflow";
import { setJiraIssueFetcherForTesting } from "../integrations/jira/fetchJiraIssue";

type MockResponsePayload = Record<string, unknown>;

function buildLlmResponse(payload: MockResponsePayload): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

test("runPRReviewWorkflow fails fast when the LLM circuit is already open", async () => {
  const circuitState = {
    openUntil: Date.now() + 6_000,
    reason: "provider_rate_limit",
    updatedAt: new Date().toISOString(),
  };

  llmClient.setLlmCircuitStateStoreForTesting({
    read: () => circuitState,
    write: () => undefined,
    clear: () => undefined,
  });

  try {
    const result = await runPRReviewWorkflow("Refactored auth middleware");

    assert.equal(result.success, false);
    if (result.success) {
      return;
    }

    assert.match(result.error, /rate limit reached/i);
    assert.equal(result.meta.workflowName, "PRReviewWorkflow");
    assert.equal(result.meta.stepCount, 0);
  } finally {
    llmClient.setLlmCircuitStateStoreForTesting();
  }
});

test("runIssueWorkflow executes model-driven tool call and finalize", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Collect initial issue investigation direction",
          reason: "Need triage first",
        },
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Finalize after evidence gathering",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue triage summary",
      investigationAreas: ["auth flow"],
      codeSearchTerms: ["IssueWorkflow"],
      validationChecks: ["confirm reproduction"],
    }),
    buildLlmResponse({
      summary: "Search code before finalizing",
      actions: [
        {
          type: "tool_call",
          toolName: "search_code",
          input: { terms: ["IssueWorkflow"] },
          reason: "Need repository evidence",
        },
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Enough evidence after code search",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Finalize now",
      actions: [
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Enough evidence gathered",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue analysis summary",
      questions: ["Can it be reproduced?"],
      acceptanceCriteria: ["Issue is resolved"],
      technicalPlan: ["Inspect auth flow"],
      testScenarios: ["Reset password then login"],
      risks: ["Regression in auth"],
      assumptions: ["Backend issue"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Looks good",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runIssueWorkflow("User cannot login after password reset");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Issue analysis summary");
    assert.equal(result.meta.workflowName, "IssueWorkflow");
    assert.equal(result.meta.critiqueCount, 1);
    assert.equal(result.meta.replanCount, 2);
    assert.equal(result.meta.toolCallCount, 1);
    assert.ok(result.meta.stepCount >= 6);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runIssueWorkflow blocks repo-local finalize without code evidence and forces a search first", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Collect repo-local issue context",
          reason: "Need triage first",
        },
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Try to finalize directly",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue triage summary",
      investigationAreas: ["WorkflowRuntime timeout cleanup"],
      codeSearchTerms: ["WorkflowRuntime", "setTimeout"],
      validationChecks: ["confirm cleanup path"],
    }),
    buildLlmResponse({
      summary: "Finalize directly after triage",
      actions: [
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Assume triage is enough",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Finalize after code search",
      actions: [
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Code evidence is now available",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue analysis summary",
      questions: ["Can it be reproduced?"],
      acceptanceCriteria: ["WorkflowRuntime cleanup is explained"],
      technicalPlan: ["Inspect WorkflowRuntime timeout lifecycle"],
      testScenarios: ["Run the hanging timer path"],
      risks: ["Regression in runtime cleanup"],
      assumptions: ["Repository-local runtime issue"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Looks good",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runIssueWorkflow("WorkflowRuntime timeouts are not cleared in this repo");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.meta.toolCallCount, 1);
    const runRecord = getRunMemory(result.meta.runId);
    assert.equal(
      runRecord.steps.some(
        (step) => step.blocked === true && step.actionType === "finalize",
      ),
      true,
    );
    assert.equal(
      runRecord.steps.some(
        (step) =>
          step.actionType === "tool_call" &&
          step.toolName === "search_code" &&
          step.status === "completed" &&
          !step.blocked,
      ),
      true,
    );
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runIssueWorkflow still allows non-repo-local issues to finalize without forced code evidence", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Collect product issue context",
          reason: "Need triage first",
        },
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Finalize after triage",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue triage summary",
      investigationAreas: ["login flow"],
      codeSearchTerms: ["auth flow"],
      validationChecks: ["confirm reproduction"],
    }),
    buildLlmResponse({
      summary: "Finalize after triage",
      actions: [
        {
          type: "finalize",
          task: "Produce the issue analysis",
          reason: "Triage is enough for this non-repo-local issue",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue analysis summary",
      questions: ["Can it be reproduced?"],
      acceptanceCriteria: ["Issue is resolved"],
      technicalPlan: ["Inspect auth flow"],
      testScenarios: ["Reset password then login"],
      risks: ["Regression in auth"],
      assumptions: ["Backend issue"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Looks good",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runIssueWorkflow("User cannot login after password reset");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.meta.toolCallCount, 0);
    const runRecord = getRunMemory(result.meta.runId);
    assert.equal(
      runRecord.steps.some(
        (step) => step.blocked === true && step.actionType === "finalize",
      ),
      false,
    );
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runIssueWorkflow does not force repo inspection for conceptual search_code loop issues", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Clarify the planner behavior issue",
          reason: "Need triage first",
        },
        {
          type: "finalize",
          task: "Deliver the planner enforcement proposal",
          reason: "Finalize after triage",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue triage summary",
      investigationAreas: ["planner decision loops"],
      codeSearchTerms: ["search_code", "planner"],
      validationChecks: ["confirm whether this is conceptual or repo-local"],
    }),
    buildLlmResponse({
      summary: "Finalize after triage",
      actions: [
        {
          type: "finalize",
          task: "Deliver the planner enforcement proposal",
          reason: "This issue is conceptual and does not require forced repo inspection",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue analysis summary",
      questions: ["When should the planner pivot?"],
      acceptanceCriteria: ["The planner stops redundant search loops"],
      technicalPlan: ["Add deduplication and no-progress guards"],
      testScenarios: ["No-match query does not repeat search_code"],
      risks: ["Over-aggressive dedup blocks valid searches"],
      assumptions: ["The issue is about planner behavior, not a specific file"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Looks good",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runIssueWorkflow("The planner keeps generating redundant search_code steps");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.meta.toolCallCount, 0);
    const runRecord = getRunMemory(result.meta.runId);
    assert.equal(
      runRecord.steps.some(
        (step) => step.blocked === true && step.actionType === "finalize",
      ),
      false,
    );
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runBugWorkflow tolerates critic output with an invalid nextAction type", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Finalize directly",
      actions: [
        {
          type: "finalize",
          task: "Summarize the bug with the current evidence",
          reason: "Enough evidence is already available",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Bug result",
      possibleCauses: ["timeout cleanup is incomplete"],
      investigationSteps: ["inspect the completion path"],
      fixSuggestions: ["clear timeout handles on every exit path"],
      risks: ["tests may keep hanging until cleanup is fixed"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved after dropping the invalid nextAction payload",
      missingEvidence: [],
      confidence: "high",
      nextAction: {
        type: "not_a_real_action",
      },
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runBugWorkflow("WorkflowRuntime timeouts are not cleared");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Bug result");
    assert.equal(result.meta.critiqueCount, 1);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runBugWorkflow uses relevant memory in planner input to avoid a repeated tool loop", async () => {
  const priorRuntime = new WorkflowRuntime({
    workflowName: "BugWorkflow",
    input: "500 error when creating order with coupon",
  });
  priorRuntime.forceFinalAnalysis("Repeated search_code steps produced no new matches");
  priorRuntime.complete();

  const originalCallLlm = llmClient.callLLM;
  let plannerPromptIncludedMemory = false;
  const responses = [
    buildLlmResponse({
      summary: "Memory-aware bug workflow plan",
      actions: [
        {
          type: "finalize",
          task: "Produce a bug diagnosis without repeating the same empty search loop",
          reason: "Relevant memory shows a prior no-op search loop",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Bug result",
      possibleCauses: ["validation failure"],
      investigationSteps: ["review recent auth changes"],
      fixSuggestions: ["avoid redundant searches when memory already indicates a loop"],
      risks: ["regression in order flow"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    if (prompt.includes("Relevant memory")) {
      plannerPromptIncludedMemory = prompt.includes("Repeated search_code steps produced no new matches");
    }

    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runBugWorkflow("500 error when creating order with coupon");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Bug result");
    assert.equal(result.meta.workflowName, "BugWorkflow");
    assert.equal(result.meta.toolCallCount, 0);
    assert.ok(plannerPromptIncludedMemory);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runBugWorkflow planner guidance prefers run_command test for runtime test failures", async () => {
  const originalCallLlm = llmClient.callLLM;
  let plannerSawRunCommandGuidance = false;
  const responses = [
    buildLlmResponse({
      summary: "Use executable evidence first",
      actions: [
        {
          type: "tool_call",
          toolName: "run_command",
          input: { command: "test" },
          reason: "A test run is the fastest way to validate the hanging-test hypothesis",
        },
        {
          type: "finalize",
          task: "Summarize the bug using command evidence",
          reason: "The command result should be enough to support the diagnosis",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Finalize after test run",
      actions: [
        {
          type: "finalize",
          task: "Summarize the bug using command evidence",
          reason: "Executable evidence is already available",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Bug result from test evidence",
      possibleCauses: ["uncleared timer handle"],
      investigationSteps: ["inspect the timeout lifecycle in WorkflowRuntime"],
      fixSuggestions: ["clear timeout handles in all completion paths"],
      risks: ["flaky tests if teardown remains incomplete"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Executable evidence is sufficient",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 1,
    stdout: "1 failing test",
    stderr: "tests hang after completion",
    timedOut: false,
    durationMs: 35,
    signal: null,
  }));

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    if (prompt.includes("You are a workflow planner")) {
      plannerSawRunCommandGuidance =
        prompt.includes("In BugWorkflow, prefer `run_command` with `test`") &&
        prompt.includes("Allowed run_command commands: build, test, lint");
    }

    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runBugWorkflow("WorkflowRuntime timeouts are not cleared and tests hang after completion");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Bug result from test evidence");
    assert.equal(result.meta.toolCallCount, 1);
    assert.ok(plannerSawRunCommandGuidance);
  } finally {
    setRunCommandExecutorForTesting();
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runBugWorkflow can apply edit_patch and validate it automatically", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Apply the localized fix",
      actions: [
        {
          type: "edit_patch",
          task: "Fix the timeout cleanup in WorkflowRuntime and add the smallest supporting code change",
          files: ["src/core/workflowRuntime.ts"],
          reason: "The bug is localized enough for a direct patch",
        },
        {
          type: "finalize",
          task: "Summarize the applied fix and validation evidence",
          reason: "Finalize after patching and validation",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Patch timeout cleanup",
      edits: [
        {
          path: "src/core/workflowRuntime.ts",
          changeType: "update",
          content: "export const workflowRuntimePatched = true;\n",
          reason: "Apply the localized timeout cleanup fix",
        },
      ],
      validationCommand: "test",
    }),
    buildLlmResponse({
      summary: "Finalize after patch validation",
      actions: [
        {
          type: "finalize",
          task: "Summarize the applied fix and validation evidence",
          reason: "The patch and validation already completed",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Patched bug result",
      possibleCauses: ["timeout handle cleanup was incomplete"],
      investigationSteps: ["inspect patch and test evidence"],
      fixSuggestions: ["keep the runtime cleanup regression covered by tests"],
      risks: ["future timer changes may regress cleanup behavior"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Patch plus validation is sufficient",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  setEditableFileContextLoaderForTesting(() => [
    {
      path: "src/core/workflowRuntime.ts",
      exists: true,
      content: "export const workflowRuntimePatched = false;\n",
    },
  ]);
  setIsolatedWorkspaceFactoryForTesting(async () => ({
    path: "/isolated-worktree",
    cleanup: async () => undefined,
  }));
  setCodePatchApplierForTesting((plan) => ({
    summary: plan.summary,
    edits: [
      {
        path: "src/core/workflowRuntime.ts",
        changeType: "update",
        bytesWritten: 44,
      },
    ],
    validationCommand: plan.validationCommand,
    validationOutcome: "not_run",
    unexpectedChangedFiles: [],
    isolationMode: "direct",
  }));
  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 0,
    stdout: "1 passing test",
    stderr: "",
    timedOut: false,
    durationMs: 21,
    signal: null,
  }));
  setGitToolExecutorForTesting({
    async getStatus() {
      return {
        entries: [
          {
            indexStatus: " ",
            workingTreeStatus: "M",
            path: "src/core/workflowRuntime.ts",
          },
        ],
        raw: " M src/core/workflowRuntime.ts",
      };
    },
    async getDiff(staged) {
      return {
        staged,
        changedFiles: ["src/core/workflowRuntime.ts"],
        diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts",
        truncated: false,
      };
    },
  });

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runBugWorkflow("Fix WorkflowRuntime timeout cleanup in this repository");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Patched bug result");
    assert.equal(result.meta.editActionCount, 1);
    assert.equal(result.meta.toolCallCount, 1);
    const run = getRunMemory(result.meta.runId);
    assert.equal(Array.isArray(run.artifacts.patchResults), true);
    assert.equal((run.artifacts.patchResults as unknown[]).length, 1);
    assert.equal(Array.isArray(run.artifacts.commandResults), true);
    assert.equal((run.artifacts.commandResults as unknown[]).length, 1);
    assert.match(String(run.artifacts.context ?? ""), /Applied patches:/);
    assert.match(String(run.artifacts.context ?? ""), /outcome=unchanged/);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
    setIsolatedWorkspaceFactoryForTesting();
    setGitToolExecutorForTesting();
    setRunCommandExecutorForTesting();
  }
});

test("runBugWorkflow surfaces regressive isolated patch evidence to the critic and follows the redirect", async () => {
  const originalCallLlm = llmClient.callLLM;
  const prompts: string[] = [];
  const responses = [
    buildLlmResponse({
      summary: "Patch the bug first",
      actions: [
        {
          type: "edit_patch",
          task: "Apply a localized fix to WorkflowRuntime timeout cleanup",
          files: ["src/core/workflowRuntime.ts"],
          reason: "The bug looks localized enough for a small fix attempt",
        },
        {
          type: "finalize",
          task: "Summarize the bug analysis",
          reason: "Finalize after the patch attempt",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Apply the timeout cleanup patch",
      edits: [
        {
          path: "src/core/workflowRuntime.ts",
          changeType: "update",
          content: "export const workflowRuntimePatched = true;\n",
          reason: "Apply the localized fix under test",
        },
      ],
      validationCommand: "test",
    }),
    buildLlmResponse({
      summary: "Finalize after the patch attempt",
      actions: [
        {
          type: "finalize",
          task: "Summarize the bug analysis",
          reason: "The patch attempt is complete",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Initial patched bug result",
      possibleCauses: ["timeout cleanup looked incomplete"],
      investigationSteps: ["inspect the isolated patch attempt"],
      fixSuggestions: ["accept the patch if it is safe"],
      risks: ["patch safety is still uncertain"],
    }),
    buildLlmResponse({
      approved: false,
      summary: "Reject the regressive patch attempt",
      missingEvidence: ["The isolated patch regressed validation and touched unexpected files"],
      confidence: "high",
      nextAction: {
        type: "finalize",
        task: "Explain why the isolated patch must be rejected",
        reason: "The current evidence shows the patch regressed validation",
      },
    }),
    buildLlmResponse({
      summary: "Reject regressive patch",
      possibleCauses: ["the isolated patch worsened the test outcome"],
      investigationSteps: ["compare pre-patch and post-patch validation results"],
      fixSuggestions: ["narrow the patch and retry in isolation"],
      risks: ["unexpected file changes broaden the patch scope"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "The redirected conclusion is now appropriately cautious",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  let commandInvocationCount = 0;
  setEditableFileContextLoaderForTesting(() => [
    {
      path: "src/core/workflowRuntime.ts",
      exists: true,
      content: "export const workflowRuntimePatched = false;\n",
    },
  ]);
  setIsolatedWorkspaceFactoryForTesting(async () => ({
    path: "/isolated-worktree",
    cleanup: async () => undefined,
  }));
  setCodePatchApplierForTesting((plan) => ({
    summary: plan.summary,
    edits: [
      {
        path: "src/core/workflowRuntime.ts",
        changeType: "update",
        bytesWritten: 44,
      },
    ],
    validationCommand: plan.validationCommand,
    validationOutcome: "not_run",
    unexpectedChangedFiles: [],
    isolationMode: "direct",
  }));
  setRunCommandExecutorForTesting(async (command) => {
    commandInvocationCount += 1;
    if (commandInvocationCount === 1) {
      return {
        command,
        exitCode: 0,
        stdout: "10 passing",
        stderr: "",
        timedOut: false,
        durationMs: 20,
        signal: null,
      };
    }

    return {
      command,
      exitCode: 1,
      stdout: "2 failing",
      stderr: "timeout cleanup regression",
      timedOut: false,
      durationMs: 23,
      signal: null,
    };
  });
  setGitToolExecutorForTesting({
    async getStatus() {
      return {
        entries: [
          {
            indexStatus: " ",
            workingTreeStatus: "M",
            path: "src/core/workflowRuntime.ts",
          },
          {
            indexStatus: " ",
            workingTreeStatus: "M",
            path: "src/core/types.ts",
          },
        ],
        raw: " M src/core/workflowRuntime.ts\n M src/core/types.ts",
      };
    },
    async getDiff(staged) {
      return {
        staged,
        changedFiles: ["src/core/workflowRuntime.ts", "src/core/types.ts"],
        diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts\n+++ b/src/core/types.ts",
        truncated: false,
      };
    },
  });

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt) => {
    prompts.push(prompt);
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runBugWorkflow("Attempt to fix WorkflowRuntime timeout cleanup automatically");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.meta.criticRedirectCount, 1);
    assert.equal(result.data.summary, "Reject regressive patch");
    const run = getRunMemory(result.meta.runId);
    const patchResult = (run.artifacts.patchResults as Array<{
      validationOutcome: string;
      unexpectedChangedFiles: string[];
    }>)[0];
    assert.equal(patchResult.validationOutcome, "regressed");
    assert.deepEqual(patchResult.unexpectedChangedFiles, ["src/core/types.ts"]);
    assert.ok(prompts.some((prompt) => prompt.includes("patch_test_regressed")));
    assert.ok(prompts.some((prompt) => prompt.includes("unexpectedChangedFiles=1")));
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
    setIsolatedWorkspaceFactoryForTesting();
    setRunCommandExecutorForTesting();
    setGitToolExecutorForTesting();
  }
});

test("runPRReviewWorkflow fails when planner returns invalid action queue", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Invalid plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Missing finalize action",
          reason: "invalid test fixture",
        },
      ],
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runPRReviewWorkflow("Refactored auth middleware");

    assert.equal(result.success, false);
    assert.match(result.error, /must end with "finalize"/);
    assert.equal(result.meta.workflowName, "PRReviewWorkflow");
    assert.equal(result.meta.status, "failed");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow replanner guidance prefers run_command build for runtime-heavy changes", async () => {
  const originalCallLlm = llmClient.callLLM;
  let replannerSawRunCommandGuidance = false;
  const responses = [
    buildLlmResponse({
      summary: "Start with triage",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Map the risky runtime, persistence, and API-surface changes",
          reason: "Need triage before choosing verification steps",
        },
        {
          type: "finalize",
          task: "Produce the PR review",
          reason: "Fallback finalization after evidence gathering",
        },
      ],
    }),
    buildLlmResponse({
      summary: "PR triage",
      reviewFocus: ["runtime changes", "disk persistence", "API envelope changes"],
      codeSearchTerms: ["CriticAgent", "simpleMemory", "server.ts"],
      regressionChecks: ["build still passes", "metadata shape is stable"],
    }),
    buildLlmResponse({
      summary: "Use build as the next evidence source",
      actions: [
        {
          type: "tool_call",
          toolName: "run_command",
          input: { command: "build" },
          reason: "This PR changes runtime and types, so build evidence is more decisive than more file reads",
        },
        {
          type: "finalize",
          task: "Produce the PR review with build evidence",
          reason: "Build evidence should be enough for a first pass",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Finalize after build",
      actions: [
        {
          type: "finalize",
          task: "Produce the PR review with build evidence",
          reason: "Executable verification is available",
        },
      ],
    }),
    buildLlmResponse({
      summary: "PR review from build evidence",
      impacts: ["runtime behavior changed", "disk persistence added"],
      risks: ["response meta regressions"],
      suggestions: ["keep build in the review loop"],
      testRecommendations: ["add response envelope coverage"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved with build evidence",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 0,
    stdout: "build ok",
    stderr: "",
    timedOut: false,
    durationMs: 28,
    signal: null,
  }));

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    if (prompt.includes("You are a workflow replanner")) {
      replannerSawRunCommandGuidance =
        prompt.includes("In PRReviewWorkflow, prefer `run_command` with `build`") &&
        prompt.includes("Detected command-driven verification signals: build");
    }

    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runPRReviewWorkflow("Added CriticAgent, persisted runs to disk, and normalized GitHub PR comment meta");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "PR review from build evidence");
    assert.equal(result.meta.toolCallCount, 1);
    assert.ok(replannerSawRunCommandGuidance);
  } finally {
    setRunCommandExecutorForTesting();
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow can use git_status and git_diff as real repository context", async () => {
  const originalCallLlm = llmClient.callLLM;
  let finalPromptIncludedGitContext = false;
  const responses = [
    buildLlmResponse({
      summary: "Start with triage",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "Map the risky local changes before reviewing them",
          reason: "Need triage before using git tools",
        },
        {
          type: "finalize",
          task: "Produce the PR review with repository evidence",
          reason: "Fallback finalization after gathering context",
        },
      ],
    }),
    buildLlmResponse({
      summary: "PR triage",
      reviewFocus: ["runtime changes", "tooling changes"],
      codeSearchTerms: ["workflowRuntime", "gitTool"],
      regressionChecks: ["working tree matches expectations"],
    }),
    buildLlmResponse({
      summary: "Check repository state first",
      actions: [
        {
          type: "tool_call",
          toolName: "git_status",
          input: {},
          reason: "Need the local change set before reviewing concrete hunks",
        },
        {
          type: "finalize",
          task: "Produce the PR review with repository evidence",
          reason: "Fallback after git inspection",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Inspect concrete modified hunks",
      actions: [
        {
          type: "tool_call",
          toolName: "git_diff",
          input: { staged: false },
          reason: "Need concrete local hunks after seeing the changed files",
        },
        {
          type: "finalize",
          task: "Produce the PR review with repository evidence",
          reason: "Enough context after git diff",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Finalize after git tools",
      actions: [
        {
          type: "finalize",
          task: "Produce the PR review with repository evidence",
          reason: "Git status and diff are available",
        },
      ],
    }),
    buildLlmResponse({
      summary: "PR review from git context",
      impacts: ["workflow runtime changed", "git tooling added"],
      risks: ["working tree review may miss staged-only differences"],
      suggestions: ["consider staged diff support in review prompts"],
      testRecommendations: ["add coverage for git tool artifacts"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved with git evidence",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  setGitToolExecutorForTesting({
    getStatus: async () => ({
      entries: [
        { indexStatus: "M", workingTreeStatus: " ", path: "src/core/workflowRuntime.ts" },
        { indexStatus: "?", workingTreeStatus: "?", path: "src/tools/gitTool.ts" },
      ],
      raw: "M  src/core/workflowRuntime.ts\n?? src/tools/gitTool.ts",
    }),
    getDiff: async (staged) => ({
      staged,
      diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts\n+++ b/src/core/workflowRuntime.ts\n@@ -1,3 +1,4 @@",
      changedFiles: ["src/core/workflowRuntime.ts"],
      truncated: false,
    }),
  });

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    if (prompt.includes("Git status:") && prompt.includes("Git diff:")) {
      finalPromptIncludedGitContext =
        prompt.includes("src/core/workflowRuntime.ts") &&
        prompt.includes("src/tools/gitTool.ts");
    }

    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runPRReviewWorkflow("Review the local runtime and tooling changes");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "PR review from git context");
    assert.equal(result.meta.toolCallCount, 2);
    assert.ok(finalPromptIncludedGitContext);
  } finally {
    setGitToolExecutorForTesting();
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow lets the critic redirect into ReviewerAgent delegation", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "PR workflow plan",
      actions: [
        {
          type: "finalize",
          task: "Produce the initial PR review",
          reason: "Enough context to draft a first pass",
        },
      ],
    }),
    buildLlmResponse({
      summary: "First PR candidate",
      impacts: ["auth flow changed"],
      risks: ["token regression"],
      suggestions: ["add tests"],
      testRecommendations: ["add middleware coverage"],
    }),
    buildLlmResponse({
      approved: false,
      summary: "Need independent verification",
      missingEvidence: ["independent evidence review"],
      confidence: "medium",
      nextAction: {
        type: "delegate",
        targetAgent: "ReviewerAgent",
        task: "Verify whether the PR conclusion is sufficiently supported by evidence",
        reason: "Need independent verification before finalizing",
      },
    }),
    buildLlmResponse({
      supported: false,
      summary: "One tighter pass is needed",
      missingEvidence: ["need sharper regression framing"],
      recommendedAction: {
        type: "finalize",
        task: "Revise the PR review using reviewer feedback",
        reason: "Need one tighter pass",
      },
    }),
    buildLlmResponse({
      summary: "Replan after reviewer",
      actions: [
        {
          type: "finalize",
          task: "Revise the PR review using reviewer feedback",
          reason: "Reviewer requested a tighter final pass",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Second PR candidate",
      impacts: ["auth flow changed"],
      risks: ["token regression"],
      suggestions: ["add more tests"],
      testRecommendations: ["add middleware coverage", "add auth integration test"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved after reviewer verification",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runPRReviewWorkflow("Refactored auth middleware");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Second PR candidate");
    assert.equal(result.meta.workflowName, "PRReviewWorkflow");
    assert.equal(result.meta.critiqueCount, 2);
    assert.equal(result.meta.delegationCount, 1);
    assert.equal(result.meta.criticRedirectCount, 1);
    assert.equal(result.meta.status, "completed");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow critic guidance can redirect to run_command when executable proof is missing", async () => {
  const originalCallLlm = llmClient.callLLM;
  let criticSawRunCommandGuidance = false;
  const responses = [
    buildLlmResponse({
      summary: "Draft first, then verify if needed",
      actions: [
        {
          type: "finalize",
          task: "Produce an initial PR review without executable verification",
          reason: "Draft a first review quickly",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Initial PR candidate",
      impacts: ["runtime behavior changed"],
      risks: ["build may be broken"],
      suggestions: ["verify with commands if needed"],
      testRecommendations: ["run build before approving"],
    }),
    buildLlmResponse({
      approved: false,
      summary: "Need executable proof before approving the PR",
      missingEvidence: ["build result"],
      confidence: "medium",
      nextAction: {
        type: "tool_call",
        toolName: "run_command",
        input: { command: "build" },
        reason: "Need build evidence before approving a safety claim",
      },
    }),
    buildLlmResponse({
      summary: "Finalize after build evidence",
      actions: [
        {
          type: "finalize",
          task: "Produce the PR review with build verification",
          reason: "Build evidence is now available",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Verified PR candidate",
      impacts: ["runtime behavior changed"],
      risks: ["watch response meta regressions"],
      suggestions: ["keep build verification in the loop"],
      testRecommendations: ["add API envelope tests"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved after build verification",
      missingEvidence: [],
      confidence: "high",
    }),
  ];

  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 0,
    stdout: "build ok",
    stderr: "",
    timedOut: false,
    durationMs: 31,
    signal: null,
  }));

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    if (prompt.includes("You are a critic agent")) {
      criticSawRunCommandGuidance =
        prompt.includes("prefer redirecting to `run_command` with `build`, `test`, or `lint`") &&
        prompt.includes("Allowed run_command commands: build, test, lint");
    }

    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const result = await runPRReviewWorkflow("Added CriticAgent, persisted runs to disk, and normalized GitHub PR comment meta");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Verified PR candidate");
    assert.equal(result.meta.toolCallCount, 1);
    assert.equal(result.meta.criticRedirectCount, 1);
    assert.ok(criticSawRunCommandGuidance);
  } finally {
    setRunCommandExecutorForTesting();
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

// ─── runJiraAnalyzeWorkflow (simple mode) ─────────────────────────────────────

const MOCK_JIRA_ISSUE = {
  key: "REL-1",
  summary: "Add rate limiting",
  description: "Protect the API with rate limiting.",
  issueType: "Story",
  status: "In Progress",
  priority: "High",
  labels: [],
  components: [],
  url: "https://jira.example.com/browse/REL-1",
};

const JIRA_TRIAGE_RESPONSE = {
  summary: "Rate limiting story triage",
  investigationAreas: ["src/middleware"],
  codeSearchTerms: ["rateLimiter"],
  validationChecks: ["confirm rate limit applied"],
};

const JIRA_ANALYZE_RESPONSE = {
  summary: "Implement rate limiting middleware",
  implementationPlan: ["Add rateLimiter.ts", "Wire middleware in app.ts"],
  acceptanceCriteria: ["429 returned after limit exceeded"],
  risks: ["Performance overhead"],
  testScenarios: ["Call endpoint 101 times"],
  suggestedBranchName: "feat/rate-limiting",
  suggestedPRTitle: "feat: add rate limiting middleware",
};

test("runJiraAnalyzeWorkflow simple mode returns JiraAnalysis with 2 LLM calls", async () => {
  const originalCallLlm = llmClient.callLLM;
  let callCount = 0;
  const responses = [
    { output_text: JSON.stringify(JIRA_TRIAGE_RESPONSE) },
    { output_text: JSON.stringify(JIRA_ANALYZE_RESPONSE) },
  ];
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const res = responses[callCount++];
    if (!res) throw new Error(`Unexpected extra LLM call #${callCount}`);
    return res;
  };

  setJiraIssueFetcherForTesting(async () => MOCK_JIRA_ISSUE);
  setGitToolExecutorForTesting({
    getStatus: async () => ({ entries: [], raw: "" }),
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
    getLog: async () => ({ commits: [], truncated: false }),
  });

  try {
    const result = await runJiraAnalyzeWorkflow("REL-1");

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(callCount, 2, "simple mode should make exactly 2 LLM calls");
    assert.equal(result.data.summary, JIRA_ANALYZE_RESPONSE.summary);
    assert.deepEqual(result.data.implementationPlan, JIRA_ANALYZE_RESPONSE.implementationPlan);
    assert.equal(result.data.suggestedBranchName, JIRA_ANALYZE_RESPONSE.suggestedBranchName);
    assert.equal(result.meta.jiraIssueKey, "REL-1");
    assert.equal(result.meta.workflowName, "JiraAnalyzeWorkflow");

    // Simple mode: exactly triage + finalize steps — no planner / critic steps
    const runRecord = getRunMemory(result.meta.runId);
    const stepNames = runRecord.steps.map((s) => s.name);
    assert.ok(stepNames.includes("analyze"), "should have analyze step");
    assert.ok(stepNames.includes("finalize"), "should have finalize step");
    assert.ok(!stepNames.includes("plan"), "should NOT have plan step in simple mode");
    assert.ok(!stepNames.includes("critique"), "should NOT have critique step in simple mode");
    assert.ok(!stepNames.includes("replan"), "should NOT have replan step in simple mode");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setJiraIssueFetcherForTesting();
    setGitToolExecutorForTesting();
  }
});

test("runJiraAnalyzeWorkflow simple mode saves triage context artifacts", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    { output_text: JSON.stringify(JIRA_TRIAGE_RESPONSE) },
    { output_text: JSON.stringify(JIRA_ANALYZE_RESPONSE) },
  ];
  let callCount = 0;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => responses[callCount++]!;

  setJiraIssueFetcherForTesting(async () => MOCK_JIRA_ISSUE);
  setGitToolExecutorForTesting({
    getStatus: async () => ({ entries: [], raw: "" }),
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
    getLog: async () => ({ commits: [], truncated: false }),
  });

  try {
    const result = await runJiraAnalyzeWorkflow("REL-1");
    assert.equal(result.success, true);
    if (!result.success) return;

    const runRecord = getRunMemory(result.meta.runId);
    assert.ok(runRecord.artifacts.triage, "triage artifact should be saved");
    assert.ok(runRecord.artifacts.codeSearchResults !== undefined, "codeSearchResults artifact should be saved");
    assert.ok(runRecord.artifacts.gitStatusResult !== undefined, "gitStatusResult artifact should be saved");
    assert.ok(runRecord.artifacts.gitLogResult !== undefined, "gitLogResult artifact should be saved");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setJiraIssueFetcherForTesting();
    setGitToolExecutorForTesting();
  }
});

test("runJiraAnalyzeWorkflow returns failure when Jira fetch fails", async () => {
  setJiraIssueFetcherForTesting(async () => {
    throw new Error("Jira API unavailable");
  });

  try {
    const result = await runJiraAnalyzeWorkflow("REL-404");

    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /Jira API unavailable/);
    assert.equal(result.meta.workflowName, "JiraAnalyzeWorkflow");
  } finally {
    setJiraIssueFetcherForTesting();
  }
});

test("runJiraAnalyzeWorkflow agentic mode invokes planner", async () => {
  const originalCallLlm = llmClient.callLLM;
  let callCount = 0;

  // agentic mode: planner → triage → replanner → finalize → critique
  const responses = [
    {
      output_text: JSON.stringify({
        summary: "agentic plan",
        actions: [
          { type: "analyze", stage: "triage", task: "triage task", reason: "triage first" },
          { type: "finalize", task: "finalize task", reason: "done" },
        ],
      }),
    },
    { output_text: JSON.stringify(JIRA_TRIAGE_RESPONSE) },
    {
      output_text: JSON.stringify({
        summary: "replan after triage",
        actions: [{ type: "finalize", task: "finalize task", reason: "done" }],
      }),
    },
    { output_text: JSON.stringify(JIRA_ANALYZE_RESPONSE) },
    {
      output_text: JSON.stringify({
        approved: true,
        summary: "looks good",
        missingEvidence: [],
        confidence: "high",
      }),
    },
  ];

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const res = responses[callCount++];
    if (!res) throw new Error(`Unexpected extra LLM call #${callCount}`);
    return res;
  };

  setJiraIssueFetcherForTesting(async () => MOCK_JIRA_ISSUE);
  setGitToolExecutorForTesting({
    getStatus: async () => ({ entries: [], raw: "" }),
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
    getLog: async () => ({ commits: [], truncated: false }),
  });

  try {
    const result = await runJiraAnalyzeWorkflow("REL-1", { agentic: true });

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.ok(callCount > 2, "agentic mode should make more than 2 LLM calls");

    const runRecord = getRunMemory(result.meta.runId);
    const stepNames = runRecord.steps.map((s) => s.name);
    assert.ok(stepNames.includes("plan"), "agentic mode should have a plan step");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setJiraIssueFetcherForTesting();
    setGitToolExecutorForTesting();
  }
});
