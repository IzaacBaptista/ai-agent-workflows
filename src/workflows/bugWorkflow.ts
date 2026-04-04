import { BugAgent } from "../agents/bugAgent";
import { BugAnalysis, WorkflowResult } from "../core/types";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

export async function runBugWorkflow(bugDescription: string): Promise<WorkflowResult<BugAnalysis>> {
  const execution = startAgentExecution("BugAgent", bugDescription);

  try {
    const agent = new BugAgent();
    const result = await agent.run(bugDescription);
    logAgentExecutionSuccess(execution, bugDescription, result);
    return { success: true, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionFailure(execution, bugDescription, error);
    console.error("[BugWorkflow] Failed:", message);
    return { success: false, error: message };
  }
}
