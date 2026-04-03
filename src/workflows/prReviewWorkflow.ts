import { PRAgent } from "../agents/prAgent";
import { PRReview, WorkflowResult } from "../core/types";
import { logAgentExecution } from "../tools/loggingTool";

export async function runPRReviewWorkflow(diff: string): Promise<WorkflowResult<PRReview>> {
  try {
    const agent = new PRAgent();
    const result = await agent.run(diff);
    logAgentExecution("PRAgent", diff, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[PRReviewWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
