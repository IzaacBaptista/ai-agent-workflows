import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import {
  WorkflowExecutionPolicy,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from "../core/types";
import { env } from "../config/env";

const store = new Map<string, unknown>();
const runStore = new Map<string, WorkflowRunRecord>();

interface CreateRunMemoryInput {
  runId: string;
  workflowName: string;
  input: string;
  policy: WorkflowExecutionPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function isWorkflowRunRecord(value: unknown): value is WorkflowRunRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.runId !== "string" ||
    typeof value.workflowName !== "string" ||
    typeof value.status !== "string" ||
    typeof value.input !== "string" ||
    typeof value.startedAt !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(value.steps) || !isRecord(value.policy) || !isRecord(value.artifacts)) {
    return false;
  }

  return true;
}

function ensureRunStorageDir(): void {
  const runStorageDir = getRunStorageDir();
  if (!existsSync(runStorageDir)) {
    mkdirSync(runStorageDir, { recursive: true });
  }
}

function getRunFilePath(runId: string): string {
  const runStorageDir = getRunStorageDir();
  return join(runStorageDir, `${runId}.json`);
}

function persistRun(run: WorkflowRunRecord): void {
  ensureRunStorageDir();
  const filePath = getRunFilePath(run.runId);
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(run, null, 2), "utf-8");
  renameSync(tempPath, filePath);
  enforcePersistedRunRetention();
}

function enforcePersistedRunRetention(): void {
  const runStorageDir = getRunStorageDir();
  ensureRunStorageDir();

  if (env.MAX_PERSISTED_RUNS <= 0) {
    return;
  }

  const persistedFiles = readdirSync(runStorageDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => {
      const fullPath = join(runStorageDir, fileName);

      try {
        return {
          fileName,
          fullPath,
          mtimeMs: statSync(fullPath).mtimeMs,
        };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { fileName: string; fullPath: string; mtimeMs: number } => Boolean(entry))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const staleFiles = persistedFiles.slice(env.MAX_PERSISTED_RUNS);

  for (const staleFile of staleFiles) {
    const runId = staleFile.fileName.replace(/\.json$/, "");
    rmSync(staleFile.fullPath, { force: true });
    runStore.delete(runId);
  }
}

function loadPersistedRuns(): void {
  const runStorageDir = getRunStorageDir();
  ensureRunStorageDir();

  for (const fileName of readdirSync(runStorageDir)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const fullPath = join(runStorageDir, fileName);

    try {
      const content = readFileSync(fullPath, "utf-8");
      const run = JSON.parse(content);
      if (!isWorkflowRunRecord(run)) {
        continue;
      }

      runStore.set(run.runId, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[memory] Failed to load persisted run from "${fullPath}": ${message}`);
    }
  }
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
  persistRun(record);
  return record;
}

export function saveRunArtifact(runId: string, key: string, value: unknown): void {
  const run = getRunMemory(runId);
  run.artifacts[key] = value;
  persistRun(run);
}

export function appendRunStep(runId: string, step: WorkflowStepRecord): void {
  const run = getRunMemory(runId);
  run.steps.push(step);
  persistRun(run);
}

export function updateRunStep(runId: string, stepId: string, updates: Partial<WorkflowStepRecord>): void {
  const run = getRunMemory(runId);
  const step = run.steps.find((entry) => entry.stepId === stepId);

  if (!step) {
    throw new Error(`Unknown workflow step "${stepId}" for run "${runId}"`);
  }

  Object.assign(step, updates);
  persistRun(run);
}

export function completeRun(runId: string): WorkflowRunRecord {
  const run = getRunMemory(runId);
  run.status = "completed";
  run.completedAt = new Date().toISOString();
  persistRun(run);
  return run;
}

export function failRun(runId: string, error: string): WorkflowRunRecord {
  const run = getRunMemory(runId);
  run.status = "failed";
  run.completedAt = new Date().toISOString();
  run.error = error;
  persistRun(run);
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

export function resetRunMemories(options: { clearPersistedRuns?: boolean } = {}): void {
  store.clear();
  runStore.clear();

  if (options.clearPersistedRuns) {
    const runStorageDir = getRunStorageDir();
    ensureRunStorageDir();

    for (const fileName of readdirSync(runStorageDir)) {
      if (!fileName.endsWith(".json") && !fileName.endsWith(".tmp") && fileName !== "_system") {
        continue;
      }

      rmSync(join(runStorageDir, fileName), { force: true, recursive: fileName === "_system" });
    }

    return;
  }

  loadPersistedRuns();
}

loadPersistedRuns();
function getRunStorageDir(): string {
  return resolve(process.cwd(), env.RUN_STORAGE_DIR);
}
