import { PRAgent } from "../agents/prAgent";
import { PRTriageAgent } from "../agents/prTriageAgent";
import { PRReview, PRTriage, WorkflowResult } from "../core/types";
import { save } from "../memory/simpleMemory";
import { searchCode } from "../tools/codeSearchTool";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

function buildPRWorkflowContext(diff: string, triage: PRTriage): string {
  const searchResults = triage.codeSearchTerms.map((term) => ({
    term,
    matches: searchCode(term)
  }));

  return [
    "Pull request input:",
    diff,
    "",
    "Triage summary:",
    triage.summary,
    "",
    "Review focus:",
    ...triage.reviewFocus.map((item) => `- ${item}`),
    "",
    "Regression checks:",
    ...triage.regressionChecks.map((item) => `- ${item}`),
    "",
    "Code search results:",
    ...searchResults.flatMap((entry) => {
      if (entry.matches.length === 0) {
        return [`- ${entry.term}: no matches found`];
      }

      return [
        `- ${entry.term}:`,
        ...entry.matches.map(
          (match) => `  - ${match.file}:${match.line} ${match.snippet.replace(/\n/g, " ").trim()}`,
        ),
      ];
    }),
  ].join("\n");
}

export async function runPRReviewWorkflow(diff: string): Promise<WorkflowResult<PRReview>> {
  const execution = startAgentExecution("PRReviewWorkflow", diff);

  try {
    const triageAgent = new PRTriageAgent();
    const triage = await triageAgent.run(diff);
    const workflowContext = buildPRWorkflowContext(diff, triage);
    const runId = `pr-review-workflow:${Date.now()}`;

    save(`${runId}:input`, diff);
    save(`${runId}:triage`, triage);
    save(`${runId}:context`, workflowContext);

    const agent = new PRAgent();
    const result = await agent.run(workflowContext);
    logAgentExecutionSuccess(execution, diff, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionFailure(execution, diff, error);
    console.error("[PRReviewWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
