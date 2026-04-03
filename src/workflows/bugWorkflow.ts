import { BugAgent } from "../agents/bugAgent";
import { BugAnalysis, WorkflowResult } from "../core/types";
import { logAgentExecution } from "../tools/loggingTool";

export async function runBugWorkflow(bugDescription: string): Promise<WorkflowResult<BugAnalysis>> {
  try {
    const agent = new BugAgent();
    const result = await agent.run(bugDescription);
    logAgentExecution("BugAgent", bugDescription, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[BugWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
