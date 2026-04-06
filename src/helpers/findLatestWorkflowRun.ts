import { WorkflowRunRecord } from "../core/types";
import { getAllRunMemories } from "../memory/simpleMemory";

export function findLatestSuccessfulWorkflowRun(
  workflowName: string,
  predicate: (run: WorkflowRunRecord) => boolean,
): WorkflowRunRecord | undefined {
  return getAllRunMemories()
    .filter((run) => run.workflowName === workflowName && run.status === "completed")
    .filter(predicate)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
}
