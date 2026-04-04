import {
  WorkflowExecutionMeta,
  WorkflowCritique,
  WorkflowPlan,
  WorkflowReplan,
  WorkflowExecutionPolicy,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from "./types";
import {
  appendRunStep,
  completeRun,
  createRunMemory,
  failRun,
  getRunMemory,
  saveRunArtifact,
  updateRunStep,
} from "../memory/simpleMemory";
import { logWorkflowStep } from "../tools/loggingTool";

interface WorkflowRuntimeOptions {
  workflowName: string;
  input: string;
  policy?: Partial<WorkflowExecutionPolicy>;
}

interface ExecuteStepOptions {
  agentName?: string;
  inputSummary?: string;
  outputSummary?: (value: unknown) => string | undefined;
}

interface RuntimeProgressState {
  lastAction?: string;
  lastSignature?: string;
  consecutiveNoProgress: number;
}

const DEFAULT_POLICY: WorkflowExecutionPolicy = {
  maxSteps: 10,
  maxRetriesPerStep: 1,
  timeoutMs: 60_000,
  maxConsecutiveNoProgress: 1,
};

function createRunId(workflowName: string): string {
  return `${workflowName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeValue(value: unknown, limit = 240): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = serialized.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

export class WorkflowRuntime {
  readonly runId: string;
  readonly workflowName: string;
  readonly policy: WorkflowExecutionPolicy;
  private stepCount = 0;

  constructor(options: WorkflowRuntimeOptions) {
    this.workflowName = options.workflowName;
    this.runId = createRunId(options.workflowName);
    this.policy = {
      ...DEFAULT_POLICY,
      ...options.policy,
    };

    createRunMemory({
      runId: this.runId,
      workflowName: this.workflowName,
      input: options.input,
      policy: this.policy,
    });
  }

  saveArtifact(key: string, value: unknown): void {
    saveRunArtifact(this.runId, key, value);
  }

  savePlan(plan: WorkflowPlan): void {
    saveRunArtifact(this.runId, "plan", plan);
  }

  saveReplan(replan: WorkflowReplan): void {
    const current = this.getArtifactsValue<WorkflowReplan[]>("replans") ?? [];
    saveRunArtifact(this.runId, "replans", [...current, replan]);
  }

  saveCritique(critique: WorkflowCritique): void {
    const current = this.getArtifactsValue<WorkflowCritique[]>("critiques") ?? [];
    saveRunArtifact(this.runId, "critiques", [...current, critique]);
  }

  recordProgress(action: string, signature: string, progressMade: boolean): number {
    const current = this.getArtifactsValue<RuntimeProgressState>("runtimeProgressState") ?? {
      consecutiveNoProgress: 0,
    };

    const repeatedAction = current.lastAction === action && current.lastSignature === signature;
    const effectiveProgressMade = progressMade && !repeatedAction;
    const consecutiveNoProgress =
      !effectiveProgressMade && repeatedAction
        ? current.consecutiveNoProgress + 1
        : !effectiveProgressMade
          ? 1
          : 0;

    saveRunArtifact(this.runId, "runtimeProgressState", {
      lastAction: action,
      lastSignature: signature,
      consecutiveNoProgress,
    } satisfies RuntimeProgressState);

    return consecutiveNoProgress;
  }

  shouldForceFinalAnalysis(): boolean {
    const state = this.getArtifactsValue<RuntimeProgressState>("runtimeProgressState");
    return (state?.consecutiveNoProgress ?? 0) >= this.policy.maxConsecutiveNoProgress;
  }

  forceFinalAnalysis(reason: string): void {
    saveRunArtifact(this.runId, "forcedFinalAnalysisReason", reason);
  }

  getRunRecord(): WorkflowRunRecord {
    return getRunMemory(this.runId);
  }

  getMeta(): WorkflowExecutionMeta {
    const run = this.getRunRecord();
    const critiques = (run.artifacts.critiques as WorkflowCritique[] | undefined) ?? [];
    const replans = (run.artifacts.replans as WorkflowReplan[] | undefined) ?? [];

    return {
      runId: run.runId,
      workflowName: run.workflowName,
      status: run.status,
      stepCount: run.steps.length,
      critiqueCount: critiques.length,
      replanCount: replans.length,
    };
  }

  private getArtifactsValue<T>(key: string): T | undefined {
    return this.getRunRecord().artifacts[key] as T | undefined;
  }

  async executeStep<T>(
    name: string,
    executor: () => Promise<T>,
    options: ExecuteStepOptions = {},
  ): Promise<T> {
    this.stepCount += 1;
    if (this.stepCount > this.policy.maxSteps) {
      throw new Error(
        `Execution policy exceeded maxSteps=${this.policy.maxSteps} for workflow "${this.workflowName}"`,
      );
    }

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.policy.maxRetriesPerStep) {
      attempt += 1;

      const stepId = `${name}:${this.stepCount}:${attempt}`;
      const stepRecord: WorkflowStepRecord = {
        stepId,
        name,
        status: "running",
        attempt,
        startedAt: new Date().toISOString(),
        agentName: options.agentName,
        inputSummary: options.inputSummary,
      };

      appendRunStep(this.runId, stepRecord);
      logWorkflowStep(this.workflowName, stepRecord);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Step "${name}" timed out`)),
            this.policy.timeoutMs,
          );
        });

        const result = await Promise.race<T>([
          executor(),
          timeoutPromise,
        ]);

        const completedStep: Partial<WorkflowStepRecord> = {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: options.outputSummary?.(result) ?? summarizeValue(result),
        };

        updateRunStep(this.runId, stepId, completedStep);
        logWorkflowStep(this.workflowName, {
          ...stepRecord,
          ...completedStep,
          status: "completed",
        });

        return result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const failedStep: Partial<WorkflowStepRecord> = {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: message,
        };

        updateRunStep(this.runId, stepId, failedStep);
        logWorkflowStep(this.workflowName, {
          ...stepRecord,
          ...failedStep,
          status: "failed",
        });

        if (attempt > this.policy.maxRetriesPerStep) {
          throw error;
        }
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  complete(): WorkflowRunRecord {
    return completeRun(this.runId);
  }

  fail(error: string): WorkflowRunRecord {
    return failRun(this.runId, error);
  }
}
