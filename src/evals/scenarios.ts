import { WorkflowRuntime } from "../core/workflowRuntime";
import {
  CommandExecutionResult,
  WorkflowValidationError,
  WorkflowResult,
  WorkflowRunRecord,
  WorkflowToolCallRecord,
} from "../core/types";
import {
  setCodePatchApplierForTesting,
  setEditableFileContextLoaderForTesting,
} from "../tools/editPatchTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";
import { setGitToolExecutorForTesting } from "../tools/gitTool";
import { setIsolatedWorkspaceFactoryForTesting } from "../tools/isolatedWorkspaceTool";

export interface EvalCheck {
  label: string;
  passed: boolean;
  details?: string;
}

export interface EvalExecutionContext {
  prompts: string[];
  notes: string[];
}

export interface EvalScenario {
  id: string;
  description: string;
  workflow: "issue" | "bug" | "pr";
  input: string;
  mockResponses: Array<{ output_text: string }>;
  seed?: (context: EvalExecutionContext) => Promise<void> | void;
  setup?: (context: EvalExecutionContext) => Promise<void> | void;
  evaluate: (
    result: WorkflowResult<unknown>,
    run: WorkflowRunRecord,
    context: EvalExecutionContext,
  ) => EvalCheck[];
}

function buildLlmResponse(payload: Record<string, unknown>): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

function getToolCalls(run: WorkflowRunRecord): WorkflowToolCallRecord[] {
  return Array.isArray(run.artifacts.toolCalls)
    ? (run.artifacts.toolCalls as WorkflowToolCallRecord[])
    : [];
}

function getCommandResults(run: WorkflowRunRecord): CommandExecutionResult[] {
  return Array.isArray(run.artifacts.commandResults)
    ? (run.artifacts.commandResults as CommandExecutionResult[])
    : [];
}

function promptIncludes(context: EvalExecutionContext, needle: string): boolean {
  return context.prompts.some((prompt) => prompt.includes(needle));
}

function getValidationErrors(run: WorkflowRunRecord): WorkflowValidationError[] {
  return Array.isArray(run.artifacts.validationErrors)
    ? (run.artifacts.validationErrors as WorkflowValidationError[])
    : [];
}

const missingSearchTerm = ["zzzzeval", "missing", "symbol", "k91x"].join("_");

export function getEvalScenarios(): EvalScenario[] {
  return [
    {
      id: "bug-prefers-run-command-test",
      description: "Bug workflow uses run_command(test) and persists executable evidence.",
      workflow: "bug",
      input: "WorkflowRuntime timeouts are not cleared and tests hang after completion",
      setup: () => {
        setRunCommandExecutorForTesting(async (command) => ({
          command,
          exitCode: 1,
          stdout: "1 failing test",
          stderr: "tests hang after completion",
          timedOut: false,
          durationMs: 42,
          signal: null,
        }));
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Prefer executable evidence",
          actions: [
            {
              type: "tool_call",
              toolName: "run_command",
              input: { command: "test" },
              reason: "The test suite is the fastest way to validate the timeout hypothesis",
            },
            {
              type: "finalize",
              task: "Produce the bug diagnosis with command evidence",
              reason: "The command result should support the diagnosis",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Finalize after test command",
          actions: [
            {
              type: "finalize",
              task: "Produce the bug diagnosis with command evidence",
              reason: "Executable evidence is already available",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Bug diagnosis from test evidence",
          possibleCauses: ["uncleared timeout handles"],
          investigationSteps: ["inspect timeout cleanup in WorkflowRuntime"],
          fixSuggestions: ["clear timeout handles in all completion paths"],
          risks: ["tests remain flaky if timers keep the process alive"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Executable evidence is sufficient",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run, context) => {
        const toolCalls = getToolCalls(run);
        const commandResults = getCommandResults(run);

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "planner saw run_command guidance",
            passed:
              promptIncludes(context, "In BugWorkflow, prefer `run_command` with `test`") &&
              promptIncludes(context, "Allowed run_command commands: build, test, lint"),
          },
          {
            label: "exactly one command tool call was executed",
            passed: result.meta.toolCallCount === 1 && toolCalls[0]?.toolName === "run_command",
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
          {
            label: "test command result was persisted",
            passed: commandResults.length === 1 && commandResults[0]?.command === "test",
            details: `commandResults=${commandResults.length}`,
          },
        ];
      },
    },
    {
      id: "bug-applies-edit-patch-and-validates",
      description: "Bug workflow can apply a localized edit_patch and validate it with run_command before finalizing.",
      workflow: "bug",
      input: "Fix WorkflowRuntime timeout cleanup in this repository",
      setup: () => {
        setIsolatedWorkspaceFactoryForTesting(async () => ({
          path: "/isolated-worktree",
          cleanup: async () => undefined,
        }));
        setEditableFileContextLoaderForTesting(() => [
          {
            path: "src/core/workflowRuntime.ts",
            exists: true,
            content: "export const workflowRuntimePatched = false;\n",
          },
        ]);
        setCodePatchApplierForTesting((plan) => ({
          summary: plan.summary,
          edits: [
            {
              path: "src/core/workflowRuntime.ts",
              changeType: "update",
              bytesWritten: 44,
            },
          ],
          validationCommand: plan.validationCommand,
          validationOutcome: "not_run",
          unexpectedChangedFiles: [],
          isolationMode: "direct",
        }));
        setRunCommandExecutorForTesting(async (command) => ({
          command,
          exitCode: 0,
          stdout: "1 passing test",
          stderr: "",
          timedOut: false,
          durationMs: 21,
          signal: null,
        }));
        setGitToolExecutorForTesting({
          async getStatus() {
            return {
              entries: [
                {
                  indexStatus: " ",
                  workingTreeStatus: "M",
                  path: "src/core/workflowRuntime.ts",
                },
              ],
              raw: " M src/core/workflowRuntime.ts",
            };
          },
          async getDiff(staged) {
            return {
              staged,
              changedFiles: ["src/core/workflowRuntime.ts"],
              diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts",
              truncated: false,
            };
          },
        });
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Patch the localized bug first",
          actions: [
            {
              type: "edit_patch",
              task: "Fix the timeout cleanup in WorkflowRuntime and apply the smallest localized code change",
              files: ["src/core/workflowRuntime.ts"],
              reason: "The evidence is already concrete enough for a direct fix",
            },
            {
              type: "finalize",
              task: "Summarize the fix and validation evidence",
              reason: "Finalize after patching and validation",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Apply the timeout cleanup fix",
          edits: [
            {
              path: "src/core/workflowRuntime.ts",
              changeType: "update",
              content: "export const workflowRuntimePatched = true;\n",
              reason: "Apply the localized timeout cleanup fix",
            },
          ],
          validationCommand: "test",
        }),
        buildLlmResponse({
          summary: "Finalize after patch validation",
          actions: [
            {
              type: "finalize",
              task: "Summarize the fix and validation evidence",
              reason: "The patch has already been validated",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Patched bug diagnosis",
          possibleCauses: ["timeout cleanup was incomplete before the patch"],
          investigationSteps: ["inspect the applied patch and validation output"],
          fixSuggestions: ["keep the regression covered with a test"],
          risks: ["future timer changes could reintroduce the bug"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Patch and validation are sufficient",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run, context) => {
        const patchResults = Array.isArray(run.artifacts.patchResults)
          ? (run.artifacts.patchResults as Array<{
              edits: unknown[];
              validationCommand?: string;
              validationOutcome: string;
              isolationMode: string;
            }>)
          : [];
        const commandResults = getCommandResults(run);
        const finalContext = typeof run.artifacts.context === "string" ? run.artifacts.context : "";

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "planner emitted edit_patch guidance",
            passed:
              promptIncludes(context, "Use `edit_patch` only when a concrete repository-local fix is needed") &&
              promptIncludes(context, "Available runtime actions: analyze, edit_patch, tool_call, delegate, finalize"),
          },
          {
            label: "patch was applied and counted",
            passed: result.meta.editActionCount === 1 && patchResults.length === 1,
            details: `editActionCount=${result.meta.editActionCount}`,
          },
          {
            label: "patch triggered automatic validation",
            passed:
              result.meta.toolCallCount === 1 &&
              patchResults[0]?.validationCommand === "test" &&
              commandResults[0]?.command === "test",
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
          {
            label: "patch ran in isolated worktree and produced stable outcome",
            passed:
              patchResults[0]?.isolationMode === "isolated_worktree" &&
              patchResults[0]?.validationOutcome === "unchanged",
          },
          {
            label: "final context includes applied patch evidence",
            passed:
              finalContext.includes("Applied patches:") &&
              finalContext.includes("validate with test") &&
              finalContext.includes("outcome=unchanged"),
          },
        ];
      },
    },
    {
      id: "bug-rejects-regressive-patch",
      description: "Bug workflow exposes regressive isolated patch evidence to the critic and follows a safer redirect.",
      workflow: "bug",
      input: "Attempt to fix WorkflowRuntime timeout cleanup automatically",
      setup: () => {
        let commandInvocationCount = 0;
        setIsolatedWorkspaceFactoryForTesting(async () => ({
          path: "/isolated-worktree",
          cleanup: async () => undefined,
        }));
        setEditableFileContextLoaderForTesting(() => [
          {
            path: "src/core/workflowRuntime.ts",
            exists: true,
            content: "export const workflowRuntimePatched = false;\n",
          },
        ]);
        setCodePatchApplierForTesting((plan) => ({
          summary: plan.summary,
          edits: [
            {
              path: "src/core/workflowRuntime.ts",
              changeType: "update",
              bytesWritten: 44,
            },
          ],
          validationCommand: plan.validationCommand,
          validationOutcome: "not_run",
          unexpectedChangedFiles: [],
          isolationMode: "direct",
        }));
        setRunCommandExecutorForTesting(async (command) => {
          commandInvocationCount += 1;
          if (commandInvocationCount === 1) {
            return {
              command,
              exitCode: 0,
              stdout: "10 passing",
              stderr: "",
              timedOut: false,
              durationMs: 20,
              signal: null,
            };
          }

          return {
            command,
            exitCode: 1,
            stdout: "2 failing",
            stderr: "timeout cleanup regression",
            timedOut: false,
            durationMs: 23,
            signal: null,
          };
        });
        setGitToolExecutorForTesting({
          async getStatus() {
            return {
              entries: [
                {
                  indexStatus: " ",
                  workingTreeStatus: "M",
                  path: "src/core/workflowRuntime.ts",
                },
                {
                  indexStatus: " ",
                  workingTreeStatus: "M",
                  path: "src/core/types.ts",
                },
              ],
              raw: " M src/core/workflowRuntime.ts\n M src/core/types.ts",
            };
          },
          async getDiff(staged) {
            return {
              staged,
              changedFiles: ["src/core/workflowRuntime.ts", "src/core/types.ts"],
              diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts\n+++ b/src/core/types.ts",
              truncated: false,
            };
          },
        });
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Patch the bug first",
          actions: [
            {
              type: "edit_patch",
              task: "Apply a localized fix to WorkflowRuntime timeout cleanup",
              files: ["src/core/workflowRuntime.ts"],
              reason: "The bug looks localized enough for a small fix attempt",
            },
            {
              type: "finalize",
              task: "Summarize the bug analysis",
              reason: "Finalize after the patch attempt",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Apply the timeout cleanup patch",
          edits: [
            {
              path: "src/core/workflowRuntime.ts",
              changeType: "update",
              content: "export const workflowRuntimePatched = true;\n",
              reason: "Apply the localized fix under test",
            },
          ],
          validationCommand: "test",
        }),
        buildLlmResponse({
          summary: "Finalize after the patch attempt",
          actions: [
            {
              type: "finalize",
              task: "Summarize the bug analysis",
              reason: "The patch attempt is complete",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Initial patched bug result",
          possibleCauses: ["timeout cleanup looked incomplete"],
          investigationSteps: ["inspect the isolated patch attempt"],
          fixSuggestions: ["accept the patch if it is safe"],
          risks: ["patch safety is still uncertain"],
        }),
        buildLlmResponse({
          approved: false,
          summary: "Reject the regressive patch attempt",
          missingEvidence: ["The isolated patch regressed validation and touched unexpected files"],
          confidence: "high",
          nextAction: {
            type: "finalize",
            task: "Explain why the isolated patch must be rejected",
            reason: "The current evidence shows the patch regressed validation",
          },
        }),
        buildLlmResponse({
          summary: "Reject regressive patch",
          possibleCauses: ["the isolated patch worsened the test outcome"],
          investigationSteps: ["compare pre-patch and post-patch validation results"],
          fixSuggestions: ["narrow the patch and retry in isolation"],
          risks: ["unexpected file changes broaden the patch scope"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "The redirected conclusion is now appropriately cautious",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run, context) => {
        const patchResults = Array.isArray(run.artifacts.patchResults)
          ? (run.artifacts.patchResults as Array<{
              validationOutcome: string;
              unexpectedChangedFiles: string[];
            }>)
          : [];

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "patch regression was recorded",
            passed:
              patchResults[0]?.validationOutcome === "regressed" &&
              patchResults[0]?.unexpectedChangedFiles.includes("src/core/types.ts"),
          },
          {
            label: "critic saw regression evidence in its prompt",
            passed:
              promptIncludes(context, "patch_test_regressed") &&
              promptIncludes(context, "unexpectedChangedFiles=1"),
          },
          {
            label: "critic redirect executed before approval",
            passed: result.meta.criticRedirectCount === 1,
            details: `criticRedirectCount=${result.meta.criticRedirectCount}`,
          },
        ];
      },
    },
    {
      id: "pr-prefers-run-command-build",
      description: "PR workflow chooses run_command(build) for core runtime and type changes.",
      workflow: "pr",
      input: "Refactored WorkflowRuntime, action schemas, and core types used by the PR review flow",
      setup: () => {
        setRunCommandExecutorForTesting(async (command) => ({
          command,
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
          timedOut: false,
          durationMs: 31,
          signal: null,
        }));
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Use build evidence first",
          actions: [
            {
              type: "tool_call",
              toolName: "run_command",
              input: { command: "build" },
              reason: "Core runtime and type changes should be validated with a build",
            },
            {
              type: "finalize",
              task: "Produce the PR review with build evidence",
              reason: "The build result should narrow the conclusion",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Finalize after build",
          actions: [
            {
              type: "finalize",
              task: "Produce the PR review with build evidence",
              reason: "Build verification already ran",
            },
          ],
        }),
        buildLlmResponse({
          summary: "PR review from build evidence",
          impacts: ["Runtime and type changes compile successfully"],
          risks: ["Behavioral coverage still depends on tests"],
          suggestions: ["Pair the build with targeted regression tests when behavior changes"],
          testRecommendations: ["Run the full test suite for runtime-sensitive diffs"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Build evidence is sufficient for this review",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run, context) => {
        const commandResults = getCommandResults(run);

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "planner saw build-oriented PR guidance",
            passed:
              promptIncludes(context, "In PRReviewWorkflow, prefer `run_command` with `build`") &&
              promptIncludes(context, "Allowed run_command commands: build, test, lint"),
          },
          {
            label: "build command was executed once",
            passed: result.meta.toolCallCount === 1 && commandResults[0]?.command === "build",
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
        ];
      },
    },
    {
      id: "pr-prefers-run-command-lint",
      description: "PR workflow chooses run_command(lint) for narrow static contract changes.",
      workflow: "pr",
      input: "Normalized RuntimeAction names and tightened core type contracts without changing behavior",
      setup: () => {
        setRunCommandExecutorForTesting(async (command) => ({
          command,
          exitCode: 0,
          stdout: "typecheck ok",
          stderr: "",
          timedOut: false,
          durationMs: 19,
          signal: null,
        }));
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Use lint for static verification",
          actions: [
            {
              type: "tool_call",
              toolName: "run_command",
              input: { command: "lint" },
              reason: "This looks like a narrow static contract change",
            },
            {
              type: "finalize",
              task: "Produce the PR review with static verification evidence",
              reason: "Lint should be the narrowest useful proof here",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Finalize after lint",
          actions: [
            {
              type: "finalize",
              task: "Produce the PR review with static verification evidence",
              reason: "Static verification already ran",
            },
          ],
        }),
        buildLlmResponse({
          summary: "PR review from lint evidence",
          impacts: ["Static contracts remain type-safe"],
          risks: ["Behavioral regressions still need runtime-focused checks"],
          suggestions: ["Use lint for narrow schema/type refactors before escalating to build"],
          testRecommendations: ["Run build or test only if runtime behavior also changed"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Static verification is sufficient",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run, context) => {
        const commandResults = getCommandResults(run);

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "planner saw lint-oriented PR guidance",
            passed: promptIncludes(context, "prefer `run_command` with `lint`"),
          },
          {
            label: "lint command was executed once",
            passed: result.meta.toolCallCount === 1 && commandResults[0]?.command === "lint",
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
        ];
      },
    },
    {
      id: "pr-uses-git-context-tools",
      description: "PR workflow uses git_status and git_diff and includes that context in final analysis.",
      workflow: "pr",
      input: "Added CriticAgent, persisted runs to disk, and normalized GitHub PR comment meta",
      setup: () => {
        setGitToolExecutorForTesting({
          async getStatus() {
            return {
              entries: [
                {
                  indexStatus: "M",
                  workingTreeStatus: " ",
                  path: "src/core/workflowRuntime.ts",
                },
              ],
              raw: "M  src/core/workflowRuntime.ts",
            };
          },
          async getDiff(staged) {
            return {
              staged,
              changedFiles: ["src/core/workflowRuntime.ts"],
              diff: "diff --git a/src/core/workflowRuntime.ts b/src/core/workflowRuntime.ts",
              truncated: false,
            };
          },
        });
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Inspect git status first",
          actions: [
            {
              type: "tool_call",
              toolName: "git_status",
              input: {},
              reason: "Need the local change set before reviewing",
            },
            {
              type: "finalize",
              task: "Produce the PR review",
              reason: "Finalize after repository context is gathered",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Inspect git diff next",
          actions: [
            {
              type: "tool_call",
              toolName: "git_diff",
              input: { staged: false },
              reason: "Need the modified hunks before concluding",
            },
            {
              type: "finalize",
              task: "Produce the PR review",
              reason: "Finalize after diff evidence is gathered",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Finalize with git evidence",
          actions: [
            {
              type: "finalize",
              task: "Produce the PR review with repository evidence",
              reason: "Enough Git context is available",
            },
          ],
        }),
        buildLlmResponse({
          summary: "PR review from git evidence",
          impacts: ["Runtime step accounting changed"],
          risks: ["Persistence may drift if not covered by tests"],
          suggestions: ["Add workflow runtime regression coverage"],
          testRecommendations: ["Run the PR workflow eval harness"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Git evidence is sufficient",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run) => {
        const finalContext = typeof run.artifacts.context === "string" ? run.artifacts.context : "";

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "git tools were executed",
            passed:
              result.meta.toolCallCount === 2 &&
              Boolean(run.artifacts.gitStatusResult) &&
              Boolean(run.artifacts.gitDiffResult),
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
          {
            label: "final context includes git status and git diff evidence",
            passed:
              finalContext.includes("Git status:") &&
              finalContext.includes("Git diff:") &&
              finalContext.includes("src/core/workflowRuntime.ts"),
          },
        ];
      },
    },
    {
      id: "pr-uses-staged-git-diff",
      description: "PR workflow can request staged git diff context when the staged change set is the relevant evidence.",
      workflow: "pr",
      input: "Review the currently staged PR changes before commit",
      setup: () => {
        setGitToolExecutorForTesting({
          async getStatus() {
            return {
              entries: [],
              raw: "",
            };
          },
          async getDiff(staged) {
            return {
              staged,
              changedFiles: ["src/core/types.ts"],
              diff: "diff --git a/src/core/types.ts b/src/core/types.ts",
              truncated: false,
            };
          },
        });
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Use staged diff directly",
          actions: [
            {
              type: "tool_call",
              toolName: "git_diff",
              input: { staged: true },
              reason: "The staged diff is the exact review surface right now",
            },
            {
              type: "finalize",
              task: "Produce the PR review from staged diff evidence",
              reason: "The staged diff should be enough for a first review pass",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Finalize after staged diff",
          actions: [
            {
              type: "finalize",
              task: "Produce the PR review from staged diff evidence",
              reason: "The staged diff is already available",
            },
          ],
        }),
        buildLlmResponse({
          summary: "PR review from staged diff",
          impacts: ["The staged type contract changes are visible"],
          risks: ["Unstaged local changes are not part of this review"],
          suggestions: ["Keep the staged diff small and reviewable"],
          testRecommendations: ["Run the eval harness against staged changes before commit"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Staged diff evidence is sufficient",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run, context) => {
        const finalContext = typeof run.artifacts.context === "string" ? run.artifacts.context : "";
        const gitDiffResult = run.artifacts.gitDiffResult as { staged?: boolean } | undefined;

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "prompt included git diff guidance",
            passed: promptIncludes(context, "Use `tool_call` with `git_status` or `git_diff`"),
          },
          {
            label: "staged git diff was persisted and surfaced",
            passed:
              result.meta.toolCallCount === 1 &&
              gitDiffResult?.staged === true &&
              finalContext.includes("staged=true"),
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
        ];
      },
    },
    {
      id: "duplicate-tool-call-is-suppressed",
      description: "Repeated identical run_command calls are suppressed instead of re-executed.",
      workflow: "issue",
      input: "Repeated build checks are being scheduled without any state change",
      setup: () => {
        setRunCommandExecutorForTesting(async (command) => ({
          command,
          exitCode: 0,
          stdout: "build passed",
          stderr: "",
          timedOut: false,
          durationMs: 28,
          signal: null,
        }));
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Run build once",
          actions: [
            {
              type: "tool_call",
              toolName: "run_command",
              input: { command: "build" },
              reason: "Need build evidence first",
            },
            {
              type: "finalize",
              task: "Produce the issue analysis",
              reason: "Finalize once build evidence is available",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Try the same command again",
          actions: [
            {
              type: "tool_call",
              toolName: "run_command",
              input: { command: "build" },
              reason: "Validate whether the build result changed",
            },
            {
              type: "finalize",
              task: "Produce the issue analysis",
              reason: "Finalize after the second build check",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Issue analysis from cached build evidence",
          questions: ["Can we avoid re-running identical commands?"],
          acceptanceCriteria: ["Repeated identical commands are suppressed"],
          technicalPlan: ["Reuse cached command evidence when state has not changed"],
          testScenarios: ["Schedule the same build twice without changing context"],
          risks: ["Over-suppressing commands when state actually changes"],
          assumptions: ["The working memory signature is stable across the duplicate call"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Cached command evidence is acceptable",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run) => {
        const toolCalls = getToolCalls(run);
        const commandResults = getCommandResults(run);

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "only one real command execution occurred",
            passed: result.meta.toolCallCount === 1 && commandResults.length === 1,
            details: `toolCallCount=${result.meta.toolCallCount}, commandResults=${commandResults.length}`,
          },
          {
            label: "duplicate command call was suppressed and cached",
            passed:
              toolCalls.length >= 2 &&
              toolCalls[1]?.toolName === "run_command" &&
              toolCalls[1]?.suppressed === true &&
              toolCalls[1]?.cached === true,
          },
        ];
      },
    },
    {
      id: "issue-empty-search-forces-finalization",
      description: "Issue workflow forces finalization when search_code returns no progress.",
      workflow: "issue",
      input: "Investigate a missing repository symbol that should not trigger a search loop",
      mockResponses: [
        buildLlmResponse({
          summary: "Search once before concluding",
          actions: [
            {
              type: "tool_call",
              toolName: "search_code",
              input: { terms: [missingSearchTerm] },
              reason: "Need to confirm whether the symbol exists in the repository",
            },
            {
              type: "finalize",
              task: "Produce the issue analysis after the search result",
              reason: "Finalize after the repository check",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Issue analysis after empty search",
          questions: ["Should missing search results immediately force a conclusion?"],
          acceptanceCriteria: ["The runtime avoids a no-progress search loop"],
          technicalPlan: ["Surface the empty search result and conclude"],
          testScenarios: ["Search for a term with zero repository matches"],
          risks: ["Forcing finalization too early can skip a better alternate tool"],
          assumptions: ["The missing term truly has no code matches"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "The forced finalization path is acceptable",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run) => {
        const forcedReason =
          typeof run.artifacts.forcedFinalAnalysisReason === "string"
            ? run.artifacts.forcedFinalAnalysisReason
            : "";
        const codeSearchResults = run.artifacts.codeSearchResults as Record<string, unknown[]> | undefined;

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "empty search triggered forced finalization without replanning",
            passed:
              result.meta.toolCallCount === 1 &&
              result.meta.replanCount === 0 &&
              forcedReason.includes('No progress after tool_call "search_code"'),
            details: `toolCallCount=${result.meta.toolCallCount}, replanCount=${result.meta.replanCount}`,
          },
          {
            label: "empty search result was persisted",
            passed: Array.isArray(codeSearchResults?.[missingSearchTerm]) && codeSearchResults?.[missingSearchTerm]?.length === 0,
          },
        ];
      },
    },
    {
      id: "critic-redirects-to-run-command",
      description: "Critic can redirect the workflow to executable evidence before approving the final answer.",
      workflow: "bug",
      input: "WorkflowRuntime teardown might still leak timers after completion",
      setup: () => {
        setRunCommandExecutorForTesting(async (command) => ({
          command,
          exitCode: 1,
          stdout: "",
          stderr: "tests hang after completion",
          timedOut: false,
          durationMs: 37,
          signal: null,
        }));
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Draft a provisional diagnosis first",
          actions: [
            {
              type: "finalize",
              task: "Draft a provisional bug diagnosis from the current evidence",
              reason: "Start with a concise candidate result",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Initial bug diagnosis",
          possibleCauses: ["timeout handles are not always cleared"],
          investigationSteps: ["inspect WorkflowRuntime"],
          fixSuggestions: ["centralize timer cleanup"],
          risks: ["tests may hang intermittently"],
        }),
        buildLlmResponse({
          approved: false,
          summary: "Need executable evidence before approving",
          missingEvidence: ["test command output"],
          confidence: "low",
          nextAction: {
            type: "tool_call",
            toolName: "run_command",
            input: { command: "test" },
            reason: "Use the test suite to validate the hanging-timer hypothesis",
          },
        }),
        buildLlmResponse({
          summary: "Finalize after test evidence",
          actions: [
            {
              type: "finalize",
              task: "Produce the final bug diagnosis using the test output",
              reason: "Executable evidence is now available",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Bug diagnosis with test evidence",
          possibleCauses: ["uncleared timeout handles keep the event loop alive"],
          investigationSteps: ["inspect timeout cleanup and teardown paths"],
          fixSuggestions: ["clear handles in finally and add teardown coverage"],
          risks: ["flaky tests if timer cleanup stays partial"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Executable evidence addressed the gap",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, run) => {
        const commandResults = getCommandResults(run);
        const criticRedirects = Array.isArray(run.artifacts.criticRedirects)
          ? (run.artifacts.criticRedirects as unknown[])
          : [];

        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "critic redirect was recorded",
            passed: result.meta.criticRedirectCount === 1 && criticRedirects.length === 1,
            details: `criticRedirectCount=${result.meta.criticRedirectCount}`,
          },
          {
            label: "critic redirect led to an executable command",
            passed: result.meta.toolCallCount === 1 && commandResults[0]?.command === "test",
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
        ];
      },
    },
    {
      id: "planner-invalid-tool-fails-fast",
      description: "Workflow fails safely when the planner repeatedly emits an unsupported tool.",
      workflow: "issue",
      input: "Trigger an invalid planner output for evaluation",
      mockResponses: [
        buildLlmResponse({
          summary: "Invalid plan attempt one",
          actions: [
            {
              type: "tool_call",
              toolName: "totally_unknown_tool",
              input: {},
              reason: "invalid tool name for eval",
            },
            {
              type: "finalize",
              task: "This should never execute",
              reason: "invalid",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Invalid plan attempt two",
          actions: [
            {
              type: "tool_call",
              toolName: "totally_unknown_tool",
              input: {},
              reason: "invalid tool name for eval",
            },
            {
              type: "finalize",
              task: "This should never execute",
              reason: "invalid",
            },
          ],
        }),
      ],
      evaluate: (result, run) => {
        const validationErrors = getValidationErrors(run);

        return [
          {
            label: "workflow fails safely",
            passed: !result.success,
            details: result.success ? "unexpected success" : result.error,
          },
          {
            label: "no tool calls were executed",
            passed: result.meta.toolCallCount === 0,
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
          {
            label: "planner validation error was recorded once",
            passed:
              validationErrors.length === 1 &&
              validationErrors[0]?.kind === "planner" &&
              validationErrors[0]?.message.includes("schema validation"),
            details: `validationErrors=${validationErrors.length}`,
          },
        ];
      },
    },
    {
      id: "memory-influences-planner",
      description: "Relevant memory reaches the planner and changes the initial decision.",
      workflow: "bug",
      input: "__eval__ repeated build failure in workflow runtime",
      seed: (context) => {
        const priorRuntime = new WorkflowRuntime({
          workflowName: "BugWorkflow",
          input: "__eval__ repeated build failure in workflow runtime",
        });

        priorRuntime.saveArtifact("commandResults", [
          {
            command: "build",
            exitCode: 1,
            stdout: "",
            stderr: "build failed",
            timedOut: false,
            durationMs: 12,
            signal: null,
          } satisfies CommandExecutionResult,
        ]);
        priorRuntime.forceFinalAnalysis("Avoid repeating build when the state has not changed");
        priorRuntime.complete();
        context.notes.push(`seeded prior run ${priorRuntime.runId}`);
      },
      mockResponses: [
        buildLlmResponse({
          summary: "Use relevant memory instead of re-running build",
          actions: [
            {
              type: "finalize",
              task: "Produce the bug diagnosis using relevant memory and without re-running build",
              reason: "Relevant memory already shows the prior build failure",
            },
          ],
        }),
        buildLlmResponse({
          summary: "Bug diagnosis from relevant memory",
          possibleCauses: ["the state did not materially change after the last failed build"],
          investigationSteps: ["inspect what changed before re-running build"],
          fixSuggestions: ["reuse prior build evidence until the state changes"],
          risks: ["memory may hide a genuinely changed build state"],
        }),
        buildLlmResponse({
          approved: true,
          summary: "Memory-backed decision is acceptable",
          missingEvidence: [],
          confidence: "high",
        }),
      ],
      evaluate: (result, _run, context) => {
        return [
          {
            label: "workflow completes successfully",
            passed: result.success,
            details: result.success ? result.meta.runId : result.error,
          },
          {
            label: "planner prompt included relevant memory and command patterns",
            passed:
              promptIncludes(context, "Relevant memory") &&
              promptIncludes(context, "build_failed") &&
              promptIncludes(context, "Avoid repeating build when the state has not changed"),
          },
          {
            label: "memory hits were recorded in metadata",
            passed: result.meta.memoryHits > 0,
            details: `memoryHits=${result.meta.memoryHits}`,
          },
          {
            label: "planner avoided re-running build immediately",
            passed: result.meta.toolCallCount === 0,
            details: `toolCallCount=${result.meta.toolCallCount}`,
          },
        ];
      },
    },
  ];
}
