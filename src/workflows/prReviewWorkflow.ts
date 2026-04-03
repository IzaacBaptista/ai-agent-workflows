import { PRAgent } from "../agents/prAgent";
import { PRReview } from "../core/types";
import { logAgentExecution } from "../tools/loggingTool";

export async function runPRReviewWorkflow(diff: string): Promise<PRReview> {
  const agent = new PRAgent();
  const result = await agent.run(diff);
  logAgentExecution("PRAgent", diff, result);
  return result;
}
