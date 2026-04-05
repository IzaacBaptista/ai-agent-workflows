import { readFileSync } from "fs";
import { resolve } from "path";
import {
  EvalBaseline,
  EvalReport,
  evalBaselineSchema,
  evalReportSchema,
} from "./reportTypes";

export interface EvalBaselineRegression {
  scenarioId: string;
  checkLabel?: string;
  reason: string;
}

export interface EvalBaselineComparison {
  passed: boolean;
  checkedScenarioCount: number;
  checkedCheckCount: number;
  regressions: EvalBaselineRegression[];
}

function readJsonFile(filePath: string): unknown {
  const resolvedPath = resolve(process.cwd(), filePath);
  return JSON.parse(readFileSync(resolvedPath, "utf-8")) as unknown;
}

export function loadEvalReport(filePath: string): EvalReport {
  return evalReportSchema.parse(readJsonFile(filePath));
}

export function loadEvalBaseline(filePath: string): EvalBaseline {
  return evalBaselineSchema.parse(readJsonFile(filePath));
}

export function assertReportIsBaselineReady(report: EvalReport): void {
  const failedScenario = report.scenarios.find(
    (scenario) => !scenario.passed || scenario.checks.some((check) => !check.passed),
  );

  if (failedScenario) {
    throw new Error(
      `Cannot create a baseline from a failing eval report. Scenario "${failedScenario.id}" is not fully passing.`,
    );
  }

  if (report.passedScenarioCount !== report.scenarioCount) {
    throw new Error(
      `Cannot create a baseline from a partially failing eval report (${report.passedScenarioCount}/${report.scenarioCount} scenarios passed).`,
    );
  }

  if (report.passedChecks !== report.totalChecks) {
    throw new Error(
      `Cannot create a baseline from a partially failing eval report (${report.passedChecks}/${report.totalChecks} checks passed).`,
    );
  }
}

export function buildEvalBaseline(report: EvalReport): EvalBaseline {
  assertReportIsBaselineReady(report);

  return {
    generatedAt: new Date().toISOString(),
    sourceReportGeneratedAt: report.generatedAt,
    scenarioCount: report.scenarios.length,
    scenarios: report.scenarios.map((scenario) => ({
      id: scenario.id,
      mustPass: true,
      requiredChecks: scenario.checks.map((check) => check.label),
    })),
  };
}

export function compareEvalReportToBaseline(
  baseline: EvalBaseline,
  candidate: EvalReport,
): EvalBaselineComparison {
  const regressions: EvalBaselineRegression[] = [];
  const candidateScenarios = new Map(candidate.scenarios.map((scenario) => [scenario.id, scenario]));

  let checkedCheckCount = 0;

  for (const expectedScenario of baseline.scenarios) {
    const candidateScenario = candidateScenarios.get(expectedScenario.id);
    if (!candidateScenario) {
      regressions.push({
        scenarioId: expectedScenario.id,
        reason: "scenario is missing from candidate report",
      });
      continue;
    }

    if (expectedScenario.mustPass && !candidateScenario.passed) {
      regressions.push({
        scenarioId: expectedScenario.id,
        reason: "scenario no longer passes",
      });
    }

    const candidateChecks = new Map(candidateScenario.checks.map((check) => [check.label, check]));
    for (const expectedCheckLabel of expectedScenario.requiredChecks) {
      checkedCheckCount += 1;
      const candidateCheck = candidateChecks.get(expectedCheckLabel);

      if (!candidateCheck) {
        regressions.push({
          scenarioId: expectedScenario.id,
          checkLabel: expectedCheckLabel,
          reason: "required check is missing from candidate report",
        });
        continue;
      }

      if (!candidateCheck.passed) {
        regressions.push({
          scenarioId: expectedScenario.id,
          checkLabel: expectedCheckLabel,
          reason: candidateCheck.details
            ? `required check no longer passes (${candidateCheck.details})`
            : "required check no longer passes",
        });
      }
    }
  }

  return {
    passed: regressions.length === 0,
    checkedScenarioCount: baseline.scenarios.length,
    checkedCheckCount,
    regressions,
  };
}
