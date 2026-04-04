import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflowTool } from "../tools/toolExecutor";
import { setGitToolExecutorForTesting } from "../tools/gitTool";
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

test("toolExecutor executes lint through the allowlisted command runner", async () => {
  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 0,
    stdout: "lint ok",
    stderr: "",
    timedOut: false,
    durationMs: 10,
    signal: null,
  }));

  try {
    const result = await executeWorkflowTool({
      toolName: "run_command",
      input: { command: "lint" },
    });

    assert.equal(result.tool, "run_command");
    assert.match(result.summary, /command=lint/);
    assert.equal(typeof result.data, "object");
  } finally {
    setRunCommandExecutorForTesting();
  }
});

test("toolExecutor executes git_status through the git tool runner", async () => {
  setGitToolExecutorForTesting({
    getStatus: async () => ({
      entries: [
        { indexStatus: "M", workingTreeStatus: " ", path: "src/core/workflowRuntime.ts" },
        { indexStatus: "?", workingTreeStatus: "?", path: "src/tools/gitTool.ts" },
      ],
      raw: "M  src/core/workflowRuntime.ts\n?? src/tools/gitTool.ts",
    }),
    getDiff: async () => ({
      staged: false,
      diff: "",
      changedFiles: [],
      truncated: false,
    }),
  });

  try {
    const result = await executeWorkflowTool({
      toolName: "git_status",
      input: {},
    });

    assert.equal(result.tool, "git_status");
    assert.match(result.summary, /entries=2/);
    assert.equal(typeof result.data, "object");
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("toolExecutor executes git_diff through the git tool runner", async () => {
  setGitToolExecutorForTesting({
    getStatus: async () => ({
      entries: [],
      raw: "",
    }),
    getDiff: async (staged) => ({
      staged,
      diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts",
      changedFiles: ["src/core/workflowRuntime.ts"],
      truncated: false,
    }),
  });

  try {
    const result = await executeWorkflowTool({
      toolName: "git_diff",
      input: { staged: false },
    });

    assert.equal(result.tool, "git_diff");
    assert.match(result.summary, /files=1/);
    assert.equal(typeof result.data, "object");
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("readFiles rejects paths outside allowed scope", () => {
  assert.throws(
    () => readFiles(["README.md"]),
    /outside the allowed read scope/,
  );
});
