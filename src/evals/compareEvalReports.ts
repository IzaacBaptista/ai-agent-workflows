import { compareEvalReportToBaseline, loadEvalBaseline, loadEvalReport } from "./baseline";

function parseArgs(): { baselinePath?: string; candidatePath?: string } {
  const args = process.argv.slice(2);
  const baselineFlagIndex = args.findIndex((value) => value === "--baseline");
  const candidateFlagIndex = args.findIndex((value) => value === "--candidate");

  return {
    baselinePath: baselineFlagIndex >= 0 ? args[baselineFlagIndex + 1] : undefined,
    candidatePath: candidateFlagIndex >= 0 ? args[candidateFlagIndex + 1] : undefined,
  };
}

function main(): void {
  const { baselinePath, candidatePath } = parseArgs();
  if (!baselinePath || !candidatePath) {
    console.error(
      "Usage: ts-node src/evals/compareEvalReports.ts --baseline <baseline.json> --candidate <report.json>",
    );
    process.exitCode = 1;
    return;
  }

  const baseline = loadEvalBaseline(baselinePath);
  const candidate = loadEvalReport(candidatePath);
  const comparison = compareEvalReportToBaseline(baseline, candidate);

  console.log(`Baseline: ${baselinePath}`);
  console.log(`Candidate: ${candidatePath}`);
  console.log("");

  if (comparison.regressions.length === 0) {
    console.log(
      `PASS baseline comparison (${comparison.checkedScenarioCount} scenarios, ${comparison.checkedCheckCount} checks matched baseline expectations).`,
    );
    return;
  }

  console.log("FAIL baseline comparison");
  for (const regression of comparison.regressions) {
    const checkSuffix = regression.checkLabel ? ` / ${regression.checkLabel}` : "";
    console.log(`- ${regression.scenarioId}${checkSuffix}: ${regression.reason}`);
  }

  console.log("");
  console.log(
    `Summary: ${comparison.regressions.length} regression(s) across ${comparison.checkedScenarioCount} baseline scenarios and ${comparison.checkedCheckCount} required checks.`,
  );
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Eval report comparison failed: ${message}`);
  process.exitCode = 1;
}
