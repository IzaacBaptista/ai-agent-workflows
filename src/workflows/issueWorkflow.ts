import { IssueAgent } from "../agents/issueAgent";
import { IssueAnalysis, WorkflowResult } from "../core/types";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

export async function runIssueWorkflow(issue: string): Promise<WorkflowResult<IssueAnalysis>> {
  const execution = startAgentExecution("IssueAgent", issue);

  try {
    const agent = new IssueAgent();
    const result = await agent.run(issue);
    logAgentExecutionSuccess(execution, issue, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionFailure(execution, issue, error);
    console.error("[IssueWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
