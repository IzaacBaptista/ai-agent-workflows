import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkflowExecutionMeta,
  WorkflowExecutionPolicy,
  WorkflowResult,
  WorkflowRunRecord,
} from "../core/types";
import { ExecutionReporter } from "../reporting/ExecutionReporter";
import { RunSummaryFormatter } from "../reporting/RunSummaryFormatter";
import { RunTimelineFormatter } from "../reporting/RunTimelineFormatter";
import { buildHighLevelFlow } from "../reporting/reportingUtils";
import { parseCliArgs } from "../cli/parseCliArgs";

const defaultPolicy: WorkflowExecutionPolicy = {
  maxSteps: 10,
  maxRetriesPerStep: 1,
  timeoutMs: 60_000,
  maxConsecutiveNoProgress: 1,
  maxToolCalls: 4,
  maxRepeatedIdenticalToolCalls: 1,
  maxEditActionsPerRun: 2,
  maxFilesPerEditAction: 3,
  maxDelegationsPerRun: 2,
  maxDelegationDepth: 1,
  maxCriticRedirects: 2,
};

function createMeta(overrides: Partial<WorkflowExecutionMeta> = {}): WorkflowExecutionMeta {
  return {
    runId: "run-123",
    workflowName: "PRReviewWorkflow",
    status: "completed",
    stepCount: 5,
    critiqueCount: 1,
    replanCount: 1,
    toolCallCount: 1,
    editActionCount: 0,
    delegationCount: 0,
    maxDelegationDepthReached: 0,
    memoryHits: 3,
    criticRedirectCount: 0,
    ...overrides,
  };
}

function createRunRecord(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    runId: "run-123",
    workflowName: "PRReviewWorkflow",
    status: "completed",
    input: "Review a PR that touched critic, runtime, and persistence code",
    startedAt: "2026-04-05T13:00:00.000Z",
    completedAt: "2026-04-05T13:02:00.000Z",
    policy: defaultPolicy,
    steps: [
      {
        stepId: "plan:1:1",
        name: "plan",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:01.000Z",
        agentName: "PlannerAgent",
        inputSummary: "Review a PR that touched critic, runtime, and persistence code",
        outputSummary: "actions=analyze,tool_call,delegate,finalize",
        actionType: "plan",
      },
      {
        stepId: "tool_call:2:1",
        name: "tool_call",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:01.000Z",
        completedAt: "2026-04-05T13:00:02.000Z",
        inputSummary: "Compile the repository before concluding",
        outputSummary: "command=build,exitCode=0,timedOut=false",
        actionType: "tool_call",
        toolName: "run_command",
        signature: "tool:run_command:build",
      },
      {
        stepId: "delegate:3:1",
        name: "delegate",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:02.000Z",
        completedAt: "2026-04-05T13:00:03.000Z",
        agentName: "ReviewerAgent",
        inputSummary: "Check whether the evidence is strong enough",
        outputSummary: "{\"supported\":true}",
        actionType: "delegate",
        targetAgent: "ReviewerAgent",
      },
      {
        stepId: "finalize:4:1",
        name: "finalize",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:03.000Z",
        completedAt: "2026-04-05T13:00:04.000Z",
        agentName: "PRAgent",
        inputSummary: "produce the final structured review outcome",
        outputSummary: "impacts=5",
        actionType: "finalize",
      },
      {
        stepId: "critique:5:1",
        name: "critique",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:04.000Z",
        completedAt: "2026-04-05T13:00:05.000Z",
        agentName: "CriticAgent",
        inputSummary: "produce the final structured review outcome",
        outputSummary: "approved=true",
        actionType: "critique",
      },
    ],
    artifacts: {
      toolCalls: [
        {
          toolName: "run_command",
          signature: "tool:run_command:build",
          request: { command: "build" },
          suppressed: false,
          cached: false,
          workingMemorySignature: "wm-1",
          decisionSignature: "cmd-1",
          createdAt: "2026-04-05T13:00:02.000Z",
        },
      ],
      result: {
        summary: "The PR compiles, the critic path is wired, and persistence changes look coherent.",
      },
    },
    ...overrides,
  };
}

test("RunSummaryFormatter renders a success case", () => {
  const runRecord = createRunRecord();
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: {
      summary: "The PR compiles, the critic path is wired, and persistence changes look coherent.",
    },
    meta: createMeta(),
  };

  const output = RunSummaryFormatter.format({ result, runRecord });

  assert.match(output, /PRReviewWorkflow — succeeded/);
  assert.match(output, /What happened:/);
  assert.match(output, /The system gathered executable evidence with local command runs\./);
  assert.match(output, /It delegated part of the verification to another agent\./);
  assert.match(output, /Flow:\nplan → tool_call\(run_command:build\) → delegate\(ReviewerAgent\) → finalize → critique/);
  assert.match(output, /Behavior:\ndelegated verification/);
  assert.match(output, /Result:\nThe PR compiles, the critic path is wired, and persistence changes look coherent\./);
});

test("RunSummaryFormatter renders an issue-like pure reasoning failure", () => {
  const runRecord = createRunRecord({
    workflowName: "IssueWorkflow",
    status: "failed",
    input: "The planner keeps generating redundant search_code steps",
    error: "Step \"finalize\" timed out",
    steps: [
      {
        stepId: "plan:1:1",
        name: "plan",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:01.000Z",
        agentName: "PlannerAgent",
        inputSummary: "The planner keeps generating redundant search_code steps",
        outputSummary: "actions=analyze,finalize",
        actionType: "plan",
      },
      {
        stepId: "analyze:2:1",
        name: "analyze",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:01.000Z",
        completedAt: "2026-04-05T13:00:02.000Z",
        agentName: "IssueTriageAgent",
        inputSummary: "Clarify the failure pattern",
        outputSummary: "investigationAreas=12",
        actionType: "analyze",
      },
      {
        stepId: "finalize:3:1",
        name: "finalize",
        status: "failed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:02.000Z",
        completedAt: "2026-04-05T13:01:02.000Z",
        agentName: "IssueAgent",
        inputSummary: "Deliver a concise proposal",
        error: "Step \"finalize\" timed out",
        actionType: "finalize",
      },
      {
        stepId: "finalize:3:2",
        name: "finalize",
        status: "failed",
        attempt: 2,
        startedAt: "2026-04-05T13:01:02.000Z",
        completedAt: "2026-04-05T13:02:02.000Z",
        agentName: "IssueAgent",
        inputSummary: "Deliver a concise proposal",
        error: "Step \"finalize\" timed out",
        actionType: "finalize",
      },
    ],
  });
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Step \"finalize\" timed out",
    meta: createMeta({
      workflowName: "IssueWorkflow",
      status: "failed",
      stepCount: 4,
      critiqueCount: 0,
      replanCount: 0,
      toolCallCount: 0,
    }),
  };

  const output = RunSummaryFormatter.format({ result, runRecord });

  assert.match(output, /IssueWorkflow — failed/);
  assert.match(output, /What happened:/);
  assert.match(output, /The system analyzed the issue without using tools\./);
  assert.match(output, /It attempted to generate a final proposal\./);
  assert.match(output, /The finalize step timed out twice\./);
  assert.match(output, /Why it failed:\n- The finalize step exceeded the allowed execution time\./);
  assert.match(output, /Behavior:\npure reasoning \(no tool usage\)/);
});

test("RunSummaryFormatter explains planner rate-limit failure before investigation begins", () => {
  const runRecord = createRunRecord({
    workflowName: "IssueWorkflow",
    status: "failed",
    input: "The planner keeps generating redundant search_code steps",
    error: "Request failed with status code 429",
    steps: [
      {
        stepId: "plan:1:1",
        name: "plan",
        status: "failed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:01.000Z",
        agentName: "PlannerAgent",
        inputSummary: "The planner keeps generating redundant search_code steps",
        error: "Request failed with status code 429",
        actionType: "plan",
      },
      {
        stepId: "plan:1:2",
        name: "plan",
        status: "failed",
        attempt: 2,
        startedAt: "2026-04-05T13:00:01.000Z",
        completedAt: "2026-04-05T13:00:02.000Z",
        agentName: "PlannerAgent",
        inputSummary: "The planner keeps generating redundant search_code steps",
        error: "Request failed with status code 429",
        actionType: "plan",
      },
    ],
  });
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Request failed with status code 429",
    meta: createMeta({
      workflowName: "IssueWorkflow",
      status: "failed",
      stepCount: 2,
      critiqueCount: 0,
      replanCount: 0,
      toolCallCount: 0,
    }),
  };

  const output = RunSummaryFormatter.format({ result, runRecord });

  assert.match(output, /The system failed during planning before investigation began\./);
  assert.match(output, /Why it failed:\n- The LLM provider rate-limited the request before the workflow could continue\./);
  assert.match(output, /Behavior:\nplanning interrupted by external dependency/);
});

test("RunSummaryFormatter treats failed tool attempts as tool-driven investigation", () => {
  const runRecord = createRunRecord({
    workflowName: "IssueWorkflow",
    status: "failed",
    input: "WorkflowRuntime in this repo still retries read_file after blocked input",
    error: "File \"core/workflowRuntime.ts\" is outside the allowed read scope",
    steps: [
      {
        stepId: "plan:1:1",
        name: "plan",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:01.000Z",
        agentName: "PlannerAgent",
        inputSummary: "WorkflowRuntime in this repo still retries read_file after blocked input",
        outputSummary: "actions=analyze,tool_call,finalize",
        actionType: "plan",
      },
      {
        stepId: "tool_call:2:1",
        name: "tool_call",
        status: "failed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:01.000Z",
        completedAt: "2026-04-05T13:00:02.000Z",
        inputSummary: "Inspect WorkflowRuntime directly",
        error: "File \"core/workflowRuntime.ts\" is outside the allowed read scope",
        actionType: "tool_call",
        toolName: "read_file",
      },
    ],
  });
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "File \"core/workflowRuntime.ts\" is outside the allowed read scope",
    meta: createMeta({
      workflowName: "IssueWorkflow",
      status: "failed",
      stepCount: 2,
      critiqueCount: 0,
      replanCount: 0,
      toolCallCount: 0,
    }),
  };

  const output = RunSummaryFormatter.format({ result, runRecord });

  assert.match(output, /The system attempted to inspect repository files directly\./);
  assert.doesNotMatch(output, /without using tools/);
  assert.match(output, /Behavior:\ntool-driven investigation/);
});

test("RunTimelineFormatter groups attempts and includes failure reasons", () => {
  const runRecord = createRunRecord({
    steps: [
      {
        stepId: "plan:1:1",
        name: "plan",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:01.000Z",
        agentName: "PlannerAgent",
        inputSummary: "Review the PR",
        outputSummary: "actions=finalize",
        actionType: "plan",
      },
      {
        stepId: "finalize:2:1",
        name: "finalize",
        status: "failed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:01.000Z",
        completedAt: "2026-04-05T13:01:01.000Z",
        agentName: "PRAgent",
        inputSummary: "produce the final structured review outcome",
        error: "Step \"finalize\" timed out",
        actionType: "finalize",
      },
      {
        stepId: "finalize:2:2",
        name: "finalize",
        status: "completed",
        attempt: 2,
        startedAt: "2026-04-05T13:01:01.000Z",
        completedAt: "2026-04-05T13:01:20.000Z",
        agentName: "PRAgent",
        inputSummary: "produce the final structured review outcome",
        outputSummary: "impacts=5",
        actionType: "finalize",
      },
    ],
  });
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "PR review completed" },
    meta: createMeta({ stepCount: 3, critiqueCount: 0 }),
  };

  const output = RunTimelineFormatter.format({ result, runRecord });

  assert.match(output, /2\. finalize/);
  assert.match(output, /Attempt 1: failed - Step "finalize" timed out/);
  assert.match(output, /Attempt 2: completed - impacts=5/);
});

test("RunTimelineFormatter renders blocked synthetic actions", () => {
  const runRecord = createRunRecord({
    steps: [
      {
        stepId: "tool_call:1:1",
        name: "tool_call",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:00.000Z",
        inputSummary: "Read a file outside src",
        outputSummary: "blocked: Invalid input for tool \"read_file\"",
        actionType: "tool_call",
        toolName: "read_file",
        blocked: true,
      },
    ],
  });
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Invalid input for tool \"read_file\"",
    meta: createMeta({ status: "failed", stepCount: 1, critiqueCount: 0, toolCallCount: 0 }),
  };

  const output = RunTimelineFormatter.format({ result, runRecord });

  assert.match(output, /1\. tool_call\(read_file\)/);
  assert.match(output, /Blocked: Invalid input for tool "read_file"/);
});

test("RunSummaryFormatter reports iterative investigation loop behavior", () => {
  const runRecord = createRunRecord({
    workflowName: "BugWorkflow",
    status: "failed",
    error: "Execution policy exceeded maxSteps=10 for workflow \"BugWorkflow\"",
    steps: [
      {
        stepId: "plan:1:1",
        name: "plan",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:00.000Z",
        completedAt: "2026-04-05T13:00:01.000Z",
        outputSummary: "actions=analyze,tool_call,tool_call,finalize",
      },
      {
        stepId: "tool_call:2:1",
        name: "tool_call",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:01.000Z",
        completedAt: "2026-04-05T13:00:02.000Z",
        inputSummary: "Locate WorkflowRuntime",
        outputSummary: "terms=8,matches=12",
        actionType: "tool_call",
        toolName: "search_code",
      },
      {
        stepId: "tool_call:3:1",
        name: "tool_call",
        status: "completed",
        attempt: 1,
        startedAt: "2026-04-05T13:00:02.000Z",
        completedAt: "2026-04-05T13:00:03.000Z",
        inputSummary: "Read exact timer handling logic",
        outputSummary: "files=2",
        actionType: "tool_call",
        toolName: "read_file",
      },
    ],
  });
  const result: WorkflowResult<{ summary: string }> = {
    success: false,
    error: "Execution policy exceeded maxSteps=10 for workflow \"BugWorkflow\"",
    meta: createMeta({
      workflowName: "BugWorkflow",
      status: "failed",
      stepCount: 10,
      replanCount: 5,
      toolCallCount: 3,
    }),
  };

  const output = RunSummaryFormatter.format({ result, runRecord });

  assert.match(output, /The system performed iterative investigation using code search and file reads\./);
  assert.match(output, /It repeatedly refined its plan based on new findings\./);
  assert.match(output, /It did not converge before hitting the execution limit\./);
  assert.match(output, /Behavior:\niterative investigation with replanning loop/);
});

test("buildHighLevelFlow includes tool and delegate labels", () => {
  const flow = buildHighLevelFlow(createRunRecord());

  assert.equal(
    flow,
    "plan → tool_call(run_command:build) → delegate(ReviewerAgent) → finalize → critique",
  );
});

test("ExecutionReporter renders timeline mode and raw mode stays empty", () => {
  const runRecord = createRunRecord();
  const result: WorkflowResult<{ summary: string }> = {
    success: true,
    data: { summary: "PR review completed" },
    meta: createMeta(),
  };

  assert.equal(ExecutionReporter.render({ result, runRecord }, "raw"), "");
  assert.match(ExecutionReporter.render({ result, runRecord }, "timeline"), /1\. plan/);
});

test("parseCliArgs reads output mode and falls back to raw when invalid", () => {
  const summaryArgs = parseCliArgs([
    "node",
    "src/index.ts",
    "bug",
    "WorkflowRuntime timeouts are not cleared",
    "--output",
    "timeline",
  ]);
  const invalidArgs = parseCliArgs([
    "node",
    "src/index.ts",
    "issue",
    "The planner keeps generating redundant search_code steps",
    "--output=invalid",
  ]);

  assert.ok(summaryArgs.kind === "bug");
  assert.equal(summaryArgs.outputMode, "timeline");
  assert.equal(summaryArgs.input, "WorkflowRuntime timeouts are not cleared");
  assert.ok(invalidArgs.kind === "issue");
  assert.equal(invalidArgs.outputMode, "raw");
});
