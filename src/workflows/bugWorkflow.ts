import { BugAgent } from "../agents/bugAgent";
import { BugTriageAgent } from "../agents/bugTriageAgent";
import { BugAnalysis, BugTriage, WorkflowResult } from "../core/types";
import { save } from "../memory/simpleMemory";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";
import { searchCode } from "../tools/codeSearchTool";

function buildBugWorkflowContext(bugDescription: string, triage: BugTriage): string {
  const searchResults = triage.codeSearchTerms.map((term) => ({
    term,
    matches: searchCode(term)
  }));

  return [
    `Bug description: ${bugDescription}`,
    "",
    "Triage summary:",
    triage.summary,
    "",
    "Initial hypotheses:",
    ...triage.hypotheses.map((item) => `- ${item}`),
    "",
    "Suggested API checks:",
    ...triage.apiChecks.map((item) => `- ${item}`),
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

export async function runBugWorkflow(bugDescription: string): Promise<WorkflowResult<BugAnalysis>> {
  const execution = startAgentExecution("BugWorkflow", bugDescription);

  try {
    const triageAgent = new BugTriageAgent();
    const triage = await triageAgent.run(bugDescription);
    const workflowContext = buildBugWorkflowContext(bugDescription, triage);
    const runId = `bug-workflow:${Date.now()}`;

    save(`${runId}:input`, bugDescription);
    save(`${runId}:triage`, triage);
    save(`${runId}:context`, workflowContext);

    const agent = new BugAgent();
    const result = await agent.run(workflowContext);
    logAgentExecutionSuccess(execution, bugDescription, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionFailure(execution, bugDescription, error);
    console.error("[BugWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
