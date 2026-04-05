import { env } from "../config/env";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import * as llmClient from "../core/llmClient";
import { WorkflowRunRecord, WorkflowResult } from "../core/types";
import { getRunMemory, resetRunMemories } from "../memory/simpleMemory";
import { setGitToolExecutorForTesting } from "../tools/gitTool";
import { setRunCommandExecutorForTesting } from "../tools/runCommandTool";
import { runBugWorkflow } from "../workflows/bugWorkflow";
import { runIssueWorkflow } from "../workflows/issueWorkflow";
import { runPRReviewWorkflow } from "../workflows/prReviewWorkflow";
import { EvalReport } from "./reportTypes";
import { EvalCheck, EvalExecutionContext, EvalScenario, getEvalScenarios } from "./scenarios";

interface ScenarioExecutionResult {
  scenario: EvalScenario;
  checks: EvalCheck[];
  passed: boolean;
  runId?: string;
  notes: string[];
  error?: string;
}

function isIsolatedEvalStorage(): boolean {
  return env.RUN_STORAGE_DIR.includes(".eval-runs");
}

function parseArgs(): { scenarioId?: string; listOnly: boolean; outputPath?: string } {
  const args = process.argv.slice(2);
  const scenarioFlagIndex = args.findIndex((value) => value === "--scenario");
  const outputFlagIndex = args.findIndex((value) => value === "--output");

  return {
    scenarioId: scenarioFlagIndex >= 0 ? args[scenarioFlagIndex + 1] : undefined,
    listOnly: args.includes("--list"),
    outputPath: outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined,
  };
}

async function runWorkflow(
  workflow: EvalScenario["workflow"],
  input: string,
): Promise<WorkflowResult<unknown>> {
  if (workflow === "issue") {
    return runIssueWorkflow(input);
  }

  if (workflow === "bug") {
    return runBugWorkflow(input);
  }

  return runPRReviewWorkflow(input);
}

function printScenarioResult(result: ScenarioExecutionResult): void {
  const status = result.passed ? "PASS" : "FAIL";
  console.log(`${status} ${result.scenario.id}`);
  console.log(`  ${result.scenario.description}`);

  if (result.runId) {
    console.log(`  runId: ${result.runId}`);
  }

  for (const check of result.checks) {
    const marker = check.passed ? "[ok]" : "[x]";
    console.log(`  ${marker} ${check.label}${check.details ? ` — ${check.details}` : ""}`);
  }

  for (const note of result.notes) {
    console.log(`  note: ${note}`);
  }

  if (result.error) {
    console.log(`  error: ${result.error}`);
  }

  console.log("");
}

function buildEvalReport(results: ScenarioExecutionResult[]): EvalReport {
  const scenarioCount = results.length;
  const passedScenarioCount = results.filter((result) => result.passed).length;
  const totalChecks = results.reduce((count, result) => count + result.checks.length, 0);
  const passedChecks = results.reduce(
    (count, result) => count + result.checks.filter((check) => check.passed).length,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    runStorageDir: env.RUN_STORAGE_DIR,
    scenarioCount,
    passedScenarioCount,
    totalChecks,
    passedChecks,
    failedScenarioIds: results.filter((result) => !result.passed).map((result) => result.scenario.id),
    scenarios: results.map((result) => ({
      id: result.scenario.id,
      workflow: result.scenario.workflow,
      description: result.scenario.description,
      passed: result.passed,
      runId: result.runId,
      error: result.error,
      notes: result.notes,
      checks: result.checks.map((check) => ({
        label: check.label,
        passed: check.passed,
        details: check.details,
      })),
    })),
  };
}

function writeEvalReport(outputPath: string, report: EvalReport): string {
  const resolvedPath = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(report, null, 2), "utf-8");
  return resolvedPath;
}

async function executeScenario(scenario: EvalScenario): Promise<ScenarioExecutionResult> {
  if (isIsolatedEvalStorage()) {
    resetRunMemories({ clearPersistedRuns: true });
  } else {
    resetRunMemories();
  }

  const context: EvalExecutionContext = {
    prompts: [],
    notes: [],
  };
  const responses = [...scenario.mockResponses];
  const originalCallLlm = llmClient.callLLM;

  (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = async (prompt: string) => {
    context.prompts.push(prompt);
    const next = responses.shift();

    if (!next) {
      throw new Error(`No mocked LLM response left for scenario "${scenario.id}"`);
    }

    return next;
  };

  try {
    await scenario.seed?.(context);
    await scenario.setup?.(context);

    const result = await runWorkflow(scenario.workflow, scenario.input);
    const run = getRunMemory(result.meta.runId);
    const checks = scenario.evaluate(result, run as WorkflowRunRecord, context);

    checks.push({
      label: "all mocked LLM responses were consumed",
      passed: responses.length === 0,
      details: responses.length === 0 ? undefined : `${responses.length} response(s) unused`,
    });

    return {
      scenario,
      checks,
      passed: checks.every((check) => check.passed),
      runId: result.meta.runId,
      notes: context.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scenario,
      checks: [
        {
          label: "scenario executed without unexpected runtime errors",
          passed: false,
          details: message,
        },
      ],
      passed: false,
      notes: context.notes,
      error: message,
    };
  } finally {
    (llmClient as { callLLM: typeof llmClient.callLLM }).callLLM = originalCallLlm;
    setRunCommandExecutorForTesting();
    setGitToolExecutorForTesting();
  }
}

async function main(): Promise<void> {
  const { scenarioId, listOnly, outputPath } = parseArgs();
  const scenarios = getEvalScenarios();

  if (listOnly) {
    for (const scenario of scenarios) {
      console.log(`${scenario.id} - ${scenario.description}`);
    }
    return;
  }

  const selectedScenarios = scenarioId
    ? scenarios.filter((scenario) => scenario.id === scenarioId)
    : scenarios;

  if (selectedScenarios.length === 0) {
    console.error(`Unknown eval scenario "${scenarioId ?? ""}"`);
    process.exitCode = 1;
    return;
  }

  console.log(`Running ${selectedScenarios.length} eval scenario(s) using RUN_STORAGE_DIR=${env.RUN_STORAGE_DIR}`);
  if (!isIsolatedEvalStorage()) {
    console.log("Warning: evals are not using isolated storage; persisted run memory may affect results.");
  }
  console.log("");

  const results: ScenarioExecutionResult[] = [];
  for (const scenario of selectedScenarios) {
    results.push(await executeScenario(scenario));
  }

  for (const result of results) {
    printScenarioResult(result);
  }

  const report = buildEvalReport(results);

  console.log(
    `Summary: ${report.passedScenarioCount}/${report.scenarioCount} scenarios passed, ${report.passedChecks}/${report.totalChecks} checks passed.`,
  );

  if (outputPath) {
    const resolvedPath = writeEvalReport(outputPath, report);
    console.log(`Report written to ${resolvedPath}`);
  }

  if (report.passedScenarioCount !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Eval runner failed: ${message}`);
  process.exitCode = 1;
});
