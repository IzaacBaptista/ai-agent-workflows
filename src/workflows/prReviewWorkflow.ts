import { PRAgent } from "../agents/prAgent";
import { PRReview, WorkflowResult } from "../core/types";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

export async function runPRReviewWorkflow(diff: string): Promise<WorkflowResult<PRReview>> {
  const execution = startAgentExecution("PRAgent", diff);

  try {
    const agent = new PRAgent();
    const result = await agent.run(diff);
    logAgentExecutionSuccess(execution, diff, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionFailure(execution, diff, error);
    console.error("[PRReviewWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
