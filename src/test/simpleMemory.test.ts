import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { env } from "../config/env";
import { buildRelevantMemoryContext } from "../memory/runMemoryStore";
import {
  appendRunStep,
  completeRun,
  createRunMemory,
  failRun,
  get,
  getAll,
  getAllRunMemories,
  getRunMemory,
  resetRunMemories,
  save,
  saveRunArtifact,
  updateRunStep,
} from "../memory/simpleMemory";
import { WorkflowExecutionPolicy } from "../core/types";

const runStorageDir = resolve(process.cwd(), env.RUN_STORAGE_DIR);

const defaultPolicy: WorkflowExecutionPolicy = {
  maxSteps: 10,
  maxRetriesPerStep: 1,
  timeoutMs: 60_000,
  maxConsecutiveNoProgress: 2,
  maxToolCalls: 5,
  maxRepeatedIdenticalToolCalls: 2,
  maxEditActionsPerRun: 2,
  maxFilesPerEditAction: 3,
  maxDelegationsPerRun: 2,
  maxDelegationDepth: 1,
  maxCriticRedirects: 2,
};

test("simpleMemory ignores non-run JSON files in the persisted run directory", () => {
  resetRunMemories({ clearPersistedRuns: true });

  const supportFilePath = join(runStorageDir, "llm-rate-limit.json");
  mkdirSync(dirname(supportFilePath), { recursive: true });
  writeFileSync(
    supportFilePath,
    JSON.stringify({
      openUntil: Date.now() + 5000,
      reason: "provider_rate_limit",
      updatedAt: new Date().toISOString(),
    }),
    "utf-8",
  );

  try {
    resetRunMemories();

    assert.deepEqual(getAllRunMemories(), []);
    assert.doesNotThrow(() =>
      buildRelevantMemoryContext("IssueWorkflow", "planner keeps retrying search_code"),
    );
  } finally {
    resetRunMemories({ clearPersistedRuns: true });
  }
});

test("save and get store arbitrary key-value pairs", () => {
  save("testKey", { foo: "bar" });
  const result = get("testKey");
  assert.deepEqual(result, { foo: "bar" });
});

test("getAll returns all stored key-value pairs", () => {
  resetRunMemories({ clearPersistedRuns: true });
  save("alpha", 1);
  save("beta", 2);
  const all = getAll();
  assert.equal(all["alpha"], 1);
  assert.equal(all["beta"], 2);
});

test("createRunMemory creates a run record with running status", () => {
  resetRunMemories({ clearPersistedRuns: true });
  const run = createRunMemory({
    runId: "run-create-test",
    workflowName: "TestWorkflow",
    input: "test input",
    policy: defaultPolicy,
  });

  assert.equal(run.runId, "run-create-test");
  assert.equal(run.workflowName, "TestWorkflow");
  assert.equal(run.status, "running");
  assert.equal(run.input, "test input");
  assert.deepEqual(run.steps, []);
  assert.deepEqual(run.artifacts, {});
  assert.equal(typeof run.startedAt, "string");
});

test("getRunMemory throws for unknown run ID", () => {
  resetRunMemories({ clearPersistedRuns: true });
  assert.throws(
    () => getRunMemory("nonexistent-run-id"),
    /Unknown workflow run "nonexistent-run-id"/,
  );
});

test("appendRunStep adds a step to the run", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-append-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  appendRunStep("run-append-test", {
    stepId: "plan:1:1",
    name: "plan",
    status: "completed",
    attempt: 1,
    startedAt: new Date().toISOString(),
  });

  const run = getRunMemory("run-append-test");
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].stepId, "plan:1:1");
  assert.equal(run.steps[0].name, "plan");
});

test("updateRunStep updates an existing step", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-update-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  appendRunStep("run-update-test", {
    stepId: "finalize:1:1",
    name: "finalize",
    status: "running",
    attempt: 1,
    startedAt: new Date().toISOString(),
  });

  updateRunStep("run-update-test", "finalize:1:1", {
    status: "completed",
    outputSummary: "done",
  });

  const run = getRunMemory("run-update-test");
  assert.equal(run.steps[0].status, "completed");
  assert.equal(run.steps[0].outputSummary, "done");
});

test("updateRunStep throws for unknown step ID", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-bad-step-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  assert.throws(
    () => updateRunStep("run-bad-step-test", "nonexistent-step", { status: "completed" }),
    /Unknown workflow step "nonexistent-step" for run "run-bad-step-test"/,
  );
});

test("completeRun transitions status to completed", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-complete-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  const completed = completeRun("run-complete-test");
  assert.equal(completed.status, "completed");
  assert.equal(typeof completed.completedAt, "string");
});

test("failRun transitions status to failed with error message", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-fail-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  const failed = failRun("run-fail-test", "Something went wrong");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Something went wrong");
  assert.equal(typeof failed.completedAt, "string");
});

test("getAllRunMemories returns all tracked runs", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-list-a",
    workflowName: "TestWorkflow",
    input: "input a",
    policy: defaultPolicy,
  });
  createRunMemory({
    runId: "run-list-b",
    workflowName: "TestWorkflow",
    input: "input b",
    policy: defaultPolicy,
  });

  const all = getAllRunMemories();
  const ids = all.map((r) => r.runId);
  assert.ok(ids.includes("run-list-a"));
  assert.ok(ids.includes("run-list-b"));
});

test("saveRunArtifact stores an artifact on the run", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-artifact-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  saveRunArtifact("run-artifact-test", "result", { summary: "artifact summary" });

  const run = getRunMemory("run-artifact-test");
  assert.deepEqual(run.artifacts["result"], { summary: "artifact summary" });
});

test("resetRunMemories clears in-memory runs", () => {
  resetRunMemories({ clearPersistedRuns: true });
  createRunMemory({
    runId: "run-reset-test",
    workflowName: "TestWorkflow",
    input: "input",
    policy: defaultPolicy,
  });

  resetRunMemories({ clearPersistedRuns: true });
  assert.deepEqual(getAllRunMemories(), []);
});

test("simpleMemory ignores corrupted JSON files in the persisted run directory", () => {
  resetRunMemories({ clearPersistedRuns: true });

  const corruptPath = join(runStorageDir, "corrupted-run.json");
  mkdirSync(runStorageDir, { recursive: true });
  writeFileSync(corruptPath, "{ this is not valid json", "utf-8");

  try {
    assert.doesNotThrow(() => resetRunMemories());
    assert.deepEqual(getAllRunMemories(), []);
  } finally {
    resetRunMemories({ clearPersistedRuns: true });
  }
});

test("simpleMemory ignores JSON files that are not valid WorkflowRunRecord objects", () => {
  resetRunMemories({ clearPersistedRuns: true });

  const invalidPath = join(runStorageDir, "invalid-run.json");
  mkdirSync(runStorageDir, { recursive: true });
  writeFileSync(invalidPath, JSON.stringify({ foo: "bar", notARunRecord: true }), "utf-8");

  try {
    assert.doesNotThrow(() => resetRunMemories());
    assert.deepEqual(getAllRunMemories(), []);
  } finally {
    resetRunMemories({ clearPersistedRuns: true });
  }
});
