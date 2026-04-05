import { WorkflowResult, WorkflowRunRecord } from "../core/types";

export const OUTPUT_MODES = ["raw", "summary", "timeline"] as const;

export type OutputMode = typeof OUTPUT_MODES[number];

export interface ExecutionReporterInput<T> {
  result: WorkflowResult<T>;
  runRecord: WorkflowRunRecord | null;
}

export function isOutputMode(value: string | undefined): value is OutputMode {
  return Boolean(value && OUTPUT_MODES.includes(value as OutputMode));
}

export function normalizeOutputMode(value: string | undefined): OutputMode {
  return isOutputMode(value) ? value : "raw";
}
