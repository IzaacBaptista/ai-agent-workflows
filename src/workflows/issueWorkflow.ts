import { IssueAgent } from "../agents/issueAgent";
import { IssueAnalysis } from "../core/types";
import { logAgentExecution } from "../tools/loggingTool";

export async function runIssueWorkflow(issue: string): Promise<IssueAnalysis> {
  const agent = new IssueAgent();
  const result = await agent.run(issue);
  logAgentExecution("IssueAgent", issue, result);
  return result;
}