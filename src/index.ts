#!/usr/bin/env node
import { parseCliArgs } from "./cli/parseCliArgs";
import { WorkflowResult } from "./core/types";
import { getRunMemory } from "./memory/simpleMemory";
import { ExecutionReporter } from "./reporting/ExecutionReporter";
import { runIssueWorkflow } from "./workflows/issueWorkflow";
import { runBugWorkflow } from "./workflows/bugWorkflow";
import { runPRReviewWorkflow } from "./workflows/prReviewWorkflow";
import { runJiraIssueWorkflow } from "./workflows/jiraIssueWorkflow";
import { runJiraAnalyzeWorkflow } from "./workflows/jiraAnalyzeWorkflow";
import { runPRCreateWorkflow } from "./workflows/prCreateWorkflow";
import { runRepoInvestigateWorkflow } from "./workflows/repoInvestigateWorkflow";

function printUsage(): void {
  console.log(`
Usage: ai <namespace> <subcommand> <arg> [--output raw|summary|timeline]

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

Examples:
  ai jira issue REL-123
  ai jira analyze REL-123
  ai github pr review 42
  ai github pr create REL-123
  ai repo investigate "timeout not cleared in auth middleware"
  ai issue "User cannot login after password reset"
  ai bug "500 error when creating order with coupon"
  ai pr "Refactored auth middleware and updated token validation"
  ai pr "Refactored auth middleware" --output summary
`);
}

async function main(): Promise<void> {
  const command = parseCliArgs(process.argv);

  if (command.kind === "unknown") {
    console.error(`Error: Unknown or missing command.`);
    printUsage();
    process.exit(1);
  }

  try {
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
      result = await runJiraAnalyzeWorkflow(command.issueKey);
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
