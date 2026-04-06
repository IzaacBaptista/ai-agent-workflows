import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as llmClient from "../core/llmClient";
import { env } from "../config/env";
import { resetProjectConfigCacheForTesting } from "../config/projectConfig";
import { resetRunMemories, getRunMemory } from "../memory/simpleMemory";
import { setGitToolExecutorForTesting } from "../tools/gitTool";
import { setGitWriteExecutorForTesting } from "../tools/gitWriteTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";
import { runJiraAnalyzeWorkflow } from "../workflows/jiraAnalyzeWorkflow";
import { runJiraApplyWorkflow } from "../workflows/jiraApplyWorkflow";
import { runJiraPrWorkflow } from "../workflows/jiraPrWorkflow";

type MockResponsePayload = Record<string, unknown>;

function buildLlmResponse(payload: MockResponsePayload): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

function createTempRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "ai-agent-workflows-"));
  mkdirSync(join(repoRoot, "app"), { recursive: true });
  writeFileSync(
    join(repoRoot, "app", "ColorService.php"),
    [
      "<?php",
      "class ColorService {",
      "    public function canCreateColor(): bool {",
      "        return true;",
      "    }",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(repoRoot, "ai-agent.config.json"),
    JSON.stringify({ allowedPaths: ["app"], searchPaths: ["app"] }, null, 2),
    "utf-8",
  );
  return repoRoot;
}

function buildMockJiraResponse(issueKey: string) {
  return {
    data: {
      key: issueKey,
      fields: {
        summary: "Fix ColorService create color validation",
        description:
          "Should block color creation when the integration is configured as receive-only.",
        issuetype: { name: "Bug" },
        status: { name: "To Do" },
        priority: { name: "Medium" },
        labels: ["color", "integration"],
        components: [{ name: "catalog" }],
      },
    },
  };
}

function setBaseEnv(): void {
  env.JIRA_BASE_URL = "https://example.atlassian.net";
  env.JIRA_EMAIL = "dev@example.com";
  env.JIRA_API_TOKEN = "jira-token";
  env.GITHUB_TOKEN = "github-token";
  env.GITHUB_REPO = "owner/repo";
}

test("runJiraAnalyzeWorkflow builds deterministic repo context and returns structured analysis", async () => {
  const repoRoot = createTempRepo();
  const previousCwd = process.cwd();
  const originalCallLlm = llmClient.callLLM;
  const originalAxiosGet = axios.get;

  process.chdir(repoRoot);
  resetProjectConfigCacheForTesting();
  resetRunMemories({ clearPersistedRuns: true });
  setBaseEnv();

  setGitToolExecutorForTesting({
    getStatus: async () => ({ entries: [], raw: "" }),
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
  });

  (axios as { get: typeof axios.get }).get = (async () =>
    buildMockJiraResponse("REL-1")) as typeof axios.get;
  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () =>
    buildLlmResponse({
      summary: "Update ColorService to block local creation when integration is receive-only.",
      relevantFiles: ["app/ColorService.php"],
      implementationPlan: ["Guard color creation based on the integration mode."],
      acceptanceCriteria: ["The UI/backend blocks color creation in receive-only mode."],
      risks: ["Existing create flow may regress for writable integrations."],
      testScenarios: ["Try to create a color while integration mode is receive-only."],
      suggestedBranchName: "fix/REL-1-color-integration-guard",
      suggestedPRTitle: "fix(REL-1): block color creation for receive-only integrations",
    });

  try {
    const result = await runJiraAnalyzeWorkflow("REL-1");

    assert.equal(result.success, true);
    if (!result.success) {
      return;
    }

    assert.deepEqual(result.data.relevantFiles, ["app/ColorService.php"]);
    assert.equal(result.meta.repoRoot, repoRoot);

    const runRecord = getRunMemory(result.meta.runId);
    assert.equal(runRecord.artifacts.jiraIssueKey, "REL-1");
    assert.equal(
      (runRecord.artifacts.issueRepositoryContext as { relevantFiles: string[] }).relevantFiles[0],
      "app/ColorService.php",
    );
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    (axios as { get: typeof axios.get }).get = originalAxiosGet;
    setGitToolExecutorForTesting();
    process.chdir(previousCwd);
    resetProjectConfigCacheForTesting();
    resetRunMemories();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runJiraApplyWorkflow reuses prior analysis and applies a localized patch", async () => {
  const repoRoot = createTempRepo();
  const previousCwd = process.cwd();
  const originalCallLlm = llmClient.callLLM;
  const originalAxiosGet = axios.get;

  process.chdir(repoRoot);
  resetProjectConfigCacheForTesting();
  resetRunMemories({ clearPersistedRuns: true });
  setBaseEnv();

  setGitToolExecutorForTesting({
    getStatus: async () => ({ entries: [], raw: "" }),
    getDiff: async () => ({ staged: false, diff: "", changedFiles: [], truncated: false }),
  });
  setRunCommandExecutorForTesting(async () => ({
    command: "test",
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    durationMs: 25,
    signal: null,
  }));

  (axios as { get: typeof axios.get }).get = (async () =>
    buildMockJiraResponse("REL-2")) as typeof axios.get;

  const originalContent = readFileSync(join(repoRoot, "app", "ColorService.php"), "utf-8");
  const updatedContent = originalContent.replace("return true;", "return false;");
  const responses = [
    buildLlmResponse({
      summary: "Update ColorService to block local creation when integration is receive-only.",
      relevantFiles: ["app/ColorService.php"],
      implementationPlan: ["Guard color creation based on the integration mode."],
      acceptanceCriteria: ["The UI/backend blocks color creation in receive-only mode."],
      risks: ["Existing create flow may regress for writable integrations."],
      testScenarios: ["Try to create a color while integration mode is receive-only."],
      suggestedBranchName: "fix/REL-2-color-integration-guard",
      suggestedPRTitle: "fix(REL-2): block color creation for receive-only integrations",
    }),
    buildLlmResponse({
      summary: "Block local color creation in ColorService.",
      edits: [
        {
          path: "app/ColorService.php",
          changeType: "update",
          content: updatedContent,
          reason: "The service must stop creating colors when integration is receive-only.",
        },
      ],
      validationCommand: "test",
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
    const analyzeResult = await runJiraAnalyzeWorkflow("REL-2");
    assert.equal(analyzeResult.success, true);

    const applyResult = await runJiraApplyWorkflow("REL-2");
    assert.equal(applyResult.success, true);
    if (!applyResult.success) {
      return;
    }

    assert.equal(applyResult.data.editedFiles[0], "app/ColorService.php");
    assert.equal(applyResult.data.validationResult?.exitCode, 0);
    assert.match(readFileSync(join(repoRoot, "app", "ColorService.php"), "utf-8"), /return false;/);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    (axios as { get: typeof axios.get }).get = originalAxiosGet;
    setGitToolExecutorForTesting();
    setRunCommandExecutorForTesting();
    process.chdir(previousCwd);
    resetProjectConfigCacheForTesting();
    resetRunMemories();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runJiraPrWorkflow commits, pushes, and opens a PR from the latest apply run", async () => {
  const repoRoot = createTempRepo();
  const previousCwd = process.cwd();
  const originalCallLlm = llmClient.callLLM;
  const originalAxiosGet = axios.get;
  const originalAxiosPost = axios.post;
  const gitWriteCalls: string[][] = [];

  process.chdir(repoRoot);
  resetProjectConfigCacheForTesting();
  resetRunMemories({ clearPersistedRuns: true });
  setBaseEnv();

  setGitToolExecutorForTesting({
    getStatus: async () => ({
      entries: [{ indexStatus: " ", workingTreeStatus: "M", path: "app/ColorService.php" }],
      raw: " M app/ColorService.php",
    }),
    getDiff: async () => ({
      staged: false,
      diff: "--- a/app/ColorService.php\n+++ b/app/ColorService.php\n@@\n-return true;\n+return false;\n",
      changedFiles: ["app/ColorService.php"],
      truncated: false,
    }),
  });
  setRunCommandExecutorForTesting(async () => ({
    command: "test",
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
    durationMs: 25,
    signal: null,
  }));
  setGitWriteExecutorForTesting(async (args) => {
    gitWriteCalls.push(args);
    if (args[0] === "rev-parse") {
      if (args[2] === "HEAD") {
        return { stdout: "main\n", stderr: "", exitCode: 0, signal: null };
      }

      return { stdout: "", stderr: "unknown revision", exitCode: 1, signal: null };
    }

    return { stdout: "", stderr: "", exitCode: 0, signal: null };
  });

  (axios as { get: typeof axios.get }).get = (async () =>
    buildMockJiraResponse("REL-3")) as typeof axios.get;
  (axios as { post: typeof axios.post }).post = (async () =>
    ({ data: { html_url: "https://github.com/owner/repo/pull/42", number: 42 } })) as typeof axios.post;

  const originalContent = readFileSync(join(repoRoot, "app", "ColorService.php"), "utf-8");
  const updatedContent = originalContent.replace("return true;", "return false;");
  const responses = [
    buildLlmResponse({
      summary: "Update ColorService to block local creation when integration is receive-only.",
      relevantFiles: ["app/ColorService.php"],
      implementationPlan: ["Guard color creation based on the integration mode."],
      acceptanceCriteria: ["The UI/backend blocks color creation in receive-only mode."],
      risks: ["Existing create flow may regress for writable integrations."],
      testScenarios: ["Try to create a color while integration mode is receive-only."],
      suggestedBranchName: "fix/REL-3-color-integration-guard",
      suggestedPRTitle: "fix(REL-3): block color creation for receive-only integrations",
    }),
    buildLlmResponse({
      summary: "Block local color creation in ColorService.",
      edits: [
        {
          path: "app/ColorService.php",
          changeType: "update",
          content: updatedContent,
          reason: "The service must stop creating colors when integration is receive-only.",
        },
      ],
      validationCommand: "test",
    }),
    buildLlmResponse({
      title: "fix(REL-3): block color creation for receive-only integrations",
      description: "## Summary\n\nBlocks local color creation when integration is receive-only.",
      suggestedBranchName: "fix/REL-3-color-integration-guard",
      labels: ["bug"],
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
    const analyzeResult = await runJiraAnalyzeWorkflow("REL-3");
    assert.equal(analyzeResult.success, true);

    const applyResult = await runJiraApplyWorkflow("REL-3");
    assert.equal(applyResult.success, true);

    const prResult = await runJiraPrWorkflow("REL-3");
    assert.equal(prResult.success, true);
    if (!prResult.success) {
      return;
    }

    assert.equal(prResult.data.prNumber, 42);
    assert.equal(prResult.data.branchName, "fix/REL-3-color-integration-guard");
    assert.deepEqual(gitWriteCalls, [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["rev-parse", "--verify", "fix/REL-3-color-integration-guard"],
      ["checkout", "-b", "fix/REL-3-color-integration-guard"],
      ["add", "--", "app/ColorService.php"],
      ["commit", "-m", "fix(REL-3): block color creation for receive-only integrations"],
      ["push", "-u", "origin", "fix/REL-3-color-integration-guard"],
    ]);
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    (axios as { get: typeof axios.get }).get = originalAxiosGet;
    (axios as { post: typeof axios.post }).post = originalAxiosPost;
    setGitToolExecutorForTesting();
    setGitWriteExecutorForTesting();
    setRunCommandExecutorForTesting();
    process.chdir(previousCwd);
    resetProjectConfigCacheForTesting();
    resetRunMemories();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
