import { runIssueWorkflow } from "./workflows/issueWorkflow";
import { runBugWorkflow } from "./workflows/bugWorkflow";
import { runPRReviewWorkflow } from "./workflows/prReviewWorkflow";

function printUsage(): void {
  console.log(`
Usage: npm run dev -- <command> "<input text>"

Commands:
  issue   Analyse a product or engineering issue
  bug     Diagnose a bug and suggest fixes
  pr      Review a pull request description

Examples:
  npm run dev -- issue "User cannot login after password reset"
  npm run dev -- bug "500 error when creating order with coupon"
  npm run dev -- pr "Refactored auth middleware and updated token validation"
`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const input = rest.join(" ").trim();

  const validCommands = ["issue", "bug", "pr"];

  if (!command || !validCommands.includes(command)) {
    console.error(`Error: Unknown or missing command "${command ?? ""}".`);
    printUsage();
    process.exit(1);
  }

  if (!input) {
    console.error(`Error: No input text provided for command "${command}".`);
    printUsage();
    process.exit(1);
  }

  try {
    let result;

    if (command === "issue") {
      result = await runIssueWorkflow(input);
    } else if (command === "bug") {
      result = await runBugWorkflow(input);
    } else {
      result = await runPRReviewWorkflow(input);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
