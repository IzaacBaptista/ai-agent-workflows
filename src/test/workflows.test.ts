import test from "node:test";
import assert from "node:assert/strict";
import * as llmClient from "../core/llmClient";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";
import { runBugWorkflow } from "../workflows/bugWorkflow";
import { runIssueWorkflow } from "../workflows/issueWorkflow";
import { runPRReviewWorkflow } from "../workflows/prReviewWorkflow";

type MockResponsePayload = Record<string, unknown>;

function buildLlmResponse(payload: MockResponsePayload): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

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
        prompt.includes("Allowed run_command commands: build, test");
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
        prompt.includes("prefer redirecting to `run_command` with `build` or `test`") &&
        prompt.includes("Allowed run_command commands: build, test");
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
