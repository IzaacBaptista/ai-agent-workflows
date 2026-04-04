import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";

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
