import test from "node:test";
import assert from "node:assert/strict";
import { setGitToolExecutorForTesting } from "../tools/gitTool";
import { collectTriageContext, formatCollectedContext } from "../workflows/contextCollector";
import { IssueTriage, GitStatusResult, GitLogResult } from "../core/types";

const EMPTY_GIT_STATUS: GitStatusResult = { entries: [], raw: "" };
const EMPTY_GIT_LOG: GitLogResult = { commits: [], truncated: false };

function makeGitExecutor(
  status: GitStatusResult = EMPTY_GIT_STATUS,
  log: GitLogResult = EMPTY_GIT_LOG,
) {
  return {
    getStatus: async () => status,
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
    getLog: async () => log,
  };
}

function makeTriage(overrides: Partial<IssueTriage> = {}): IssueTriage {
  return {
    summary: "test triage",
    investigationAreas: [],
    codeSearchTerms: [],
    validationChecks: [],
    ...overrides,
  };
}

test("collectTriageContext returns empty results for empty triage", async () => {
  setGitToolExecutorForTesting(makeGitExecutor());

  try {
    const ctx = await collectTriageContext(makeTriage());

    assert.deepEqual(ctx.codeSearchResults, {});
    assert.deepEqual(ctx.fileReadResults, []);
    assert.deepEqual(ctx.gitStatus, EMPTY_GIT_STATUS);
    assert.deepEqual(ctx.gitLog, EMPTY_GIT_LOG);
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("collectTriageContext runs searchCode for each codeSearchTerm", async () => {
  setGitToolExecutorForTesting(makeGitExecutor());

  try {
    const triage = makeTriage({
      codeSearchTerms: ["WorkflowRuntime", "runActionQueue"],
    });

    const ctx = await collectTriageContext(triage);

    assert.ok("WorkflowRuntime" in ctx.codeSearchResults, "should have WorkflowRuntime key");
    assert.ok("runActionQueue" in ctx.codeSearchResults, "should have runActionQueue key");
    assert.ok(Array.isArray(ctx.codeSearchResults["WorkflowRuntime"]));
    assert.ok(Array.isArray(ctx.codeSearchResults["runActionQueue"]));
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("collectTriageContext caps codeSearchTerms at 5", async () => {
  setGitToolExecutorForTesting(makeGitExecutor());

  try {
    const triage = makeTriage({
      codeSearchTerms: ["a", "b", "c", "d", "e", "f", "g"],
    });

    const ctx = await collectTriageContext(triage);

    assert.equal(Object.keys(ctx.codeSearchResults).length, 5);
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("collectTriageContext skips investigationAreas that are not file paths", async () => {
  setGitToolExecutorForTesting(makeGitExecutor());

  try {
    const triage = makeTriage({
      investigationAreas: ["auth middleware logic", "database connection pool"],
    });

    const ctx = await collectTriageContext(triage);

    assert.deepEqual(ctx.fileReadResults, []);
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("collectTriageContext does not throw when git commands fail", async () => {
  setGitToolExecutorForTesting({
    getStatus: async () => { throw new Error("git not available"); },
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
    getLog: async () => { throw new Error("git log failed"); },
  });

  try {
    const ctx = await collectTriageContext(makeTriage());

    assert.deepEqual(ctx.gitStatus, EMPTY_GIT_STATUS);
    assert.deepEqual(ctx.gitLog, EMPTY_GIT_LOG);
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("collectTriageContext includes git status and log results", async () => {
  const gitStatus: GitStatusResult = {
    entries: [{ indexStatus: "M", workingTreeStatus: " ", path: "src/foo.ts" }],
    raw: "M  src/foo.ts",
  };
  const gitLog: GitLogResult = {
    commits: [
      {
        hash: "abc1234",
        subject: "fix: something",
        author: "Dev",
        date: "2026-01-01",
        files: ["src/foo.ts"],
      },
    ],
    truncated: false,
  };

  setGitToolExecutorForTesting(makeGitExecutor(gitStatus, gitLog));

  try {
    const ctx = await collectTriageContext(makeTriage());

    assert.deepEqual(ctx.gitStatus, gitStatus);
    assert.deepEqual(ctx.gitLog, gitLog);
  } finally {
    setGitToolExecutorForTesting();
  }
});

test("formatCollectedContext returns a non-empty string summarizing context", async () => {
  setGitToolExecutorForTesting(makeGitExecutor());

  try {
    const ctx = await collectTriageContext(
      makeTriage({ codeSearchTerms: ["WorkflowRuntime"] }),
    );
    const formatted = formatCollectedContext(ctx);

    assert.ok(typeof formatted === "string");
    assert.ok(formatted.length > 0);
    assert.ok(formatted.includes("Code search results:"));
    assert.ok(formatted.includes("Git status:"));
    assert.ok(formatted.includes("Git log:"));
  } finally {
    setGitToolExecutorForTesting();
  }
});
