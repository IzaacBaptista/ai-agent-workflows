import { IssueAgent } from "../agents/issueAgent";

export async function runIssueWorkflow(issue: string) {
  const agent = new IssueAgent();
  const result = await agent.run(issue);

  return result;
}
