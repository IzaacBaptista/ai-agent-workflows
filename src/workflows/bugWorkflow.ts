import { BugAgent } from "../agents/bugAgent";
import { BugAnalysis } from "../core/types";
import { logAgentExecution } from "../tools/loggingTool";

export async function runBugWorkflow(bugDescription: string): Promise<BugAnalysis> {
  const agent = new BugAgent();
  const result = await agent.run(bugDescription);
  logAgentExecution("BugAgent", bugDescription, result);
  return result;
}
