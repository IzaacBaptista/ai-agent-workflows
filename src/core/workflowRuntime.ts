import { env } from "../config/env";
import { getDelegatableAgentNames, isRegisteredAgentName, runDelegatedAgent } from "../agents/agentRegistry";
import { CoderAgent } from "../agents/coderAgent";
import { buildRelevantMemoryContext } from "../memory/runMemoryStore";
import {
  buildWorkingMemory,
  getCommandDecisionSignature,
  getWorkingMemorySignature,
  summarizeWorkingMemory,
} from "../memory/workingMemory";
import {
  applyCodePatchPlan,
  loadEditableFileContexts,
} from "../tools/editPatchTool";
import { getGitDiffAt, getGitStatusAt } from "../tools/gitTool";
import { createIsolatedWorkspace, IsolatedWorkspace } from "../tools/isolatedWorkspaceTool";
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
import { runAllowedCommand } from "../tools/runCommandTool";
import {
  buildWorkflowToolSignature,
  executeWorkflowTool,
  getRegisteredToolNames,
  isRegisteredWorkflowTool,
  validateWorkflowToolInput,
} from "../tools/toolExecutor";
import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  CodePatchPlan,
  EditableFileContext,
  PatchValidationOutcome,
  RegisteredAgentName,
  RelevantMemoryContext,
  ReviewerAssessment,
  RuntimeAction,
  RuntimeActionType,
  WorkflowCommandName,
  WorkflowCritique,
  WorkflowDelegationRecord,
  WorkflowExecutionMeta,
  WorkflowExecutionPolicy,
  WorkflowPlan,
  WorkflowReplan,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowToolCallRecord,
  WorkflowToolName,
  WorkflowToolResult,
  WorkflowValidationError,
  WorkingMemorySnapshot,
} from "./types";
import { isLlmProviderError } from "./llmClient";

interface WorkflowRuntimeOptions {
  workflowName: string;
  input: string;
  repoRoot?: string;
  policy?: Partial<WorkflowExecutionPolicy>;
}

interface ExecuteStepOptions {
  agentName?: string;
  inputSummary?: string;
  outputSummary?: (value: unknown) => string | undefined;
  actionType?: RuntimeActionType;
  toolName?: string;
  targetAgent?: string;
  delegationDepth?: number;
  signature?: string;
  suppressed?: boolean;
  blocked?: boolean;
  reservedBudgetStep?: boolean;
}

interface RuntimeProgressState {
  lastAction?: string;
  lastSignature?: string;
  consecutiveNoProgress: number;
}

interface RuntimeStats {
  toolCallCount: number;
  editActionCount: number;
  delegationCount: number;
  maxDelegationDepthReached: number;
  memoryHits: number;
  criticRedirectCount: number;
}

export interface WorkflowExecutionState<TTriage, TResult> {
  actionQueue: RuntimeAction[];
  triage?: TTriage;
  candidateResult?: TResult;
  result?: TResult;
  finalContext?: string;
}

export interface WorkflowDefinition<TTriage, TResult> {
  workflowName: string;
  triageAgentName: RegisteredAgentName;
  finalAgentName: RegisteredAgentName;
  runPlanner: (
    input: string,
    memoryContext: RelevantMemoryContext,
    availableTools: WorkflowToolName[],
    delegatableAgents: RegisteredAgentName[],
  ) => Promise<WorkflowPlan>;
  runReplanner: (
    context: string,
    memoryContext: RelevantMemoryContext,
    availableTools: WorkflowToolName[],
    delegatableAgents: RegisteredAgentName[],
  ) => Promise<WorkflowReplan>;
  runCritic: (
    context: string,
    candidateResult: TResult,
    workingMemory: WorkingMemorySnapshot,
    memoryContext: RelevantMemoryContext,
  ) => Promise<WorkflowCritique>;
  runTriage: (task: string, input: string) => Promise<TTriage>;
  runFinal: (task: string, context: string) => Promise<TResult>;
  buildFinalContext: (input: string, runtime: WorkflowRuntime, triage?: TTriage) => string;
  buildCritiqueContext: (
    input: string,
    runtime: WorkflowRuntime,
    candidateResult: TResult,
    finalContext: string,
  ) => string;
  buildReplanContext: (
    input: string,
    completedAction: RuntimeAction,
    runtime: WorkflowRuntime,
    remainingActions: RuntimeAction[],
  ) => string;
  beforeFinalize?: (
    input: string,
    runtime: WorkflowRuntime,
    state: WorkflowExecutionState<TTriage, TResult>,
    action: Extract<RuntimeAction, { type: "finalize" }>,
  ) => { reason: string; recoveryActions: RuntimeAction[] } | null;
  summarizeTriage?: (triage: TTriage) => string;
  summarizeResult?: (result: TResult) => string;
}

const DEFAULT_POLICY: WorkflowExecutionPolicy = {
  maxSteps: 10,
  maxRetriesPerStep: 1,
  timeoutMs: env.STEP_TIMEOUT_MS,
  maxConsecutiveNoProgress: 1,
  maxToolCalls: 4,
  maxRepeatedIdenticalToolCalls: 1,
  maxEditActionsPerRun: 2,
  maxFilesPerEditAction: 3,
  maxDelegationsPerRun: 2,
  maxDelegationDepth: 1,
  maxCriticRedirects: 2,
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

function isObjectWithRecommendedAction(value: unknown): value is ReviewerAssessment {
  return value != null && typeof value === "object" && "supported" in value && "summary" in value;
}

function ensureActionQueueEndsWithFinalize(actions: RuntimeAction[]): RuntimeAction[] {
  const finalAction = actions[actions.length - 1];
  if (!finalAction || finalAction.type !== "finalize") {
    throw new Error('Workflow action queue must end with "finalize"');
  }

  return actions;
}

function getToolProgress(toolResult: WorkflowToolResult): boolean {
  if (toolResult.tool === "search_code") {
    const results = toolResult.data as Record<string, unknown[]>;
    return Object.values(results).some((matches) => matches.length > 0);
  }

  if (toolResult.tool === "read_file") {
    const files = toolResult.data as unknown[];
    return files.length > 0;
  }

  return true;
}

function buildRunCommandSummary(result: CommandExecutionResult): string {
  return `command=${result.command},exitCode=${result.exitCode ?? "null"},timedOut=${result.timedOut}`;
}

function getValidationSeverity(result: CommandExecutionResult): number {
  if (result.timedOut) {
    return 2;
  }

  return result.exitCode === 0 ? 0 : 1;
}

function estimateFailureCount(result: CommandExecutionResult): number | undefined {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const patterns = [
    /(\d+)\s+(?:failing|failed)\b/gi,
    /(\d+)\s+errors?\b/gi,
    /(\d+)\s+tests?\s+failed\b/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(combinedOutput);
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }

  return undefined;
}

function compareValidationResults(
  before: CommandExecutionResult | undefined,
  after: CommandExecutionResult | undefined,
): PatchValidationOutcome {
  if (!before || !after) {
    return "not_run";
  }

  const beforeSeverity = getValidationSeverity(before);
  const afterSeverity = getValidationSeverity(after);

  if (afterSeverity > beforeSeverity) {
    return "regressed";
  }

  if (afterSeverity < beforeSeverity) {
    return "improved";
  }

  const beforeFailures = estimateFailureCount(before);
  const afterFailures = estimateFailureCount(after);
  if (beforeFailures != null && afterFailures != null) {
    if (afterFailures > beforeFailures) {
      return "regressed";
    }

    if (afterFailures < beforeFailures) {
      return "improved";
    }
  }

  return "unchanged";
}

function getUnexpectedChangedFiles(changedFiles: string[], requestedFiles: string[]): string[] {
  const requested = new Set(requestedFiles.map((file) => file.trim()));
  return changedFiles.filter((file) => !requested.has(file.trim()));
}

class WorkflowStepTimeoutError extends Error {
  constructor(stepName: string) {
    super(`Step "${stepName}" timed out`);
    this.name = "WorkflowStepTimeoutError";
  }
}

function shouldRetryStepError(error: unknown): boolean {
  return !isLlmProviderError(error) && !(error instanceof WorkflowStepTimeoutError);
}

export class WorkflowRuntime {
  readonly runId: string;
  readonly workflowName: string;
  readonly repoRoot: string;
  readonly policy: WorkflowExecutionPolicy;
  private stepCount = 0;

  constructor(options: WorkflowRuntimeOptions) {
    this.workflowName = options.workflowName;
    this.runId = createRunId(options.workflowName);
    this.repoRoot = options.repoRoot ?? process.cwd();
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

    this.saveArtifact("repoRoot", this.repoRoot);
    this.saveArtifact("runtimeStats", {
      toolCallCount: 0,
      editActionCount: 0,
      delegationCount: 0,
      maxDelegationDepthReached: 0,
      memoryHits: 0,
      criticRedirectCount: 0,
    } satisfies RuntimeStats);
    this.saveArtifact("toolCalls", []);
    this.saveArtifact("patchResults", []);
    this.saveArtifact("delegations", []);
    this.saveArtifact("validationErrors", []);
    this.saveArtifact("criticRedirects", []);
    this.saveArtifact("memoryContext", []);
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
    const stats = this.getStats();

    return {
      runId: run.runId,
      workflowName: run.workflowName,
      status: run.status,
      repoRoot:
        (typeof run.artifacts.repoRoot === "string" ? run.artifacts.repoRoot : undefined) ??
        this.repoRoot,
      stepCount: run.steps.length,
      critiqueCount: critiques.length,
      replanCount: replans.length,
      toolCallCount: stats.toolCallCount,
      editActionCount: stats.editActionCount,
      delegationCount: stats.delegationCount,
      maxDelegationDepthReached: stats.maxDelegationDepthReached,
      memoryHits: stats.memoryHits,
      criticRedirectCount: stats.criticRedirectCount,
    };
  }

  private getArtifactsValue<T>(key: string): T | undefined {
    return this.getRunRecord().artifacts[key] as T | undefined;
  }

  private appendArtifactArray<T>(key: string, value: T): void {
    const current = this.getArtifactsValue<T[]>(key) ?? [];
    this.saveArtifact(key, [...current, value]);
  }

  private getStats(): RuntimeStats {
    return (
      this.getArtifactsValue<RuntimeStats>("runtimeStats") ?? {
        toolCallCount: 0,
        editActionCount: 0,
        delegationCount: 0,
        maxDelegationDepthReached: 0,
        memoryHits: 0,
        criticRedirectCount: 0,
      }
    );
  }

  private updateStats(updater: (current: RuntimeStats) => RuntimeStats): RuntimeStats {
    const next = updater(this.getStats());
    this.saveArtifact("runtimeStats", next);
    return next;
  }

  private getRemainingStandardSteps(): number {
    return Math.max(this.policy.maxSteps - this.stepCount, 0);
  }

  private hasConvergenceEvidence(): boolean {
    const artifacts = this.getRunRecord().artifacts;
    return Boolean(
      artifacts.codeSearchResults ||
        artifacts.fileReadResults ||
        artifacts.commandResults ||
        artifacts.patchResults ||
        artifacts.gitStatusResult ||
        artifacts.gitDiffResult ||
        artifacts.gitLogResult ||
        artifacts.externalApiResult,
    );
  }

  private shouldForceConvergedFinalize(action: RuntimeAction): boolean {
    if (action.type !== "tool_call") {
      return false;
    }

    if (!["search_code", "read_file", "git_status", "git_diff", "git_log"].includes(action.toolName)) {
      return false;
    }

    return this.getRemainingStandardSteps() <= 1 && this.hasConvergenceEvidence();
  }

  private buildConvergenceGuardReason(action: Extract<RuntimeAction, { type: "tool_call" }>): string {
    return `Convergence guard forced finalization before another ${action.toolName} because step budget is nearly exhausted and evidence is already available.`;
  }

  private registerMemoryContext(stage: string, context: RelevantMemoryContext): RelevantMemoryContext {
    this.appendArtifactArray("memoryContext", {
      stage,
      summary: context.summary,
      memoryHits: context.memoryHits,
      createdAt: new Date().toISOString(),
    });
    this.updateStats((current) => ({
      ...current,
      memoryHits: current.memoryHits + context.memoryHits,
    }));
    return context;
  }

  private buildMemoryContext(query: string, stage: string): RelevantMemoryContext {
    return this.registerMemoryContext(
      stage,
      buildRelevantMemoryContext(this.workflowName, query, this.runId),
    );
  }

  private getWorkingMemory(): WorkingMemorySnapshot {
    const workingMemory = buildWorkingMemory(this.getRunRecord());
    this.saveArtifact("workingMemory", workingMemory);
    return workingMemory;
  }

  private recordValidationError(kind: WorkflowValidationError["kind"], message: string, signature?: string): boolean {
    const current = this.getArtifactsValue<WorkflowValidationError[]>("validationErrors") ?? [];
    const duplicate = current.some(
      (entry) => entry.kind === kind && entry.signature === signature && entry.message === message,
    );

    if (!duplicate) {
      this.appendArtifactArray("validationErrors", {
        kind,
        message,
        signature,
        createdAt: new Date().toISOString(),
      } satisfies WorkflowValidationError);
    }

    return duplicate;
  }

  async executeStep<T>(
    name: string,
    executor: () => Promise<T>,
    options: ExecuteStepOptions = {},
  ): Promise<T> {
    this.stepCount += 1;
    if (this.stepCount > this.policy.maxSteps && !options.reservedBudgetStep) {
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
        actionType: options.actionType,
        toolName: options.toolName,
        targetAgent: options.targetAgent,
        delegationDepth: options.delegationDepth,
        signature: options.signature,
        suppressed: options.suppressed,
        blocked: options.blocked,
      };

      appendRunStep(this.runId, stepRecord);
      logWorkflowStep(this.workflowName, stepRecord);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      try {
        const timeoutPromise = new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new WorkflowStepTimeoutError(name)),
            this.policy.timeoutMs,
          );
        });

        const result = await Promise.race<T>([executor(), timeoutPromise]);

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

        if (attempt > this.policy.maxRetriesPerStep || !shouldRetryStepError(error)) {
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

  private recordBlockedAction(action: RuntimeAction, reason: string, delegationDepth?: number): void {
    this.stepCount += 1;
    const timestamp = new Date().toISOString();
    const stepRecord: WorkflowStepRecord = {
      stepId: `${action.type}:${this.stepCount}:1`,
      name: action.type,
      status: "completed",
      attempt: 1,
      startedAt: timestamp,
      completedAt: timestamp,
      inputSummary:
        action.type === "tool_call" || action.type === "replan"
          ? action.reason
          : action.task,
      outputSummary: `blocked: ${reason}`,
      actionType: action.type,
      toolName: action.type === "tool_call" ? action.toolName : undefined,
      targetAgent: action.type === "delegate" ? action.targetAgent : undefined,
      delegationDepth,
      signature:
        action.type === "tool_call"
          ? `${action.toolName}:${action.reason.trim().toLowerCase()}`
          : `${action.type}:${("task" in action ? action.task : action.reason).trim().toLowerCase()}`,
      blocked: true,
    };

    appendRunStep(this.runId, stepRecord);
    logWorkflowStep(this.workflowName, stepRecord);
  }

  private async executeToolAction(action: RuntimeAction): Promise<WorkflowToolResult | undefined> {
    if (action.type !== "tool_call") {
      return undefined;
    }

    if (!isRegisteredWorkflowTool(action.toolName)) {
      this.recordBlockedAction(action, `Unknown workflow tool "${action.toolName}"`);
      const duplicate = this.recordValidationError(
        "tool",
        `Unknown workflow tool "${action.toolName}"`,
        `tool:${action.toolName}`,
      );
      if (duplicate) {
        throw new Error(`Unknown workflow tool "${action.toolName}"`);
      }
      return undefined;
    }

    const validatedInput = validateWorkflowToolInput(action.toolName, action.input);
    if (!validatedInput.success) {
      this.recordBlockedAction(
        action,
        `Invalid input for tool "${action.toolName}": ${validatedInput.error}`,
      );
      const duplicate = this.recordValidationError(
        "tool",
        `Invalid input for tool "${action.toolName}": ${validatedInput.error}`,
        `tool:${action.toolName}:${JSON.stringify(action.input)}`,
      );
      if (duplicate) {
        throw new Error(`Invalid input for tool "${action.toolName}"`);
      }
      return undefined;
    }

    const toolName = action.toolName;
    const stats = this.getStats();
    if (stats.toolCallCount >= this.policy.maxToolCalls) {
      this.recordBlockedAction(action, `Tool call budget exceeded for ${action.toolName}`);
      this.forceFinalAnalysis(`Tool call budget exceeded for ${action.toolName}`);
      return undefined;
    }

    const signature = buildWorkflowToolSignature(action.toolName, validatedInput.data);
    const workingMemory = this.getWorkingMemory();
    const workingMemorySignature = getWorkingMemorySignature(workingMemory);
    const decisionSignature =
      toolName === "run_command"
        ? getCommandDecisionSignature(workingMemory)
        : workingMemorySignature;
    const previousCalls = (this.getArtifactsValue<WorkflowToolCallRecord[]>("toolCalls") ?? []).filter(
      (record) =>
        record.toolName === action.toolName &&
        record.signature === signature &&
        (toolName === "run_command"
          ? record.decisionSignature === decisionSignature
          : record.workingMemorySignature === workingMemorySignature),
    );

    if (previousCalls.length > this.policy.maxRepeatedIdenticalToolCalls) {
      this.recordBlockedAction(
        action,
        `Repeated identical tool_call exceeded limit for ${action.toolName}`,
      );
      this.forceFinalAnalysis(`Repeated identical tool_call exceeded limit for ${action.toolName}`);
      return undefined;
    }

    if (previousCalls.length === this.policy.maxRepeatedIdenticalToolCalls) {
      const previousResult = previousCalls.slice(-1)[0]?.result;
      if (!previousResult) {
        this.forceFinalAnalysis(`Repeated identical tool_call exceeded limit for ${action.toolName}`);
        return undefined;
      }

      const suppressedResult = await this.executeStep(
        "tool_call",
        async () => ({
          ...previousResult,
          cached: true,
          suppressed: true,
        }),
        {
          inputSummary: action.reason,
          outputSummary: (value) => (value as WorkflowToolResult).summary,
          actionType: "tool_call",
          toolName: action.toolName,
          signature,
          suppressed: true,
        },
      );

      this.appendArtifactArray("toolCalls", {
        toolName: action.toolName,
        signature,
        request: validatedInput.data,
        result: suppressedResult,
        suppressed: true,
        cached: true,
        workingMemorySignature,
        decisionSignature,
        createdAt: new Date().toISOString(),
      } satisfies WorkflowToolCallRecord);
      this.recordProgress(`tool_call:${action.toolName}`, signature, false);
      return suppressedResult;
    }

    let result: WorkflowToolResult;
    try {
      result = await this.executeStep(
        "tool_call",
        async () =>
          executeWorkflowTool({
            toolName,
            input: validatedInput.data,
          }),
        {
          inputSummary: action.reason,
          outputSummary: (value) => (value as WorkflowToolResult).summary,
          actionType: "tool_call",
          toolName,
          signature,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duplicate = this.recordValidationError(
        "tool",
        `Tool "${toolName}" failed: ${message}`,
        `${signature}:execution`,
      );
      if (duplicate) {
        this.forceFinalAnalysis(`Repeated tool failure for "${toolName}"`);
      }
      return undefined;
    }

    this.updateStats((current) => ({
      ...current,
      toolCallCount: current.toolCallCount + 1,
    }));
    this.appendArtifactArray("toolCalls", {
      toolName,
      signature,
      request: validatedInput.data,
      result,
      suppressed: false,
      cached: false,
      workingMemorySignature,
      decisionSignature,
      createdAt: new Date().toISOString(),
    } satisfies WorkflowToolCallRecord);

    if (toolName === "search_code") {
      this.saveArtifact("codeSearchResults", result.data);
    } else if (toolName === "read_file") {
      this.saveArtifact("fileReadResults", result.data);
    } else if (toolName === "run_command") {
      this.appendArtifactArray("commandResults", result.data);
    } else if (toolName === "git_status") {
      this.saveArtifact("gitStatusResult", result.data);
    } else if (toolName === "git_diff") {
      this.saveArtifact("gitDiffResult", result.data);
    } else if (toolName === "git_log") {
      this.saveArtifact("gitLogResult", result.data);
    } else {
      this.saveArtifact("externalApiResult", result.data);
    }

    this.recordProgress(`tool_call:${toolName}`, signature, getToolProgress(result));
    return result;
  }

  private buildEditPatchSignature(action: { task: string; files: string[] }, workingMemorySignature: string): string {
    const normalizedFiles = [...action.files]
      .map((file) => file.trim().toLowerCase())
      .sort()
      .join("|");

    return `edit_patch:${action.task.trim().toLowerCase()}:${normalizedFiles}:${workingMemorySignature}`;
  }

  private buildCoderPrompt(
    input: string,
    action: Extract<RuntimeAction, { type: "edit_patch" }>,
    workingMemory: WorkingMemorySnapshot,
    memoryContext: RelevantMemoryContext,
    editableFiles: EditableFileContext[],
  ): string {
    return [
      `Workflow: ${this.workflowName}`,
      "",
      "Original input:",
      input,
      "",
      "Patch task:",
      action.task,
      "",
      "Patch reason:",
      action.reason,
      "",
      "Editable files:",
      ...editableFiles.map((file) => [
        `Path: ${file.path}`,
        `Exists: ${file.exists ? "yes" : "no"}`,
        "Content:",
        file.content || "",
      ].join("\n")),
      "",
      "Working memory:",
      summarizeWorkingMemory(workingMemory),
      "",
      memoryContext.summary,
      "",
      "Current evidence summary:",
      `- Validation errors: ${workingMemory.validationErrors.slice(-3).map((entry) => entry.message).join(" | ") || "none"}`,
      `- Tool calls: ${workingMemory.toolCalls.slice(-4).map((call) => `${call.toolName}:${call.suppressed ? "suppressed" : "executed"}`).join(", ") || "none"}`,
      `- Evidence: ${workingMemory.evidence.join(", ") || "none"}`,
      `- Command signals: ${workingMemory.commandSignals.join(", ") || "none"}`,
      `- Patch signals: ${workingMemory.patchSignals.join(", ") || "none"}`,
    ].join("\n");
  }

  private async executePatchValidationCommand(
    command: WorkflowCommandName,
    reason: string,
    cwd: string,
    signatureSuffix: string,
  ): Promise<CommandExecutionResult> {
    const signature = buildWorkflowToolSignature("run_command", { command });
    const result = await this.executeStep(
      "tool_call",
      async () => runAllowedCommand(command, { cwd }),
      {
        inputSummary: reason,
        outputSummary: (value) => buildRunCommandSummary(value as CommandExecutionResult),
        actionType: "tool_call",
        toolName: "run_command",
        signature: `${signature}:${signatureSuffix}`,
      },
    );

    const workingMemory = this.getWorkingMemory();
    const workingMemorySignature = getWorkingMemorySignature(workingMemory);
    const decisionSignature = getCommandDecisionSignature(workingMemory);

    this.updateStats((current) => ({
      ...current,
      toolCallCount: current.toolCallCount + 1,
    }));
    this.appendArtifactArray("commandResults", result);
    this.appendArtifactArray("toolCalls", {
      toolName: "run_command",
      signature,
      request: { command },
      result: {
        tool: "run_command",
        summary: buildRunCommandSummary(result),
        data: result,
        signature,
      },
      suppressed: false,
      cached: false,
      workingMemorySignature,
      decisionSignature,
      createdAt: new Date().toISOString(),
    } satisfies WorkflowToolCallRecord);

    return result;
  }

  private async executeEditPatchAction(
    action: RuntimeAction,
    input: string,
  ): Promise<AppliedCodePatchResult | undefined> {
    if (action.type !== "edit_patch") {
      return undefined;
    }

    if (action.files.length > this.policy.maxFilesPerEditAction) {
      this.recordBlockedAction(
        action,
        `edit_patch requested too many files (${action.files.length})`,
      );
      const duplicate = this.recordValidationError(
        "edit_patch",
        `edit_patch requested too many files (${action.files.length})`,
        `edit_patch:files:${action.files.join("|")}`,
      );
      if (duplicate) {
        throw new Error("edit_patch requested too many files");
      }
      return undefined;
    }

    const stats = this.getStats();
    if (stats.editActionCount >= this.policy.maxEditActionsPerRun) {
      this.recordBlockedAction(action, "Edit patch budget exceeded");
      this.forceFinalAnalysis("Edit patch budget exceeded");
      return undefined;
    }

    const workingMemory = this.getWorkingMemory();
    const workingMemorySignature = getWorkingMemorySignature(workingMemory);
    const signature = this.buildEditPatchSignature(action, workingMemorySignature);
    const memoryContext = this.buildMemoryContext(
      `${input}\n${action.task}\n${action.files.join("\n")}`,
      "edit_patch",
    );
    let isolatedWorkspace: IsolatedWorkspace;
    let patchPlan: CodePatchPlan | undefined;

    try {
      isolatedWorkspace = await createIsolatedWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordBlockedAction(action, message);
      const duplicate = this.recordValidationError("edit_patch", message, `${signature}:worktree`);
      if (duplicate) {
        throw error instanceof Error ? error : new Error(message);
      }
      return undefined;
    }

    let appliedPatch: AppliedCodePatchResult | undefined;
    let cleanupError: string | undefined;

    try {
      const editableFiles = loadEditableFileContexts(action.files, isolatedWorkspace.path);

      patchPlan = await this.executeStep(
        "edit_patch",
        async () => {
          const coder = new CoderAgent();

          try {
            return await coder.run(
              this.buildCoderPrompt(input, action, workingMemory, memoryContext, editableFiles),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.recordValidationError("edit_patch", message, signature);
            throw error;
          }
        },
        {
          agentName: "CoderAgent",
          inputSummary: action.task,
          outputSummary: (value) =>
            `edits=${(value as CodePatchPlan).edits.length},validation=${(value as CodePatchPlan).validationCommand ?? "none"}`,
          actionType: "edit_patch",
          signature,
        },
      );
      const resolvedPatchPlan = patchPlan;

      let validationBefore: CommandExecutionResult | undefined;
      if (resolvedPatchPlan.validationCommand) {
        try {
          validationBefore = await runAllowedCommand(resolvedPatchPlan.validationCommand, {
            cwd: isolatedWorkspace.path,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const duplicate = this.recordValidationError(
            "edit_patch",
            `Pre-patch validation failed: ${message}`,
            `${signature}:validation-before`,
          );
          if (duplicate) {
            throw error instanceof Error ? error : new Error(message);
          }
          return undefined;
        }
      }

      let basePatchResult: AppliedCodePatchResult;
      try {
        basePatchResult = applyCodePatchPlan(resolvedPatchPlan, action.files, isolatedWorkspace.path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const duplicate = this.recordValidationError("edit_patch", message, signature);
        if (duplicate) {
          throw error instanceof Error ? error : new Error(message);
        }
        return undefined;
      }

      let validationAfter: CommandExecutionResult | undefined;
      if (basePatchResult.validationCommand) {
        try {
          validationAfter = await this.executePatchValidationCommand(
            basePatchResult.validationCommand,
            `Validate isolated patch for "${action.task}"`,
            isolatedWorkspace.path,
            `patch:${signature}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const duplicate = this.recordValidationError(
            "edit_patch",
            `Post-patch validation failed: ${message}`,
            `${signature}:validation-after`,
          );
          if (duplicate) {
            throw error instanceof Error ? error : new Error(message);
          }
          return undefined;
        }
      }

      let gitStatus;
      let gitDiff;
      try {
        gitStatus = await getGitStatusAt(isolatedWorkspace.path);
        gitDiff = await getGitDiffAt(isolatedWorkspace.path, false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const duplicate = this.recordValidationError(
          "edit_patch",
          `Patch diff collection failed: ${message}`,
          `${signature}:git`,
        );
        if (duplicate) {
          throw error instanceof Error ? error : new Error(message);
        }
        return undefined;
      }

      const changedFiles = Array.from(
        new Set([
          ...gitDiff.changedFiles,
          ...gitStatus.entries.map((entry) => entry.path),
        ]),
      );

      appliedPatch = {
        ...basePatchResult,
        validationBefore,
        validationAfter,
        validationOutcome: compareValidationResults(validationBefore, validationAfter),
        gitStatus,
        gitDiff,
        unexpectedChangedFiles: getUnexpectedChangedFiles(changedFiles, action.files),
        isolationMode: "isolated_worktree",
        worktreeCleanedUp: true,
      };
    } finally {
      try {
        await isolatedWorkspace.cleanup();
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!appliedPatch) {
      if (cleanupError) {
        this.recordValidationError("edit_patch", cleanupError, `${signature}:cleanup`);
      }
      return undefined;
    }

    if (cleanupError) {
      appliedPatch.worktreeCleanedUp = false;
      this.recordValidationError("edit_patch", cleanupError, `${signature}:cleanup`);
    }

    this.updateStats((current) => ({
      ...current,
      editActionCount: current.editActionCount + 1,
    }));
    this.appendArtifactArray("patchResults", appliedPatch);
    if (patchPlan) {
      this.saveArtifact("latestPatchPlan", patchPlan);
    }
    this.recordProgress(
      "edit_patch",
      signature,
      appliedPatch.edits.length > 0 &&
        appliedPatch.validationOutcome !== "regressed" &&
        appliedPatch.unexpectedChangedFiles.length === 0,
    );

    return appliedPatch;
  }

  private async executeDelegationAction(action: RuntimeAction, input: string, depth: number): Promise<unknown> {
    if (action.type !== "delegate") {
      return undefined;
    }

    if (!isRegisteredAgentName(action.targetAgent)) {
      this.recordBlockedAction(action, `Unknown target agent "${action.targetAgent}"`, depth);
      const duplicate = this.recordValidationError(
        "delegate",
        `Unknown target agent "${action.targetAgent}"`,
        `delegate:${action.targetAgent}`,
      );
      if (duplicate) {
        throw new Error(`Unknown target agent "${action.targetAgent}"`);
      }
      return undefined;
    }

    const targetAgent = action.targetAgent;
    if (depth > this.policy.maxDelegationDepth) {
      this.recordBlockedAction(
        action,
        `Delegation depth exceeded for "${action.targetAgent}"`,
        depth,
      );
      const duplicate = this.recordValidationError(
        "delegate",
        `Delegation depth exceeded for "${action.targetAgent}"`,
        `delegate-depth:${action.targetAgent}:${depth}`,
      );
      if (duplicate) {
        throw new Error(`Delegation depth exceeded for "${action.targetAgent}"`);
      }
      return undefined;
    }

    const stats = this.getStats();
    if (stats.delegationCount >= this.policy.maxDelegationsPerRun) {
      this.recordBlockedAction(action, `Delegation budget exceeded for ${action.targetAgent}`, depth);
      this.forceFinalAnalysis(`Delegation budget exceeded for ${action.targetAgent}`);
      return undefined;
    }

    const workingMemory = this.getWorkingMemory();
    const delegatedInput = [
      `Workflow: ${this.workflowName}`,
      `Target agent: ${action.targetAgent}`,
      `Delegation depth: ${depth}`,
      "",
      "Task:",
      action.task,
      "",
      "Reason:",
      action.reason,
      "",
      "Original input:",
      input,
      "",
      "Working memory:",
      summarizeWorkingMemory(workingMemory),
      "",
      "Artifacts:",
      JSON.stringify(this.getRunRecord().artifacts),
    ].join("\n");

    const result = await this.executeStep(
      "delegate",
      async () => runDelegatedAgent(targetAgent, delegatedInput),
      {
        agentName: targetAgent,
        inputSummary: action.task,
        outputSummary: summarizeValue,
        actionType: "delegate",
        targetAgent,
        delegationDepth: depth,
        signature: `${targetAgent}:${action.task.trim().toLowerCase()}`,
      },
    );

    this.updateStats((current) => ({
      ...current,
      delegationCount: current.delegationCount + 1,
      maxDelegationDepthReached: Math.max(current.maxDelegationDepthReached, depth),
    }));
    this.appendArtifactArray("delegations", {
      targetAgent,
      task: action.task,
      reason: action.reason,
      depth,
      output: result,
      createdAt: new Date().toISOString(),
    } satisfies WorkflowDelegationRecord);

    if (targetAgent === "ReviewerAgent" && isObjectWithRecommendedAction(result)) {
      this.saveArtifact("reviewerAssessment", result);
    }

    this.recordProgress(
      `delegate:${targetAgent}`,
      `${targetAgent}:${action.task.trim().toLowerCase()}`,
      true,
    );
    return result;
  }

  private async runReplan<TTriage, TResult>(
    definition: WorkflowDefinition<TTriage, TResult>,
    input: string,
    completedAction: RuntimeAction,
    remainingActions: RuntimeAction[],
  ): Promise<RuntimeAction[]> {
    const context = definition.buildReplanContext(input, completedAction, this, remainingActions);
    const memoryContext = this.buildMemoryContext(`${input}\n${context}`, "replan");
    const replan = ensureActionQueueEndsWithFinalize(
      (
        await this.executeStep(
          "replan",
          async () => {
            try {
              return await definition.runReplanner(
                context,
                memoryContext,
                getRegisteredToolNames(),
                getDelegatableAgentNames(),
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.recordValidationError("replanner", message, "replanner");
              throw error;
            }
          },
          {
            agentName: "ReplannerAgent",
            inputSummary: context,
            outputSummary: (value) =>
              `actions=${(value as WorkflowReplan).actions.map((action) => action.type).join(",")}`,
            actionType: "replan",
          },
        )
      ).actions,
    );

    this.saveReplan({ summary: "replanned", actions: replan });
    return replan;
  }

  private async handleCritique<TTriage, TResult>(
    definition: WorkflowDefinition<TTriage, TResult>,
    input: string,
    state: WorkflowExecutionState<TTriage, TResult>,
    task: string,
    reservedBudgetStep = false,
  ): Promise<void> {
    if (!state.candidateResult || !state.finalContext) {
      throw new Error('Cannot critique before producing a candidate result via "finalize"');
    }

    const critiqueContext = definition.buildCritiqueContext(
      input,
      this,
      state.candidateResult,
      state.finalContext,
    );
    const workingMemory = this.getWorkingMemory();
    const memoryContext = this.buildMemoryContext(`${input}\n${critiqueContext}`, "critic");

    const critique = await this.executeStep(
      "critique",
      async () => {
        try {
          return await definition.runCritic(
            critiqueContext,
            state.candidateResult as TResult,
            workingMemory,
            memoryContext,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.recordValidationError("critic", message, "critic");
          throw error;
        }
      },
      {
        agentName: "CriticAgent",
        inputSummary: task,
        outputSummary: (value) => `approved=${(value as WorkflowCritique).approved}`,
        actionType: "critique",
        reservedBudgetStep,
      },
    );

    this.saveCritique(critique);

    if (critique.approved) {
      state.result = state.candidateResult;
      this.saveArtifact("result", state.result);
      return;
    }

    const stats = this.getStats();
    if (stats.criticRedirectCount >= this.policy.maxCriticRedirects) {
      this.forceFinalAnalysis(`Critic redirect limit reached: ${critique.summary}`);
      state.result = state.candidateResult;
      this.saveArtifact("result", state.result);
      return;
    }

    this.updateStats((current) => ({
      ...current,
      criticRedirectCount: current.criticRedirectCount + 1,
    }));
    this.appendArtifactArray("criticRedirects", {
      summary: critique.summary,
      nextAction: critique.nextAction,
      createdAt: new Date().toISOString(),
    });

    state.candidateResult = undefined;
    state.actionQueue = critique.nextAction
      ? [critique.nextAction, ...state.actionQueue]
      : [{ type: "replan", reason: critique.summary }, ...state.actionQueue];
  }

  async executeAction<TTriage, TResult>(
    action: RuntimeAction,
    definition: WorkflowDefinition<TTriage, TResult>,
    state: WorkflowExecutionState<TTriage, TResult>,
    input: string,
    delegationDepth = 0,
  ): Promise<void> {
    if (this.getArtifactsValue<string>("forcedFinalAnalysisReason") && action.type !== "finalize") {
      state.actionQueue = [
        {
          type: "finalize",
          task: `Forced final analysis because ${this.getArtifactsValue<string>("forcedFinalAnalysisReason")}`,
          reason: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
        },
      ];
      return;
    }

    if (action.type === "finalize") {
      const finalizeGuard = definition.beforeFinalize?.(input, this, state, action);
      if (finalizeGuard) {
        this.recordBlockedAction(action, finalizeGuard.reason);
        state.actionQueue = ensureActionQueueEndsWithFinalize([...finalizeGuard.recoveryActions]);
        return;
      }
    }

    if (action.type === "analyze") {
      if (action.stage === "triage") {
        const triage = await this.executeStep(
          "analyze",
          async () => definition.runTriage(action.task, input),
          {
            agentName: definition.triageAgentName,
            inputSummary: action.task,
            outputSummary: (value) =>
              definition.summarizeTriage?.(value as TTriage) ?? summarizeValue(value),
            actionType: "analyze",
            signature: `triage:${action.task.trim().toLowerCase()}`,
          },
        );

        state.triage = triage;
        this.saveArtifact("triage", triage);
        const nextActions = await this.runReplan(definition, input, action, state.actionQueue);
        state.actionQueue = nextActions;
        return;
      }

      const finalContext = [
        definition.buildFinalContext(input, this, state.triage),
        "",
        "Focused analysis task:",
        action.task,
      ].join("\n");
      state.finalContext = finalContext;
      this.saveArtifact("context", finalContext);
      state.candidateResult = await this.executeStep(
        "analyze",
        async () => definition.runFinal(action.task, finalContext),
        {
          agentName: definition.finalAgentName,
          inputSummary: action.task,
          outputSummary: (value) =>
            definition.summarizeResult?.(value as TResult) ?? summarizeValue(value),
          actionType: "analyze",
          signature: `analysis:${action.task.trim().toLowerCase()}`,
        },
      );
      this.saveArtifact("candidateResult", state.candidateResult);
      const nextActions = await this.runReplan(definition, input, action, state.actionQueue);
      state.actionQueue = nextActions;
      return;
    }

    if (action.type === "tool_call") {
      if (this.shouldForceConvergedFinalize(action)) {
        const reason = this.buildConvergenceGuardReason(action);
        this.recordBlockedAction(action, reason);
        this.forceFinalAnalysis(reason);
        state.actionQueue = [
          {
            type: "finalize",
            task: reason,
            reason,
          },
        ];
        return;
      }

      const toolResult = await this.executeToolAction(action);
      if (!toolResult) {
        if (this.getArtifactsValue<string>("forcedFinalAnalysisReason")) {
          state.actionQueue = [
            {
              type: "finalize",
              task: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
              reason: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
            },
          ];
          return;
        }
        state.actionQueue = [{ type: "replan", reason: `Recover from tool call "${action.toolName}"` }];
        return;
      }

      if (this.shouldForceFinalAnalysis()) {
        this.forceFinalAnalysis(`No progress after tool_call "${action.toolName}"`);
        state.actionQueue = [
          {
            type: "finalize",
            task: `Forced final analysis after tool_call "${action.toolName}"`,
            reason: `No progress after tool_call "${action.toolName}"`,
          },
        ];
        return;
      }

      const nextActions = await this.runReplan(definition, input, action, state.actionQueue);
      state.actionQueue = nextActions;
      return;
    }

    if (action.type === "edit_patch") {
      const patchResult = await this.executeEditPatchAction(action, input);
      if (!patchResult) {
        if (this.getArtifactsValue<string>("forcedFinalAnalysisReason")) {
          state.actionQueue = [
            {
              type: "finalize",
              task: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
              reason: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
            },
          ];
          return;
        }

        state.actionQueue = [{ type: "replan", reason: `Recover from edit_patch "${action.task}"` }];
        return;
      }

      if (this.getArtifactsValue<string>("forcedFinalAnalysisReason")) {
        state.actionQueue = [
          {
            type: "finalize",
            task: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
            reason: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
          },
        ];
        return;
      }

      const patchHasRegressionSignals =
        patchResult.validationOutcome === "regressed" ||
        patchResult.unexpectedChangedFiles.length > 0 ||
        patchResult.worktreeCleanedUp === false;

      if (!patchHasRegressionSignals && this.shouldForceFinalAnalysis()) {
        this.forceFinalAnalysis(`No progress after edit_patch "${action.task}"`);
        state.actionQueue = [
          {
            type: "finalize",
            task: `Forced final analysis after edit_patch "${action.task}"`,
            reason: `No progress after edit_patch "${action.task}"`,
          },
        ];
        return;
      }

      const nextActions = await this.runReplan(definition, input, action, state.actionQueue);
      state.actionQueue = nextActions;
      return;
    }

    if (action.type === "delegate") {
      const result = await this.executeDelegationAction(action, input, delegationDepth + 1);
      if (!result) {
        if (this.getArtifactsValue<string>("forcedFinalAnalysisReason")) {
          state.actionQueue = [
            {
              type: "finalize",
              task: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
              reason: this.getArtifactsValue<string>("forcedFinalAnalysisReason") ?? "forced finalization",
            },
          ];
          return;
        }
        state.actionQueue = [{ type: "replan", reason: `Recover from delegation to "${action.targetAgent}"` }];
        return;
      }

      const nextActions = await this.runReplan(definition, input, action, state.actionQueue);
      state.actionQueue = nextActions;
      return;
    }

    if (action.type === "replan") {
      state.actionQueue = await this.runReplan(definition, input, action, state.actionQueue);
      return;
    }

    if (action.type === "critique") {
      await this.handleCritique(definition, input, state, action.task);
      return;
    }

    const isTerminalFinalize = state.actionQueue.length === 0 && !state.result;
    state.finalContext = [
      definition.buildFinalContext(input, this, state.triage),
      "",
      "Final task:",
      action.task,
    ].join("\n");
    this.saveArtifact("context", state.finalContext);
    state.candidateResult = await this.executeStep(
      "finalize",
      async () => definition.runFinal(action.task, state.finalContext as string),
      {
        agentName: definition.finalAgentName,
        inputSummary: action.task,
        outputSummary: (value) =>
          definition.summarizeResult?.(value as TResult) ?? summarizeValue(value),
        actionType: "finalize",
        signature: `finalize:${action.task.trim().toLowerCase()}`,
        reservedBudgetStep: isTerminalFinalize,
      },
    );
    this.saveArtifact("candidateResult", state.candidateResult);
    await this.handleCritique(definition, input, state, action.task, isTerminalFinalize);
  }

  async runActionQueue<TTriage, TResult>(
    definition: WorkflowDefinition<TTriage, TResult>,
    input: string,
  ): Promise<TResult> {
    const memoryContext = this.buildMemoryContext(input, "planner");
    const plan = await this.executeStep(
      "plan",
      async () => {
        try {
          return await definition.runPlanner(
            input,
            memoryContext,
            getRegisteredToolNames(),
            getDelegatableAgentNames(),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.recordValidationError("planner", message, "planner");
          throw error;
        }
      },
      {
        agentName: "PlannerAgent",
        inputSummary: input,
        outputSummary: (value) =>
          `actions=${(value as WorkflowPlan).actions.map((action) => action.type).join(",")}`,
        actionType: "plan",
      },
    );

    const normalizedPlan: WorkflowPlan = {
      summary: plan.summary,
      actions: ensureActionQueueEndsWithFinalize(plan.actions),
    };
    this.savePlan(normalizedPlan);

    const state: WorkflowExecutionState<TTriage, TResult> = {
      actionQueue: [...normalizedPlan.actions],
    };

    while (state.actionQueue.length > 0 && !state.result) {
      const nextAction = state.actionQueue.shift();
      if (!nextAction) {
        break;
      }

      await this.executeAction(nextAction, definition, state, input);
    }

    if (!state.result) {
      throw new Error('Workflow action queue did not produce a finalized result');
    }

    return state.result;
  }

  async runSimple<TTriage, TResult>(
    definition: WorkflowDefinition<TTriage, TResult>,
    input: string,
    task: string,
    collectContext?: (triage: TTriage, runtime: WorkflowRuntime) => Promise<void>,
  ): Promise<TResult> {
    const triage = await this.executeStep(
      "analyze",
      () => definition.runTriage(task, input),
      {
        agentName: definition.triageAgentName,
        inputSummary: task,
        outputSummary: (value) =>
          definition.summarizeTriage?.(value as TTriage) ?? summarizeValue(value),
        actionType: "analyze",
        signature: `triage:${task.trim().toLowerCase()}`,
      },
    );
    this.saveArtifact("triage", triage);

    if (collectContext) {
      await collectContext(triage, this);
    }

    const finalContext = [
      definition.buildFinalContext(input, this, triage),
      "",
      "Final task:",
      task,
    ].join("\n");
    this.saveArtifact("context", finalContext);

    const result = await this.executeStep(
      "finalize",
      () => definition.runFinal(task, finalContext),
      {
        agentName: definition.finalAgentName,
        inputSummary: task,
        outputSummary: (value) =>
          definition.summarizeResult?.(value as TResult) ?? summarizeValue(value),
        actionType: "finalize",
        signature: `finalize:${task.trim().toLowerCase()}`,
        reservedBudgetStep: true,
      },
    );
    this.saveArtifact("result", result);

    return result;
  }

  complete(): WorkflowRunRecord {
    return completeRun(this.runId);
  }

  fail(error: string): WorkflowRunRecord {
    return failRun(this.runId, error);
  }
}
