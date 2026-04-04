import {
  WorkflowExecutionPolicy,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from "../core/types";

const store = new Map<string, unknown>();
const runStore = new Map<string, WorkflowRunRecord>();

interface CreateRunMemoryInput {
  runId: string;
  workflowName: string;
  input: string;
  policy: WorkflowExecutionPolicy;
}

export function save(key: string, value: unknown): void {
  store.set(key, value);
}

export function get(key: string): unknown {
  return store.get(key);
}

export function getAll(): Record<string, unknown> {
  return Object.fromEntries(store.entries());
}

export function createRunMemory(input: CreateRunMemoryInput): WorkflowRunRecord {
  const record: WorkflowRunRecord = {
    runId: input.runId,
    workflowName: input.workflowName,
    status: "running",
    input: input.input,
    startedAt: new Date().toISOString(),
    policy: input.policy,
    steps: [],
    artifacts: {},
  };

  runStore.set(input.runId, record);
  return record;
}

export function saveRunArtifact(runId: string, key: string, value: unknown): void {
  const run = getRunMemory(runId);
  run.artifacts[key] = value;
}

export function appendRunStep(runId: string, step: WorkflowStepRecord): void {
  const run = getRunMemory(runId);
  run.steps.push(step);
}

export function updateRunStep(runId: string, stepId: string, updates: Partial<WorkflowStepRecord>): void {
  const run = getRunMemory(runId);
  const step = run.steps.find((entry) => entry.stepId === stepId);

  if (!step) {
    throw new Error(`Unknown workflow step "${stepId}" for run "${runId}"`);
  }

  Object.assign(step, updates);
}

export function completeRun(runId: string): WorkflowRunRecord {
  const run = getRunMemory(runId);
  run.status = "completed";
  run.completedAt = new Date().toISOString();
  return run;
}

export function failRun(runId: string, error: string): WorkflowRunRecord {
  const run = getRunMemory(runId);
  run.status = "failed";
  run.completedAt = new Date().toISOString();
  run.error = error;
  return run;
}

export function getRunMemory(runId: string): WorkflowRunRecord {
  const run = runStore.get(runId);
  if (!run) {
    throw new Error(`Unknown workflow run "${runId}"`);
  }

  return run;
}

export function getAllRunMemories(): WorkflowRunRecord[] {
  return Array.from(runStore.values());
}
