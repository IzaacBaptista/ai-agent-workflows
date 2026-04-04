import test from "node:test";
import assert from "node:assert/strict";
import * as llmClient from "../core/llmClient";
import { WorkflowRuntime } from "../core/workflowRuntime";
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
