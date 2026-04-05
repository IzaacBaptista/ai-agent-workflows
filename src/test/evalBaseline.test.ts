import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReportIsBaselineReady,
  buildEvalBaseline,
  compareEvalReportToBaseline,
} from "../evals/baseline";
import { EvalReport } from "../evals/reportTypes";

function createPassingReport(): EvalReport {
  return {
    generatedAt: "2026-04-05T00:00:00.000Z",
    runStorageDir: ".eval-runs",
    scenarioCount: 2,
    passedScenarioCount: 2,
    totalChecks: 3,
    passedChecks: 3,
    failedScenarioIds: [],
    scenarios: [
      {
        id: "scenario-a",
        workflow: "bug",
        description: "Scenario A",
        passed: true,
        notes: [],
        checks: [
          { label: "workflow completes successfully", passed: true },
          { label: "command evidence persisted", passed: true },
        ],
      },
      {
        id: "scenario-b",
        workflow: "pr",
        description: "Scenario B",
        passed: true,
        notes: [],
        checks: [{ label: "git evidence persisted", passed: true }],
      },
    ],
  };
}

test("buildEvalBaseline captures passing scenario and check expectations", () => {
  const baseline = buildEvalBaseline(createPassingReport());

  assert.equal(baseline.scenarioCount, 2);
  assert.deepEqual(baseline.scenarios[0], {
    id: "scenario-a",
    mustPass: true,
    requiredChecks: ["workflow completes successfully", "command evidence persisted"],
  });
});

test("assertReportIsBaselineReady rejects reports with failed scenarios or checks", () => {
  const report = createPassingReport();
  report.passedChecks = 2;
  report.scenarios[1].checks[0].passed = false;

  assert.throws(
    () => assertReportIsBaselineReady(report),
    /Cannot create a baseline from a failing eval report/,
  );
});

test("compareEvalReportToBaseline detects scenario and check regressions", () => {
  const baseline = buildEvalBaseline(createPassingReport());
  const candidate = createPassingReport();

  candidate.passedScenarioCount = 1;
  candidate.passedChecks = 2;
  candidate.failedScenarioIds = ["scenario-a"];
  candidate.scenarios[0].passed = false;
  candidate.scenarios[0].checks[1] = {
    label: "command evidence persisted",
    passed: false,
    details: "commandResults=0",
  };

  const comparison = compareEvalReportToBaseline(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.deepEqual(comparison.regressions, [
    {
      scenarioId: "scenario-a",
      reason: "scenario no longer passes",
    },
    {
      scenarioId: "scenario-a",
      checkLabel: "command evidence persisted",
      reason: "required check no longer passes (commandResults=0)",
    },
  ]);
});

test("compareEvalReportToBaseline ignores extra candidate scenarios while enforcing baseline checks", () => {
  const baseline = buildEvalBaseline(createPassingReport());
  const candidate = createPassingReport();

  candidate.scenarioCount = 3;
  candidate.passedScenarioCount = 3;
  candidate.totalChecks = 4;
  candidate.passedChecks = 4;
  candidate.scenarios.push({
    id: "scenario-c",
    workflow: "issue",
    description: "Extra candidate scenario",
    passed: true,
    notes: [],
    checks: [{ label: "extra check", passed: true }],
  });

  const comparison = compareEvalReportToBaseline(baseline, candidate);

  assert.equal(comparison.passed, true);
  assert.equal(comparison.regressions.length, 0);
  assert.equal(comparison.checkedScenarioCount, 2);
  assert.equal(comparison.checkedCheckCount, 3);
});
