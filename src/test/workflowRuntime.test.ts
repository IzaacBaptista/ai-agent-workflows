import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowRuntime } from "../core/workflowRuntime";

test("WorkflowRuntime records completed steps and metadata", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeTestWorkflow",
    input: "runtime input",
    policy: {
      maxSteps: 5,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  runtime.savePlan({
    summary: "simple plan",
    steps: [{ action: "final_analysis", purpose: "finish" }],
  });

  const result = await runtime.executeStep(
    "final_analysis",
    async () => ({ done: true }),
    {
      agentName: "TestAgent",
      inputSummary: "run test",
      outputSummary: () => "done=true",
    },
  );

  assert.deepEqual(result, { done: true });

  runtime.complete();

  const runRecord = runtime.getRunRecord();
  const meta = runtime.getMeta();

  assert.equal(runRecord.status, "completed");
  assert.equal(runRecord.steps.length, 1);
  assert.equal(runRecord.steps[0].status, "completed");
  assert.equal(meta.workflowName, "RuntimeTestWorkflow");
  assert.equal(meta.stepCount, 1);
});

test("WorkflowRuntime retries failed step once when configured", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RetryWorkflow",
    input: "retry input",
    policy: {
      maxSteps: 5,
      maxRetriesPerStep: 1,
      timeoutMs: 1000,
    },
  });

  let attemptCount = 0;

  const result = await runtime.executeStep(
    "retry_step",
    async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        throw new Error("first failure");
      }

      return "recovered";
    },
  );

  assert.equal(result, "recovered");
  assert.equal(attemptCount, 2);
  assert.equal(runtime.getRunRecord().steps.length, 2);
});

test("WorkflowRuntime fails timed out step and records failure", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "TimeoutWorkflow",
    input: "timeout input",
    policy: {
      maxSteps: 5,
      maxRetriesPerStep: 0,
      timeoutMs: 10,
    },
  });

  await assert.rejects(
    () =>
      runtime.executeStep("slow_step", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "too slow";
      }),
    /timed out/,
  );

  const runRecord = runtime.getRunRecord();
  assert.equal(runRecord.steps.length, 1);
  assert.equal(runRecord.steps[0].status, "failed");
  assert.match(runRecord.steps[0].error ?? "", /timed out/);
});
