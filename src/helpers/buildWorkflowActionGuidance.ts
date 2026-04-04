import { getAllowedCommandNames } from "../tools/runCommandTool";

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function buildWorkflowActionGuidance(workflowName: string, context: string): string {
  const normalized = context.toLowerCase();
  const commandSignals: string[] = [];

  const shouldPreferBuild = includesAny(normalized, [
    "build",
    "compile",
    "compiled",
    "compiler",
    "typescript",
    "tsc",
    "typecheck",
    "type error",
    "typing",
    "lint",
    "refactor",
    "normalized",
  ]);

  const shouldPreferTest = includesAny(normalized, [
    "test",
    "tests",
    "ci",
    "spec",
    "jest",
    "node:test",
    "hang",
    "hangs",
    "timeout",
    "timeouts",
    "open handle",
    "regression",
    "failing",
    "failure",
    "runtime behavior",
  ]);

  if (shouldPreferBuild) {
    commandSignals.push("build");
  }

  if (shouldPreferTest) {
    commandSignals.push("test");
  }

  const lines = [
    "Workflow execution guidance:",
    `Allowed run_command commands: ${getAllowedCommandNames().join(", ")}`,
    `Detected command-driven verification signals: ${commandSignals.length > 0 ? commandSignals.join(", ") : "none"}`,
    "- Reuse existing command results when they already answer the build/test question; do not request the same command again unless the state changed materially.",
    "- Prefer `run_command` over extra `search_code` and `read_file` steps when the remaining uncertainty is best answered by executable build/test evidence.",
  ];

  if (workflowName === "BugWorkflow") {
    lines.push(
      "- In BugWorkflow, prefer `run_command` with `test` for hangs, timeouts, open handles, CI failures, runtime regressions, or test-related symptoms after minimal code localization.",
      "- In BugWorkflow, prefer `run_command` with `build` when the likely issue is compile, type, integration, or packaging breakage.",
      "- In BugWorkflow, prefer `run_command` with `lint` for static type-check or code-quality regressions when executable runtime evidence is not necessary yet.",
    );
  } else if (workflowName === "PRReviewWorkflow") {
    lines.push(
      "- In PRReviewWorkflow, prefer `run_command` with `build` when reviewing changes to runtime, core, workflows, types, tools, agents, server code, or refactors that may affect compilation.",
      "- In PRReviewWorkflow, prefer `run_command` with `test` when the PR touches timers, memory, runtime behavior, regression-prone paths, or test/CI semantics.",
      "- In PRReviewWorkflow, prefer `run_command` with `lint` for static hygiene checks around types, tooling, and surface-level integration changes when a full build is not the narrowest proof needed.",
      "- Do not give a high-confidence PR conclusion about safety if build/test evidence is the main missing proof and no relevant command result exists yet.",
    );
  } else if (workflowName === "IssueWorkflow") {
    lines.push(
      "- In IssueWorkflow, use `run_command` only for repository-local runtime, build, test, or static-check regressions; generic product issues should still prefer analysis and code/context gathering.",
    );
  }

  return lines.join("\n");
}
