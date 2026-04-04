import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflowTool } from "../tools/toolExecutor";
import { readFiles } from "../tools/readFileTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";

test("toolExecutor executes search_code", async () => {
  const result = await executeWorkflowTool({
    toolName: "search_code",
    input: { terms: ["WorkflowRuntime"] },
  });

  assert.equal(result.tool, "search_code");
  assert.match(result.summary, /terms=1/);
  assert.equal(typeof result.data, "object");
});

test("toolExecutor executes read_file", async () => {
  const result = await executeWorkflowTool({
    toolName: "read_file",
    input: { files: ["src/core/types.ts"] },
  });

  assert.equal(result.tool, "read_file");
  assert.match(result.summary, /files=1/);
  assert.ok(Array.isArray(result.data));
  assert.equal(result.data.length, 1);
});

test("toolExecutor returns unconfigured external API response when base URL is absent", async () => {
  const result = await executeWorkflowTool({
    toolName: "call_external_api",
    input: { endpoint: "health" },
  });

  assert.equal(result.tool, "call_external_api");
  assert.match(result.summary, /status=/);
  assert.equal(typeof result.data, "object");
});

test("toolExecutor executes run_command through the allowlisted command runner", async () => {
  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 0,
    stdout: "build ok",
    stderr: "",
    timedOut: false,
    durationMs: 12,
    signal: null,
  }));

  try {
    const result = await executeWorkflowTool({
      toolName: "run_command",
      input: { command: "build" },
    });

    assert.equal(result.tool, "run_command");
    assert.match(result.summary, /command=build/);
    assert.equal(typeof result.data, "object");
  } finally {
    setRunCommandExecutorForTesting();
  }
});

test("readFiles rejects paths outside allowed scope", () => {
  assert.throws(
    () => readFiles(["README.md"]),
    /outside the allowed read scope/,
  );
});
