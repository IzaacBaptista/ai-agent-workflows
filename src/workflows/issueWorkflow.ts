import { IssueAgent } from "../agents/issueAgent";
import { IssueTriageAgent } from "../agents/issueTriageAgent";
import { IssueAnalysis, IssueTriage, WorkflowResult } from "../core/types";
import { save } from "../memory/simpleMemory";
import { searchCode } from "../tools/codeSearchTool";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

function buildIssueWorkflowContext(issue: string, triage: IssueTriage): string {
  const searchResults = triage.codeSearchTerms.map((term) => ({
    term,
    matches: searchCode(term)
  }));

  return [
    "Issue input:",
    issue,
    "",
    "Triage summary:",
    triage.summary,
    "",
    "Investigation areas:",
    ...triage.investigationAreas.map((item) => `- ${item}`),
    "",
    "Validation checks:",
    ...triage.validationChecks.map((item) => `- ${item}`),
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

export async function runIssueWorkflow(issue: string): Promise<WorkflowResult<IssueAnalysis>> {
  const execution = startAgentExecution("IssueWorkflow", issue);

  try {
    const triageAgent = new IssueTriageAgent();
    const triage = await triageAgent.run(issue);
    const workflowContext = buildIssueWorkflowContext(issue, triage);
    const runId = `issue-workflow:${Date.now()}`;

    save(`${runId}:input`, issue);
    save(`${runId}:triage`, triage);
    save(`${runId}:context`, workflowContext);

    const agent = new IssueAgent();
    const result = await agent.run(workflowContext);
    logAgentExecutionSuccess(execution, issue, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionFailure(execution, issue, error);
    console.error("[IssueWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
