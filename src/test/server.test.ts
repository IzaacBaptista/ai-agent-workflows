import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server";
import * as llmClient from "../core/llmClient";

type MockResponsePayload = Record<string, unknown>;

interface MockRequest {
  body?: unknown;
  params?: Record<string, string>;
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: MockRequest, res: MockResponse, next: (err?: unknown) => void) => unknown }>;
  };
}

function buildLlmResponse(payload: MockResponsePayload): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function getRouteHandler(app: ReturnType<typeof createApp>, method: string, routePattern: string) {
  const router = (app as unknown as { router?: { stack: RouteLayer[] } }).router;

  // Try exact match first, then parameterized pattern match (e.g. /runs/:runId matches /runs/:runId)
  const layer = router?.stack.find((entry) => {
    if (!entry.route?.methods[method.toLowerCase()]) {
      return false;
    }

    const routePath = entry.route.path as string;
    if (routePath === routePattern) {
      return true;
    }

    // Match parameterized patterns: turn /runs/:runId into a regex
    const regexStr = `^${routePath.replace(/:[^/]+/g, "[^/]+")}$`;
    return new RegExp(regexStr).test(routePattern);
  });

  if (!layer?.route) {
    throw new Error(`Route ${method.toUpperCase()} ${routePattern} not found`);
  }

  return layer.route.stack[0].handle;
}

async function invokeRoute(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  request: MockRequest = {},
) {
  const handler = getRouteHandler(app, method, path);
  const response = createMockResponse();

  await new Promise<void>((resolve, reject) => {
    const next = (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    Promise.resolve(handler(request, response, next))
      .then(() => resolve())
      .catch(reject);
  });

  return response;
}

test("GET /health returns ok", async () => {
  const app = createApp();
  const response = await invokeRoute(app, "get", "/health");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
});

test("POST /issue/analyze returns workflow result with meta", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "triage first",
          reason: "Need triage",
        },
        {
          type: "finalize",
          task: "finish",
          reason: "Finish after triage",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue triage",
      investigationAreas: ["auth"],
      codeSearchTerms: ["IssueWorkflow"],
      validationChecks: ["confirm repro"],
    }),
    buildLlmResponse({
      summary: "Proceed to final",
      actions: [
        {
          type: "finalize",
          task: "enough context",
          reason: "enough context",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue result",
      questions: ["Q1"],
      acceptanceCriteria: ["A1"],
      technicalPlan: ["T1"],
      testScenarios: ["S1"],
      risks: ["R1"],
      assumptions: ["AS1"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
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
    const app = createApp();
    const response = await invokeRoute(app, "post", "/issue/analyze", {
      body: { input: "User cannot login after password reset" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      success: boolean;
      data: { summary: string };
      meta: { workflowName: string; runId: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.summary, "Issue result");
    assert.equal(body.meta.workflowName, "IssueWorkflow");
    assert.equal(typeof body.meta.runId, "string");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("POST /issue/analyze returns 400 for missing input", async () => {
  const app = createApp();
  const response = await invokeRoute(app, "post", "/issue/analyze", { body: {} });
  assert.equal(response.statusCode, 400);
  const body = response.body as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.equal(body.error, "Invalid request body");
});

test("POST /bug/analyze returns workflow result with meta", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Bug workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "triage the bug",
          reason: "Need triage",
        },
        {
          type: "finalize",
          task: "finish",
          reason: "Finish after triage",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Bug triage",
      hypotheses: ["null pointer"],
      codeSearchTerms: ["BugWorkflow"],
      apiChecks: [],
    }),
    buildLlmResponse({
      summary: "Proceed to final",
      actions: [
        {
          type: "finalize",
          task: "enough context",
          reason: "enough context",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Bug result",
      possibleCauses: ["C1"],
      investigationSteps: ["I1"],
      fixSuggestions: ["F1"],
      risks: ["R1"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
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
    const app = createApp();
    const response = await invokeRoute(app, "post", "/bug/analyze", {
      body: { input: "App crashes on startup" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      success: boolean;
      data: { summary: string };
      meta: { workflowName: string; runId: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.summary, "Bug result");
    assert.equal(body.meta.workflowName, "BugWorkflow");
    assert.equal(typeof body.meta.runId, "string");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("POST /bug/analyze returns 400 for missing input", async () => {
  const app = createApp();
  const response = await invokeRoute(app, "post", "/bug/analyze", { body: {} });
  assert.equal(response.statusCode, 400);
  const body = response.body as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.equal(body.error, "Invalid request body");
});

test("POST /pr/review returns workflow result with meta", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "PR workflow plan",
      actions: [
        {
          type: "analyze",
          stage: "triage",
          task: "triage the PR",
          reason: "Need triage",
        },
        {
          type: "finalize",
          task: "finish",
          reason: "Finish after triage",
        },
      ],
    }),
    buildLlmResponse({
      summary: "PR triage",
      reviewFocus: ["auth"],
      codeSearchTerms: ["PRWorkflow"],
      regressionChecks: [],
    }),
    buildLlmResponse({
      summary: "Proceed to final",
      actions: [
        {
          type: "finalize",
          task: "enough context",
          reason: "enough context",
        },
      ],
    }),
    buildLlmResponse({
      summary: "PR review result",
      impacts: ["I1"],
      risks: ["R1"],
      suggestions: ["S1"],
      testRecommendations: ["T1"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
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
    const app = createApp();
    const response = await invokeRoute(app, "post", "/pr/review", {
      body: { input: "Review PR #42" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.body as {
      success: boolean;
      data: { summary: string };
      meta: { workflowName: string; runId: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.data.summary, "PR review result");
    assert.equal(body.meta.workflowName, "PRReviewWorkflow");
    assert.equal(typeof body.meta.runId, "string");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("POST /pr/review returns 400 for missing input", async () => {
  const app = createApp();
  const response = await invokeRoute(app, "post", "/pr/review", { body: {} });
  assert.equal(response.statusCode, 400);
  const body = response.body as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.equal(body.error, "Invalid request body");
});

test("GET /runs/:runId returns a specific run record", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "finalize",
          task: "finish",
          reason: "finish",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue result",
      questions: ["Q1"],
      acceptanceCriteria: ["A1"],
      technicalPlan: ["T1"],
      testScenarios: ["S1"],
      risks: ["R1"],
      assumptions: ["AS1"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
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
    const app = createApp();

    const issueResponse = await invokeRoute(app, "post", "/issue/analyze", {
      body: { input: "fetch specific run by ID" },
    });

    const runId = (issueResponse.body as { meta: { runId: string } }).meta.runId;
    assert.equal(typeof runId, "string");

    const runResponse = await invokeRoute(app, "get", "/runs/:runId", {
      params: { runId },
    });

    assert.equal(runResponse.statusCode, 200);
    const runBody = runResponse.body as {
      success: boolean;
      data: { runId: string; workflowName: string };
    };
    assert.equal(runBody.success, true);
    assert.equal(runBody.data.runId, runId);
    assert.equal(runBody.data.workflowName, "IssueWorkflow");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("GET /runs/:runId returns 404 for unknown run", async () => {
  const app = createApp();
  const response = await invokeRoute(app, "get", "/runs/:runId", {
    params: { runId: "nonexistent-run-xyz" },
  });
  assert.equal(response.statusCode, 404);
  const body = response.body as { success: boolean; error: string };
  assert.equal(body.success, false);
  assert.match(body.error, /nonexistent-run-xyz/);
});

test("GET /runs/:runId/artifacts returns artifact data for a known run", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "finalize",
          task: "finish",
          reason: "finish",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue result",
      questions: ["Q1"],
      acceptanceCriteria: ["A1"],
      technicalPlan: ["T1"],
      testScenarios: ["S1"],
      risks: ["R1"],
      assumptions: ["AS1"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
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
    const app = createApp();

    const issueResponse = await invokeRoute(app, "post", "/issue/analyze", {
      body: { input: "fetch artifacts for a run" },
    });

    const runId = (issueResponse.body as { meta: { runId: string } }).meta.runId;
    assert.equal(typeof runId, "string");

    const artifactsResponse = await invokeRoute(app, "get", "/runs/:runId/artifacts", {
      params: { runId },
    });

    assert.equal(artifactsResponse.statusCode, 200);
    const artifactsBody = artifactsResponse.body as {
      success: boolean;
      data: Record<string, unknown>;
    };
    assert.equal(artifactsBody.success, true);
    assert.equal(typeof artifactsBody.data, "object");
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("GET /runs/:runId/artifacts returns 404 for unknown run", async () => {
  const app = createApp();
  const response = await invokeRoute(app, "get", "/runs/:runId/artifacts", {
    params: { runId: "unknown-run-artifacts" },
  });
  assert.equal(response.statusCode, 404);
  const body = response.body as { success: boolean; error: string };
  assert.equal(body.success, false);
});

test("GET /runs exposes persisted run summaries", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      actions: [
        {
          type: "finalize",
          task: "finish",
          reason: "finish",
        },
      ],
    }),
    buildLlmResponse({
      summary: "Issue result",
      questions: ["Q1"],
      acceptanceCriteria: ["A1"],
      technicalPlan: ["T1"],
      testScenarios: ["S1"],
      risks: ["R1"],
      assumptions: ["AS1"],
    }),
    buildLlmResponse({
      approved: true,
      summary: "approved",
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
    const app = createApp();

    await invokeRoute(app, "post", "/issue/analyze", {
      body: { input: "User cannot login after password reset" },
    });

    const response = await invokeRoute(app, "get", "/runs");
    const body = response.body as {
      success: boolean;
      data: Array<{ workflowName: string }>;
    };

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.some((run) => run.workflowName === "IssueWorkflow"));
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
  }
});

test("POST /github/pr-review/fetch fails fast when the LLM circuit is open", async () => {
  const circuitState = {
    openUntil: Date.now() + 5_000,
    reason: "provider_rate_limit",
    updatedAt: new Date().toISOString(),
  };

  llmClient.setLlmCircuitStateStoreForTesting({
    read: () => circuitState,
    write: () => undefined,
    clear: () => undefined,
  });

  try {
    const app = createApp();
    const response = await invokeRoute(app, "post", "/github/pr-review/fetch", {
      body: {
        repository: "owner/repo",
        prNumber: 10,
      },
    });

    const body = response.body as {
      success: boolean;
      error: string;
      meta: { workflowName: string; stepCount: number };
    };

    assert.equal(response.statusCode, 429);
    assert.equal(body.success, false);
    assert.match(body.error, /rate limit reached/i);
    assert.equal(body.meta.workflowName, "PRReviewWorkflow");
    assert.equal(body.meta.stepCount, 0);
  } finally {
    llmClient.setLlmCircuitStateStoreForTesting();
  }
});
