import { PRAgent } from "../agents/prAgent";
import { logAgentExecution } from "../tools/loggingTool";

export async function runPRReviewWorkflow(diff: string) {
  const agent = new PRAgent();

  const result = await agent.run(diff);

  logAgentExecution("PRAgent", diff, result);

  return result;
}
