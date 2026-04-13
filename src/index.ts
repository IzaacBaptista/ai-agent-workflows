#!/usr/bin/env node
import { createInterface } from "readline";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { parseCliArgs } from "./cli/parseCliArgs";
import { WorkflowResult } from "./core/types";
import { getRunMemory } from "./memory/simpleMemory";
import { env } from "./config/env";
import { loadProjectConfig } from "./config/projectConfig";
import { ExecutionReporter } from "./reporting/ExecutionReporter";
import { runIssueWorkflow } from "./workflows/issueWorkflow";
import { runBugWorkflow } from "./workflows/bugWorkflow";
import { runPRReviewWorkflow } from "./workflows/prReviewWorkflow";
import { runJiraIssueWorkflow } from "./workflows/jiraIssueWorkflow";
import { runJiraAnalyzeWorkflow } from "./workflows/jiraAnalyzeWorkflow";
import { runPRCreateWorkflow } from "./workflows/prCreateWorkflow";
import { runRepoInvestigateWorkflow } from "./workflows/repoInvestigateWorkflow";
import { runApplyPlanWorkflow } from "./workflows/applyPlanWorkflow";
import { resetRunMemories } from "./memory/simpleMemory";

function printUsage(): void {
  console.log(`
Usage: ai <namespace> <subcommand> <arg> [--repo <path>] [--output raw|summary|timeline]

Namespaced commands:
  jira issue <KEY>          Analyse a Jira issue (e.g. REL-123)
  jira analyze <KEY>        Deep technical analysis of a Jira issue
  github pr review <NUMBER> Review a GitHub pull request by number
  github pr create <KEY>    Draft and optionally open a GitHub PR from a Jira issue
  repo investigate "<query>"  Investigate a query against the local repository

Flat aliases (backward-compatible):
  issue   "<text>"   Analyse a product or engineering issue
  bug     "<text>"   Diagnose a bug and suggest fixes
  pr      "<text>"   Review a pull request description

jira analyze flags:
  --plan-only   Stop after producing the implementation plan (no apply)
  --yes / -y    Skip all interactive prompts (non-interactive / CI mode)
  --agentic     Use the full planner/replanner/critic loop instead of the simple path

Examples:
  ai jira issue REL-123
  ai jira analyze REL-123
  ai jira analyze REL-123 --repo ~/Projects/srp
  ai jira analyze REL-123 --yes
  ai jira analyze REL-123 --plan-only
  ai jira analyze REL-123 --agentic
  ai github pr review 42
  ai github pr create REL-123
  ai repo investigate "timeout not cleared in auth middleware"
  ai issue "User cannot login after password reset"
  ai bug "500 error when creating order with coupon"
  ai pr "Refactored auth middleware and updated token validation"
  ai pr "Refactored auth middleware" --output summary
`);
}

const MAX_STDERR_DISPLAY_CHARS = 1000;

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(question, (answer) => {
      rl.close();
      resolveAnswer(answer.trim().toLowerCase() === "y");
    });
  });
}

function resolveCliPath(value: string): string {
  if (value === "~") {
    return homedir();
  }

  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }

  return resolve(value);
}

function applyRepoExecutionContext(repoRoot?: string): string | undefined {
  if (!repoRoot) {
    return undefined;
  }

  const resolvedRepoRoot = resolveCliPath(repoRoot);
  if (!existsSync(resolvedRepoRoot) || !statSync(resolvedRepoRoot).isDirectory()) {
    throw new Error(`Repository path does not exist or is not a directory: ${repoRoot}`);
  }

  const projectConfig = loadProjectConfig(resolvedRepoRoot);
  if (projectConfig.model) {
    env.MODEL = projectConfig.model;
  }
  if (projectConfig.runStorageDir) {
    env.RUN_STORAGE_DIR = projectConfig.runStorageDir;
  }
  if (projectConfig.jiraBaseUrl) {
    env.JIRA_BASE_URL = projectConfig.jiraBaseUrl;
  }
  if (projectConfig.githubRepo) {
    env.GITHUB_REPO = projectConfig.githubRepo;
  }

  process.chdir(resolvedRepoRoot);
  resetRunMemories();
  return resolvedRepoRoot;
}

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv);

  if (command.kind === "unknown") {
    console.error(`Error: Unknown or missing command.`);
    printUsage();
    process.exit(1);
  }

  try {
    applyRepoExecutionContext("repoRoot" in command ? command.repoRoot : undefined);
    let result: WorkflowResult<unknown>;

    if (command.kind === "issue") {
      if (!command.input) {
        console.error("Error: No input text provided for command \"issue\".");
        printUsage();
        process.exit(1);
      }
      result = await runIssueWorkflow(command.input);
    } else if (command.kind === "bug") {
      if (!command.input) {
        console.error("Error: No input text provided for command \"bug\".");
        printUsage();
        process.exit(1);
      }
      result = await runBugWorkflow(command.input);
    } else if (command.kind === "pr") {
      if (!command.input) {
        console.error("Error: No input text provided for command \"pr\".");
        printUsage();
        process.exit(1);
      }
      result = await runPRReviewWorkflow(command.input);
    } else if (command.kind === "jira-issue") {
      result = await runJiraIssueWorkflow(command.issueKey);
    } else if (command.kind === "jira-analyze") {
      const analyzeResult = await runJiraAnalyzeWorkflow(command.issueKey, {
        agentic: command.agentic,
      });

      if (!analyzeResult.success) {
        console.error(`Error: ${analyzeResult.error}`);
        process.exit(1);
      }

      const analysis = analyzeResult.data;

      console.log("\n=== Implementation Plan ===");
      console.log(`Summary: ${analysis.summary}`);
      console.log(`Branch: ${analysis.suggestedBranchName}`);
      console.log(`PR Title: ${analysis.suggestedPRTitle}`);
      console.log("\nSteps:");
      for (const step of analysis.implementationPlan) {
        console.log(`  - ${step}`);
      }
      console.log("\nAcceptance Criteria:");
      for (const criterion of analysis.acceptanceCriteria) {
        console.log(`  - ${criterion}`);
      }
      if (analysis.risks.length > 0) {
        console.log("\nRisks:");
        for (const risk of analysis.risks) {
          console.log(`  - ${risk}`);
        }
      }

      if (command.planOnly) {
        result = analyzeResult;
      } else {
        const shouldApply = command.yes || (await askYesNo("\nApply changes? [y/N] "));
        if (!shouldApply) {
          console.log("Skipping apply. Plan saved.");
          result = analyzeResult;
        } else {
          console.log("\nApplying changes...");
          const firstApply = await runApplyPlanWorkflow(command.issueKey, analysis);
          let applyResult = firstApply;

          if (!applyResult.success) {
            console.error(`Apply failed: ${applyResult.error}`);
            const shouldRetry =
              !command.yes && (await askYesNo("Retry apply? [y/N] "));
            if (shouldRetry) {
              console.log("Retrying...");
              const retryApply = await runApplyPlanWorkflow(command.issueKey, analysis);
              applyResult = retryApply;
            }
          }

          if (!applyResult.success) {
            console.error(`Apply failed: ${applyResult.error}`);
            result = analyzeResult;
          } else {
            const { patchResult, validationResult } = applyResult;
            console.log(`\nApplied ${patchResult.edits.length} file(s):`);
            for (const edit of patchResult.edits) {
              console.log(`  ${edit.changeType} ${edit.path} (${edit.bytesWritten} bytes)`);
            }

            if (validationResult) {
              const passed = validationResult.exitCode === 0 && !validationResult.timedOut;
              console.log(
                `\nValidation (${validationResult.command}): ${passed ? "PASSED" : "FAILED"} (exit ${validationResult.exitCode ?? "null"})`,
              );
              if (!passed && validationResult.stderr) {
                console.log(validationResult.stderr.slice(0, MAX_STDERR_DISPLAY_CHARS));
              }
            }

            const validationPassed =
              !validationResult ||
              (validationResult.exitCode === 0 && !validationResult.timedOut);

            if (validationPassed) {
              const shouldOpenPr =
                command.yes || (await askYesNo("\nOpen PR on GitHub? [y/N] "));
              if (shouldOpenPr) {
                console.log("\nOpening PR...");
                const prResult = await runPRCreateWorkflow(command.issueKey);
                if (prResult.success && prResult.data.prUrl) {
                  console.log(`PR opened: ${prResult.data.prUrl}`);
                } else if (prResult.success) {
                  console.log(`PR draft created: ${prResult.data.title}`);
                } else {
                  console.error(`PR creation failed: ${prResult.error}`);
                }
                result = prResult;
              } else {
                result = analyzeResult;
              }
            } else {
              console.log(
                "\nValidation failed. Fix the issues manually and open a PR when ready.",
              );
              result = analyzeResult;
            }
          }
        }
      }
    } else if (command.kind === "github-pr-review") {
      result = await runPRReviewWorkflow(command.input);
    } else if (command.kind === "github-pr-create") {
      result = await runPRCreateWorkflow(command.issueKey);
    } else {
      // repo-investigate
      result = await runRepoInvestigateWorkflow(command.query);
    }

    const outputMode = "outputMode" in command ? command.outputMode : "raw";

    if (outputMode !== "raw") {
      const runRecord = (() => {
        try {
          return getRunMemory(result.meta.runId);
        } catch {
          return null;
        }
      })();
      const report = ExecutionReporter.render({ result, runRecord }, outputMode);
      if (report) {
        console.log(report);
      }
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
