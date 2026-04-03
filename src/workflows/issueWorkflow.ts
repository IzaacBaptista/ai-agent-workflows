import { IssueAgent } from "../agents/issueAgent";
import { IssueAnalysis, WorkflowResult } from "../core/types";
import { logAgentExecution } from "../tools/loggingTool";

export async function runIssueWorkflow(issue: string): Promise<WorkflowResult<IssueAnalysis>> {
  try {
    const agent = new IssueAgent();
    const result = await agent.run(issue);
    logAgentExecution("IssueAgent", issue, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[IssueWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}