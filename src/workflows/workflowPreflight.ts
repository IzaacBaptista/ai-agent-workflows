import { getLlmPreflightError } from "../core/llmClient";
import { WorkflowExecutionMeta, WorkflowResult } from "../core/types";
import { WorkflowRuntime } from "../core/workflowRuntime";
import { logAgentExecutionFailure, startAgentExecution } from "../tools/loggingTool";

export function buildLlmPreflightFailure<T>(
  workflowName: string,
  input: string,
  extraMeta: Partial<WorkflowExecutionMeta> = {},
): WorkflowResult<T> | null {
  const error = getLlmPreflightError();
  if (!error) {
    return null;
  }

  const execution = startAgentExecution(workflowName, input);
  const runtime = new WorkflowRuntime({
    workflowName,
    input,
  });

  runtime.fail(error.message);
  logAgentExecutionFailure(execution, input, error);
  console.error(`[${workflowName}] Failed:`, error.message);

  return {
    success: false,
    error: error.message,
    meta: { ...runtime.getMeta(), ...extraMeta },
  };
}
