import test from "node:test";
import assert from "node:assert/strict";
import * as llmClient from "../core/llmClient";
import {
  RuntimeAction,
  WorkflowCritique,
  WorkflowPlan,
  WorkflowReplan,
} from "../core/types";
import {
  WorkflowDefinition,
  WorkflowExecutionState,
  WorkflowRuntime,
} from "../core/workflowRuntime";
import {
  setCodePatchApplierForTesting,
  setEditableFileContextLoaderForTesting,
} from "../tools/editPatchTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";

interface TestTriage {
  summary: string;
}

interface TestResult {
  done: boolean;
  note: string;
}

function buildLlmResponse(payload: Record<string, unknown>): { output_text: string } {
  return {
    output_text: JSON.stringify(payload),
  };
}

function createDefinition(overrides: Partial<WorkflowDefinition<TestTriage, TestResult>> = {}) {
  let finalizeCount = 0;

  const definition: WorkflowDefinition<TestTriage, TestResult> = {
    workflowName: "RuntimeTestWorkflow",
    triageAgentName: "IssueTriageAgent",
    finalAgentName: "IssueAgent",
    runPlanner: async () => ({
      summary: "default plan",
      actions: [{ type: "finalize", task: "finish", reason: "finish" }],
    }),
    runReplanner: async () => ({
      summary: "default replan",
      actions: [{ type: "finalize", task: "finish", reason: "finish" }],
    }),
    runCritic: async () =>
      ({
        approved: true,
        summary: "approved",
        missingEvidence: [],
        confidence: "high",
      }) satisfies WorkflowCritique,
    runTriage: async (task) => ({ summary: task }),
    runFinal: async (task) => {
      finalizeCount += 1;
      return {
        done: true,
        note: `${task}:${finalizeCount}`,
      };
    },
    buildFinalContext: (input) => `Final context for ${input}`,
    buildCritiqueContext: (_input, _runtime, _candidate, finalContext) => finalContext,
    buildReplanContext: (input, completedAction, _runtime, remainingActions) =>
      JSON.stringify({ input, completedAction, remainingActions }),
    summarizeTriage: (triage) => triage.summary,
    summarizeResult: (result) => result.note,
    ...overrides,
  };

  return definition;
}

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
    actions: [{ type: "finalize", task: "finish", reason: "finish" }],
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

test("WorkflowRuntime allows critique immediately after finalize at the maxSteps boundary", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "ReservedCritiqueWorkflow",
    input: "reserved critique input",
    policy: {
      maxSteps: 2,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  const definition = createDefinition({
    workflowName: "ReservedCritiqueWorkflow",
    runPlanner: async () => ({
      summary: "finalize directly",
      actions: [{ type: "finalize", task: "finish", reason: "finish at limit" }],
    }),
  });

  const result = await runtime.runActionQueue(definition, "reserved critique input");

  assert.equal(result.note, "finish:1");
  assert.equal(runtime.getMeta().critiqueCount, 1);
  assert.equal(runtime.getMeta().stepCount, 3);
  const steps = runtime.getRunRecord().steps;
  assert.equal(steps[0]?.actionType, "plan");
  assert.equal(steps[steps.length - 1]?.name, "critique");
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

test("WorkflowRuntime safely replans after an invalid tool request", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeInvalidToolWorkflow",
    input: "invalid tool input",
    policy: {
      maxSteps: 8,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  const definition = createDefinition({
    workflowName: "RuntimeInvalidToolWorkflow",
    runPlanner: async () => ({
      summary: "invalid tool plan",
      actions: [
        {
          type: "tool_call",
          toolName: "unknown_tool",
          input: {},
          reason: "invalid tool for test",
        },
        {
          type: "finalize",
          task: "finish after invalid tool",
          reason: "recover through replan",
        },
      ],
    }),
    runReplanner: async () => ({
      summary: "recover from invalid tool",
      actions: [
        {
          type: "finalize",
          task: "finish after invalid tool",
          reason: "recover through replan",
        },
      ],
    }),
  });

  const result = await runtime.runActionQueue(definition, "invalid tool input");

  assert.equal(result.note, "finish after invalid tool:1");
  assert.equal(
    Array.isArray(runtime.getRunRecord().artifacts.validationErrors),
    true,
  );
  assert.equal((runtime.getRunRecord().artifacts.validationErrors as unknown[]).length, 1);
});

test("WorkflowRuntime applies edit_patch and validates it with run_command", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeEditPatchWorkflow",
    input: "Fix the timeout cleanup bug",
    policy: {
      maxSteps: 8,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  const originalCallLlm = llmClient.callLLM;
  const responses = [
    buildLlmResponse({
      summary: "Apply the localized fix",
      edits: [
        {
          path: "src/core/workflowRuntime.ts",
          changeType: "update",
          content: "export const fixed = true;\n",
          reason: "Patch the timeout cleanup logic",
        },
      ],
      validationCommand: "test",
    }),
  ];

  setEditableFileContextLoaderForTesting(() => [
    {
      path: "/repo/src/core/workflowRuntime.ts",
      exists: true,
      content: "export const fixed = false;\n",
    },
  ]);
  setCodePatchApplierForTesting((plan) => ({
    summary: plan.summary,
    edits: [
      {
        path: "/repo/src/core/workflowRuntime.ts",
        changeType: "update",
        bytesWritten: 26,
      },
    ],
    validationCommand: plan.validationCommand,
  }));
  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 0,
    stdout: "tests passed",
    stderr: "",
    timedOut: false,
    durationMs: 14,
    signal: null,
  }));

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async () => {
    const next = responses.shift();
    if (!next) {
      throw new Error("No more mocked LLM responses");
    }

    return next;
  };

  try {
    const definition = createDefinition({
      workflowName: "RuntimeEditPatchWorkflow",
      runPlanner: async () => ({
        summary: "edit then finalize",
        actions: [
          {
            type: "edit_patch",
            task: "Fix the timeout cleanup bug",
            files: ["src/core/workflowRuntime.ts"],
            reason: "The evidence is already localized",
          },
          {
            type: "finalize",
            task: "finish after patch",
            reason: "Summarize the completed fix",
          },
        ],
      }),
      runReplanner: async () => ({
        summary: "finalize after patch",
        actions: [
          {
            type: "finalize",
            task: "finish after patch",
            reason: "Patch and validation are already complete",
          },
        ],
      }),
    });

    const result = await runtime.runActionQueue(definition, "Fix the timeout cleanup bug");

    assert.equal(result.note, "finish after patch:1");
    assert.equal(runtime.getMeta().editActionCount, 1);
    assert.equal(runtime.getMeta().toolCallCount, 1);

    const runRecord = runtime.getRunRecord();
    assert.equal(Array.isArray(runRecord.artifacts.patchResults), true);
    assert.equal((runRecord.artifacts.patchResults as unknown[]).length, 1);
    assert.equal(Array.isArray(runRecord.artifacts.commandResults), true);
    assert.equal((runRecord.artifacts.commandResults as unknown[]).length, 1);
    assert.ok(runRecord.steps.some((step) => step.actionType === "edit_patch"));
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setEditableFileContextLoaderForTesting();
    setCodePatchApplierForTesting();
    setRunCommandExecutorForTesting();
  }
});

test("WorkflowRuntime records a single planner validation error when invalid planner output is retried", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeInvalidPlannerWorkflow",
    input: "invalid planner output",
    policy: {
      maxSteps: 6,
      maxRetriesPerStep: 1,
      timeoutMs: 1000,
    },
  });

  const definition = createDefinition({
    workflowName: "RuntimeInvalidPlannerWorkflow",
    runPlanner: async () => {
      throw new Error("LLM response failed schema validation: invalid planner output");
    },
  });

  await assert.rejects(
    () => runtime.runActionQueue(definition, "invalid planner output"),
    /invalid planner output/,
  );

  const validationErrors = runtime.getRunRecord().artifacts.validationErrors as Array<{ kind: string }>;
  assert.equal(validationErrors.length, 1);
  assert.equal(validationErrors[0]?.kind, "planner");
});

test("WorkflowRuntime executes run_command and persists command results for later analysis", async () => {
  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 1,
    stdout: "",
    stderr: "failing build",
    timedOut: false,
    durationMs: 22,
    signal: null,
  }));

  try {
    const runtime = new WorkflowRuntime({
      workflowName: "RuntimeCommandWorkflow",
      input: "command execution input",
      policy: {
        maxSteps: 8,
        maxRetriesPerStep: 0,
        timeoutMs: 1000,
      },
    });

    const definition = createDefinition({
      workflowName: "RuntimeCommandWorkflow",
      runPlanner: async () => ({
        summary: "run build before finalizing",
        actions: [
          {
            type: "tool_call",
            toolName: "run_command",
            input: { command: "build" },
            reason: "Need build evidence",
          },
          {
            type: "finalize",
            task: "finish with build evidence",
            reason: "build result should influence the answer",
          },
        ],
      }),
      runReplanner: async () => ({
        summary: "finalize after command",
        actions: [
          {
            type: "finalize",
            task: "finish with build evidence",
            reason: "command result collected",
          },
        ],
      }),
    });

    const result = await runtime.runActionQueue(definition, "command execution input");
    const commandResults = runtime.getRunRecord().artifacts.commandResults as Array<{ exitCode: number | null }>;

    assert.equal(result.note, "finish with build evidence:1");
    assert.equal(runtime.getMeta().toolCallCount, 1);
    assert.equal(commandResults.length, 1);
    assert.equal(commandResults[0].exitCode, 1);
  } finally {
    setRunCommandExecutorForTesting();
  }
});

test("WorkflowRuntime safely replans after an invalid delegation target", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeInvalidDelegateWorkflow",
    input: "invalid delegate input",
    policy: {
      maxSteps: 8,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  const definition = createDefinition({
    workflowName: "RuntimeInvalidDelegateWorkflow",
    runPlanner: async () => ({
      summary: "invalid delegate plan",
      actions: [
        {
          type: "delegate",
          targetAgent: "UnknownAgent",
          task: "delegate to nowhere",
          reason: "invalid target for test",
        },
        {
          type: "finalize",
          task: "finish after invalid delegation",
          reason: "recover through replan",
        },
      ],
    }),
    runReplanner: async () => ({
      summary: "recover from invalid delegate",
      actions: [
        {
          type: "finalize",
          task: "finish after invalid delegation",
          reason: "recover through replan",
        },
      ],
    }),
  });

  const result = await runtime.runActionQueue(definition, "invalid delegate input");

  assert.equal(result.note, "finish after invalid delegation:1");
  assert.equal((runtime.getRunRecord().artifacts.validationErrors as unknown[]).length, 1);
});

test("WorkflowRuntime suppresses repeated identical tool calls and reuses cached result", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeToolLoopWorkflow",
    input: "repeated tool call input",
    policy: {
      maxSteps: 10,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
      maxConsecutiveNoProgress: 2,
    },
  });

  let replanCount = 0;
  const definition = createDefinition({
    workflowName: "RuntimeToolLoopWorkflow",
    runPlanner: async () => ({
      summary: "start with a tool",
      actions: [
        {
          type: "tool_call",
          toolName: "search_code",
          input: { terms: ["WorkflowRuntime"] },
          reason: "need code evidence",
        },
        {
          type: "finalize",
          task: "finish after tool calls",
          reason: "finish after gathering evidence",
        },
      ],
    }),
    runReplanner: async () => {
      replanCount += 1;
      if (replanCount === 1) {
        return {
          summary: "repeat the same tool",
          actions: [
            {
              type: "tool_call",
              toolName: "search_code",
              input: { terms: ["WorkflowRuntime"] },
              reason: "repeat intentionally",
            },
            {
              type: "finalize",
              task: "finish after repeated tool calls",
              reason: "finish after repetition",
            },
          ],
        } satisfies WorkflowReplan;
      }

      if (replanCount === 2) {
        return {
          summary: "repeat the same tool again without new evidence",
          actions: [
            {
              type: "tool_call",
              toolName: "search_code",
              input: { terms: ["WorkflowRuntime"] },
              reason: "repeat intentionally again",
            },
            {
              type: "finalize",
              task: "finish after repeated tool calls",
              reason: "finish after repetition",
            },
          ],
        } satisfies WorkflowReplan;
      }

      return {
        summary: "finalize now",
        actions: [
          {
            type: "finalize",
            task: "finish after repeated tool calls",
            reason: "enough evidence",
          },
        ],
      } satisfies WorkflowReplan;
    },
  });

  const result = await runtime.runActionQueue(definition, "repeated tool call input");
  const toolCalls = runtime.getRunRecord().artifacts.toolCalls as Array<{ suppressed: boolean }>;

  assert.equal(result.note, 'Forced final analysis after tool_call "search_code":1');
  assert.equal(runtime.getMeta().toolCallCount, 2);
  assert.equal(toolCalls.length, 3);
  assert.equal(toolCalls[2].suppressed, true);
});

test("WorkflowRuntime suppresses repeated identical run_command calls when non-command state did not change", async () => {
  setRunCommandExecutorForTesting(async (command) => ({
    command,
    exitCode: 1,
    stdout: "",
    stderr: "build failed",
    timedOut: false,
    durationMs: 15,
    signal: null,
  }));

  try {
    const runtime = new WorkflowRuntime({
      workflowName: "RuntimeCommandLoopWorkflow",
      input: "repeat build command",
      policy: {
        maxSteps: 10,
        maxRetriesPerStep: 0,
        timeoutMs: 1000,
        maxConsecutiveNoProgress: 1,
      },
    });

    let replanCount = 0;
    const definition = createDefinition({
      workflowName: "RuntimeCommandLoopWorkflow",
      runPlanner: async () => ({
        summary: "start with build",
        actions: [
          {
            type: "tool_call",
            toolName: "run_command",
            input: { command: "build" },
            reason: "need build evidence",
          },
          {
            type: "finalize",
            task: "finish after build evidence",
            reason: "finish after verification",
          },
        ],
      }),
      runReplanner: async () => {
        replanCount += 1;
        if (replanCount === 1) {
          return {
            summary: "repeat build without new evidence",
            actions: [
              {
                type: "tool_call",
                toolName: "run_command",
                input: { command: "build" },
                reason: "repeat build intentionally",
              },
              {
                type: "finalize",
                task: "finish after repeated build",
                reason: "finish after repetition",
              },
            ],
          } satisfies WorkflowReplan;
        }

        return {
          summary: "finalize after cached build",
          actions: [
            {
              type: "finalize",
              task: "finish after repeated build",
              reason: "enough build evidence",
            },
          ],
        } satisfies WorkflowReplan;
      },
    });

    const result = await runtime.runActionQueue(definition, "repeat build command");
    const toolCalls = runtime.getRunRecord().artifacts.toolCalls as Array<{
      suppressed: boolean;
      toolName: string;
      decisionSignature?: string;
    }>;

    assert.equal(result.note, 'Forced final analysis after tool_call "run_command":1');
    assert.equal(runtime.getMeta().toolCallCount, 1);
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[1].toolName, "run_command");
    assert.equal(toolCalls[1].suppressed, true);
    assert.equal(typeof toolCalls[1].decisionSignature, "string");
  } finally {
    setRunCommandExecutorForTesting();
  }
});

test("WorkflowRuntime follows critic nextAction and records critic redirects", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "RuntimeCriticRedirectWorkflow",
    input: "critic redirect input",
    policy: {
      maxSteps: 12,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  let critiqueCount = 0;
  let finalizeCount = 0;

  const definition = createDefinition({
    workflowName: "RuntimeCriticRedirectWorkflow",
    runPlanner: async () => ({
      summary: "go straight to finalize",
      actions: [
        {
          type: "finalize",
          task: "draft answer",
          reason: "start with a candidate",
        },
      ],
    }),
    runReplanner: async () => ({
      summary: "finalize after collecting evidence",
      actions: [
        {
          type: "finalize",
          task: "final answer after redirect",
          reason: "evidence has been collected",
        },
      ],
    }),
    runFinal: async (task) => {
      finalizeCount += 1;
      return {
        done: true,
        note: `${task}:${finalizeCount}`,
      };
    },
    runCritic: async () => {
      critiqueCount += 1;
      if (critiqueCount === 1) {
        return {
          approved: false,
          summary: "Need one tool call before finalizing",
          missingEvidence: ["repository evidence"],
          confidence: "medium",
          nextAction: {
            type: "tool_call",
            toolName: "search_code",
            input: { terms: ["WorkflowRuntime"] },
            reason: "Need repository evidence",
          },
        };
      }

      return {
        approved: true,
        summary: "Approved",
        missingEvidence: [],
        confidence: "high",
      };
    },
  });

  const result = await runtime.runActionQueue(definition, "critic redirect input");

  assert.equal(result.note, "final answer after redirect:2");
  assert.equal(runtime.getMeta().criticRedirectCount, 1);
  assert.equal(runtime.getMeta().toolCallCount, 1);
});

test("WorkflowRuntime uses relevant memory when planning and changes outcome", async () => {
  const priorRuntime = new WorkflowRuntime({
    workflowName: "MemoryAwareWorkflow",
    input: "timeout cleanup bug",
  });
  priorRuntime.forceFinalAnalysis("Repeated search_code steps produced no new matches");
  priorRuntime.complete();

  let sawRelevantMemory = false;
  const runtime = new WorkflowRuntime({
    workflowName: "MemoryAwareWorkflow",
    input: "timeout cleanup bug",
    policy: {
      maxSteps: 8,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  const definition = createDefinition({
    workflowName: "MemoryAwareWorkflow",
    runPlanner: async (_input, memoryContext) => {
      sawRelevantMemory =
        memoryContext.memoryHits > 0 &&
        memoryContext.summary.includes("Repeated search_code steps produced no new matches");

      return {
        summary: "memory aware plan",
        actions: [
          {
            type: "finalize",
            task: sawRelevantMemory ? "memory-aware finalize" : "default finalize",
            reason: "use memory if available",
          },
        ],
      } satisfies WorkflowPlan;
    },
  });

  const result = await runtime.runActionQueue(definition, "timeout cleanup bug");

  assert.equal(result.note, "memory-aware finalize:1");
  assert.ok(sawRelevantMemory);
  assert.ok(runtime.getMeta().memoryHits > 0);
});

test("WorkflowRuntime exposes prior command outcomes in relevant memory for planning", async () => {
  const priorRuntime = new WorkflowRuntime({
    workflowName: "CommandMemoryWorkflow",
    input: "runtime build regression",
  });
  priorRuntime.saveArtifact("commandResults", [
    {
      command: "build",
      exitCode: 1,
      stdout: "",
      stderr: "Type error in workflowRuntime.ts",
      timedOut: false,
      durationMs: 12,
      signal: null,
    },
  ]);
  priorRuntime.complete();

  let sawCommandPattern = false;
  const runtime = new WorkflowRuntime({
    workflowName: "CommandMemoryWorkflow",
    input: "runtime build regression",
    policy: {
      maxSteps: 8,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
    },
  });

  const definition = createDefinition({
    workflowName: "CommandMemoryWorkflow",
    runPlanner: async (_input, memoryContext) => {
      sawCommandPattern =
        memoryContext.commandPatterns.includes("build_failed") &&
        memoryContext.summary.includes("commands=build:failed:1");

      return {
        summary: "command-memory plan",
        actions: [
          {
            type: "finalize",
            task: sawCommandPattern ? "command-memory finalize" : "default finalize",
            reason: "use command memory if available",
          },
        ],
      } satisfies WorkflowPlan;
    },
  });

  const result = await runtime.runActionQueue(definition, "runtime build regression");

  assert.equal(result.note, "command-memory finalize:1");
  assert.ok(sawCommandPattern);
  assert.ok(runtime.getMeta().memoryHits > 0);
});

test("WorkflowRuntime blocks delegation beyond max depth", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "DepthGuardWorkflow",
    input: "depth guard input",
    policy: {
      maxSteps: 6,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
      maxDelegationDepth: 1,
    },
  });

  const definition = createDefinition({
    workflowName: "DepthGuardWorkflow",
  });
  const state: WorkflowExecutionState<TestTriage, TestResult> = {
    actionQueue: [],
  };

  await runtime.executeAction(
    {
      type: "delegate",
      targetAgent: "ReviewerAgent",
      task: "attempt nested delegation",
      reason: "test depth guard",
    } satisfies RuntimeAction,
    definition,
    state,
    "depth guard input",
    1,
  );

  assert.equal((runtime.getRunRecord().artifacts.validationErrors as unknown[]).length, 1);
  assert.equal(state.actionQueue.length, 1);
  assert.equal(state.actionQueue[0].type, "replan");
});

test("WorkflowRuntime stops new delegations when the delegation budget is exhausted", async () => {
  const runtime = new WorkflowRuntime({
    workflowName: "DelegationBudgetWorkflow",
    input: "delegation budget input",
    policy: {
      maxSteps: 6,
      maxRetriesPerStep: 0,
      timeoutMs: 1000,
      maxDelegationsPerRun: 1,
    },
  });

  runtime.saveArtifact("runtimeStats", {
    toolCallCount: 0,
    delegationCount: 1,
    maxDelegationDepthReached: 0,
    memoryHits: 0,
    criticRedirectCount: 0,
  });

  const definition = createDefinition({
    workflowName: "DelegationBudgetWorkflow",
  });
  const state: WorkflowExecutionState<TestTriage, TestResult> = {
    actionQueue: [],
  };

  await runtime.executeAction(
    {
      type: "delegate",
      targetAgent: "ReviewerAgent",
      task: "attempt delegation with exhausted budget",
      reason: "test delegation budget",
    } satisfies RuntimeAction,
    definition,
    state,
    "delegation budget input",
  );

  assert.match(
    runtime.getRunRecord().artifacts.forcedFinalAnalysisReason as string,
    /Delegation budget exceeded/,
  );
  assert.equal(state.actionQueue[0].type, "finalize");
});
