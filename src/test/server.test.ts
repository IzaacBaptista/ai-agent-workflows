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

function getRouteHandler(app: ReturnType<typeof createApp>, method: string, path: string) {
  const router = (app as unknown as { router?: { stack: RouteLayer[] } }).router;
  const layer = router?.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods[method.toLowerCase()],
  );

  if (!layer?.route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
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
      steps: [
        { action: "triage", purpose: "triage first" },
        { action: "final_analysis", purpose: "finish" },
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
      steps: [{ action: "final_analysis", purpose: "enough context" }],
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

test("GET /runs exposes persisted run summaries", async () => {
  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Issue workflow plan",
      steps: [{ action: "final_analysis", purpose: "finish" }],
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
