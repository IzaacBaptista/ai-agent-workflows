import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { buildEvalBaseline, loadEvalReport } from "./baseline";

function parseArgs(): { reportPath?: string; outputPath?: string } {
  const args = process.argv.slice(2);
  const reportFlagIndex = args.findIndex((value) => value === "--report");
  const outputFlagIndex = args.findIndex((value) => value === "--output");

  return {
    reportPath: reportFlagIndex >= 0 ? args[reportFlagIndex + 1] : undefined,
    outputPath: outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined,
  };
}

function main(): void {
  const { reportPath, outputPath } = parseArgs();
  if (!reportPath || !outputPath) {
    console.error("Usage: ts-node src/evals/createEvalBaseline.ts --report <report.json> --output <baseline.json>");
    process.exitCode = 1;
    return;
  }

  const report = loadEvalReport(reportPath);
  const baseline = buildEvalBaseline(report);
  const resolvedOutputPath = resolve(process.cwd(), outputPath);

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf-8");

  console.log(
    `Baseline written to ${resolvedOutputPath} (${baseline.scenarioCount} scenarios, ${baseline.scenarios.reduce((count, scenario) => count + scenario.requiredChecks.length, 0)} checks).`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Eval baseline generation failed: ${message}`);
  process.exitCode = 1;
}
