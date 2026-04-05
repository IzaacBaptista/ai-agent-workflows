import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { workflowPlanSchema } from "../core/actionSchemas";
import { BaseAgent } from "../core/baseAgent";
import { WorkflowPlan } from "../core/types";

class TestAgent extends BaseAgent<{ value: string }> {
  async run(): Promise<{ value: string }> {
    return { value: "unused" };
  }

  parse(response: unknown): { value: string } {
    return this.parseResponse(
      response,
      z.object({
        value: z.string(),
      }),
    );
  }
}

class PlanTestAgent extends BaseAgent<WorkflowPlan> {
  async run(): Promise<WorkflowPlan> {
    return {
      summary: "unused",
      actions: [{ type: "finalize", task: "unused", reason: "unused" }],
    };
  }

  parse(response: unknown): WorkflowPlan {
    return this.parseResponse(response, workflowPlanSchema);
  }
}

test("BaseAgent parses output_text JSON", () => {
  const agent = new TestAgent();
  const result = agent.parse({
    output_text: JSON.stringify({ value: "ok" }),
  });

  assert.deepEqual(result, { value: "ok" });
});

test("BaseAgent parses text content from output array", () => {
  const agent = new TestAgent();
  const result = agent.parse({
    output: [
      {
        content: [
          { type: "output_text", text: JSON.stringify({ value: "from-content" }) },
        ],
      },
    ],
  });

  assert.deepEqual(result, { value: "from-content" });
});

test("BaseAgent throws descriptive error on invalid JSON", () => {
  const agent = new TestAgent();

  assert.throws(
    () =>
      agent.parse({
        output_text: "{invalid-json}",
      }),
    /LLM returned invalid JSON/,
  );
});

test("BaseAgent throws descriptive error on schema mismatch", () => {
  const agent = new TestAgent();

  assert.throws(
    () =>
      agent.parse({
        output_text: JSON.stringify({ wrong: "shape" }),
      }),
    /LLM response failed schema validation/,
  );
});

test("BaseAgent rejects unsupported workflow tool names in planner output", () => {
  const agent = new PlanTestAgent();

  assert.throws(
    () =>
      agent.parse(
        {
          output_text: JSON.stringify({
            summary: "bad plan",
            actions: [
              {
                type: "tool_call",
                toolName: "totally_unknown_tool",
                input: {},
                reason: "invalid",
              },
              {
                type: "finalize",
                task: "finish",
                reason: "finish",
              },
            ],
          }),
        },
      ),
    /LLM response failed schema validation/,
  );
});

test("BaseAgent rejects unsupported delegate target names in planner output", () => {
  const agent = new PlanTestAgent();

  assert.throws(
    () =>
      agent.parse(
        {
          output_text: JSON.stringify({
            summary: "bad delegate plan",
            actions: [
              {
                type: "delegate",
                targetAgent: "UnknownAgent",
                task: "delegate nowhere",
                reason: "invalid",
              },
              {
                type: "finalize",
                task: "finish",
                reason: "finish",
              },
            ],
          }),
        },
      ),
    /LLM response failed schema validation/,
  );
});
