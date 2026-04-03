import { IssueAgent } from "../agents/issueAgent";

export async function runIssueWorkflow(issue: string) {
  const agent = new IssueAgent();

  const result = await agent.run(issue);

  console.log("===== ISSUE ANALYSIS =====");
  console.log(JSON.stringify(result, null, 2));

  return result;
}