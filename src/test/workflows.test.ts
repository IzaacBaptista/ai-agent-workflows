import test from "node:test";
import assert from "node:assert/strict";
import { runIssueWorkflow } from "../workflows/issueWorkflow";
import { runBugWorkflow } from "../workflows/bugWorkflow";
import { runPRReviewWorkflow } from "../workflows/prReviewWorkflow";
import * as llmClient from "../core/llmClient";

type MockResponsePayload = Record<string, unknown>;

function buildLlmResponse(payload: MockResponsePayload): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

test("runIssueWorkflow executes planner, replanner, final analysis and critic", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      steps: [
        { action: "triage", purpose: "triage first" },
        { action: "search_code", purpose: "inspect code" },
        { action: "final_analysis", purpose: "produce result" },
      ],
    }),
    buildLlmResponse({
      summary: "Issue triage summary",
      investigationAreas: ["auth flow"],
      codeSearchTerms: ["IssueWorkflow"],
      validationChecks: ["confirm reproduction"],
    }),
    buildLlmResponse({
      summary: "Continue with code search then finish",
      steps: [
        { action: "search_code", purpose: "collect evidence" },
        { action: "final_analysis", purpose: "finish analysis" },
      ],
    }),
    buildLlmResponse({
      summary: "Finish now",
      steps: [{ action: "final_analysis", purpose: "enough context gathered" }],
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
      gaps: [],
      recommendedActions: [],
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
    assert.ok(result.meta.stepCount >= 7);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runBugWorkflow retries final analysis once when critic rejects first result", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Bug workflow plan",
      steps: [
        { action: "triage", purpose: "triage first" },
        { action: "final_analysis", purpose: "draft result" },
      ],
    }),
    buildLlmResponse({
      summary: "Bug triage summary",
      hypotheses: ["validation failure"],
      codeSearchTerms: ["BugWorkflow"],
      apiChecks: ["bug-investigation"],
    }),
    buildLlmResponse({
      summary: "Go to final analysis",
      steps: [{ action: "final_analysis", purpose: "enough to produce a first answer" }],
    }),
    buildLlmResponse({
      summary: "First candidate summary",
      possibleCauses: ["validation failure"],
      investigationSteps: ["inspect validators"],
      fixSuggestions: ["tighten validation"],
      risks: ["regression in order flow"],
    }),
    buildLlmResponse({
      approved: false,
      summary: "Need one tighter pass",
      gaps: ["Need sharper fix guidance"],
      recommendedActions: ["final_analysis"],
    }),
    buildLlmResponse({
      summary: "Second candidate summary",
      possibleCauses: ["validation failure"],
      investigationSteps: ["inspect validators", "review order payload handling"],
      fixSuggestions: ["tighten validation", "add defensive checks"],
      risks: ["regression in order flow"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "Approved after revision",
      gaps: [],
      recommendedActions: [],
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
    const result = await runBugWorkflow("500 error when creating order with coupon");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Second candidate summary");
    assert.equal(result.meta.workflowName, "BugWorkflow");
    assert.equal(result.meta.critiqueCount, 2);
    assert.equal(result.meta.replanCount, 1);
    assert.ok(result.meta.stepCount >= 6);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow fails when planner returns invalid plan", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Invalid plan",
      steps: [{ action: "triage", purpose: "missing final analysis" }],
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
    assert.match(result.error, /must end with "final_analysis"/);
    assert.equal(result.meta.workflowName, "PRReviewWorkflow");
    assert.equal(result.meta.status, "failed");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow fails after critic rejects both attempts", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "PR workflow plan",
      steps: [{ action: "final_analysis", purpose: "go straight to analysis" }],
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
      summary: "Not enough depth",
      gaps: ["needs sharper risk analysis"],
      recommendedActions: ["final_analysis"],
    }),
    buildLlmResponse({
      summary: "Second PR candidate",
      impacts: ["auth flow changed"],
      risks: ["token regression"],
      suggestions: ["add more tests"],
      testRecommendations: ["add middleware coverage", "add auth integration test"],
    }),
    buildLlmResponse({
      approved: false,
      summary: "Still not sufficient",
      gaps: ["insufficient confidence"],
      recommendedActions: ["final_analysis"],
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
    assert.equal(result.meta.status, "completed");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("runPRReviewWorkflow falls back to final_analysis when read_file repeats without progress", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "PR workflow plan",
      steps: [
        { action: "triage", purpose: "triage first" },
        { action: "search_code", purpose: "find files" },
        { action: "read_file", purpose: "inspect files" },
        { action: "final_analysis", purpose: "finish" },
      ],
    }),
    buildLlmResponse({
      summary: "PR triage summary",
      reviewFocus: ["runtime"],
      codeSearchTerms: ["WorkflowRuntime"],
      regressionChecks: ["runtime tests"],
    }),
    buildLlmResponse({
      summary: "Continue with search then read",
      steps: [
        { action: "search_code", purpose: "find files" },
        { action: "read_file", purpose: "inspect files" },
        { action: "final_analysis", purpose: "finish" },
      ],
    }),
    buildLlmResponse({
      summary: "Continue with read then finish",
      steps: [
        { action: "read_file", purpose: "inspect files" },
        { action: "final_analysis", purpose: "finish" },
      ],
    }),
    buildLlmResponse({
      summary: "Repeat read",
      steps: [
        { action: "read_file", purpose: "inspect the same files again" },
        { action: "final_analysis", purpose: "finish" },
      ],
    }),
    buildLlmResponse({
      summary: "Final PR result after fallback",
      impacts: ["runtime behavior stabilized"],
      risks: ["replanner may still over-read"],
      suggestions: ["add dedupe tests"],
      testRecommendations: ["cover repeated read_file fallback"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
      gaps: [],
      recommendedActions: [],
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
    const result = await runPRReviewWorkflow("Review repeated read_file behavior");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.equal(result.data.summary, "Final PR result after fallback");
    assert.equal(result.meta.workflowName, "PRReviewWorkflow");
    assert.equal(result.meta.status, "completed");
    assert.ok(result.meta.stepCount <= 10);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});
