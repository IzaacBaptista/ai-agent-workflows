import { getDelegatableAgentNames, isRegisteredAgentName, runDelegatedAgent } from "../agents/agentRegistry";
import { buildRelevantMemoryContext } from "../memory/runMemoryStore";
import { buildWorkingMemory, getWorkingMemorySignature, summarizeWorkingMemory } from "../memory/workingMemory";
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
import {
  buildWorkflowToolSignature,
  executeWorkflowTool,
  getRegisteredToolNames,
  isRegisteredWorkflowTool,
  validateWorkflowToolInput,
} from "../tools/toolExecutor";
import {
  RegisteredAgentName,
  RelevantMemoryContext,
  ReviewerAssessment,
  RuntimeAction,
  RuntimeActionType,
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

interface WorkflowRuntimeOptions {
  workflowName: string;
  input: string;
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
}

interface RuntimeProgressState {
  lastAction?: string;
  lastSignature?: string;
  consecutiveNoProgress: number;
}

interface RuntimeStats {
  toolCallCount: number;
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
  summarizeTriage?: (triage: TTriage) => string;
  summarizeResult?: (result: TResult) => string;
}

const DEFAULT_POLICY: WorkflowExecutionPolicy = {
  maxSteps: 10,
  maxRetriesPerStep: 1,
  timeoutMs: 60_000,
  maxConsecutiveNoProgress: 1,
  maxToolCalls: 4,
  maxRepeatedIdenticalToolCalls: 1,
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

    this.saveArtifact("runtimeStats", {
      toolCallCount: 0,
      delegationCount: 0,
      maxDelegationDepthReached: 0,
      memoryHits: 0,
      criticRedirectCount: 0,
    } satisfies RuntimeStats);
    this.saveArtifact("toolCalls", []);
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
      stepCount: run.steps.length,
      critiqueCount: critiques.length,
      replanCount: replans.length,
      toolCallCount: stats.toolCallCount,
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

    this.appendArtifactArray("validationErrors", {
      kind,
      message,
      signature,
      createdAt: new Date().toISOString(),
    } satisfies WorkflowValidationError);

    return duplicate;
  }

  async executeStep<T>(
    name: string,
    executor: () => Promise<T>,
    options: ExecuteStepOptions = {},
  ): Promise<T> {
    this.stepCount += 1;
    const previousStep = this.getRunRecord().steps[this.getRunRecord().steps.length - 1];
    const isReservedCritiqueStep =
      name === "critique" &&
      previousStep?.name === "finalize" &&
      previousStep.status === "completed";

    if (this.stepCount > this.policy.maxSteps && !isReservedCritiqueStep) {
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

  private async executeToolAction(action: RuntimeAction): Promise<WorkflowToolResult | undefined> {
    if (action.type !== "tool_call") {
      return undefined;
    }

    if (!isRegisteredWorkflowTool(action.toolName)) {
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
      this.forceFinalAnalysis(`Tool call budget exceeded for ${action.toolName}`);
      return undefined;
    }

    const signature = buildWorkflowToolSignature(action.toolName, validatedInput.data);
    const workingMemorySignature = getWorkingMemorySignature(this.getWorkingMemory());
    const previousCalls = (this.getArtifactsValue<WorkflowToolCallRecord[]>("toolCalls") ?? []).filter(
      (record) =>
        record.toolName === action.toolName &&
        record.signature === signature &&
        record.workingMemorySignature === workingMemorySignature,
    );

    if (previousCalls.length > this.policy.maxRepeatedIdenticalToolCalls) {
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
        createdAt: new Date().toISOString(),
      } satisfies WorkflowToolCallRecord);
      this.recordProgress(`tool_call:${action.toolName}`, signature, false);
      return suppressedResult;
    }

    const result = await this.executeStep(
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
      createdAt: new Date().toISOString(),
    } satisfies WorkflowToolCallRecord);

    if (toolName === "search_code") {
      this.saveArtifact("codeSearchResults", result.data);
    } else if (toolName === "read_file") {
      this.saveArtifact("fileReadResults", result.data);
    } else if (toolName === "run_command") {
      this.appendArtifactArray("commandResults", result.data);
    } else {
      this.saveArtifact("externalApiResult", result.data);
    }

    this.recordProgress(`tool_call:${toolName}`, signature, getToolProgress(result));
    return result;
  }

  private async executeDelegationAction(action: RuntimeAction, input: string, depth: number): Promise<unknown> {
    if (action.type !== "delegate") {
      return undefined;
    }

    if (!isRegisteredAgentName(action.targetAgent)) {
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
          async () =>
            definition.runReplanner(
              context,
              memoryContext,
              getRegisteredToolNames(),
              getDelegatableAgentNames(),
            ),
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
      async () =>
        definition.runCritic(
          critiqueContext,
          state.candidateResult as TResult,
          workingMemory,
          memoryContext,
        ),
      {
        agentName: "CriticAgent",
        inputSummary: task,
        outputSummary: (value) => `approved=${(value as WorkflowCritique).approved}`,
        actionType: "critique",
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
      },
    );
    this.saveArtifact("candidateResult", state.candidateResult);
    await this.handleCritique(definition, input, state, action.task);
  }

  async runActionQueue<TTriage, TResult>(
    definition: WorkflowDefinition<TTriage, TResult>,
    input: string,
  ): Promise<TResult> {
    const memoryContext = this.buildMemoryContext(input, "planner");
    const plan = await this.executeStep(
      "plan",
      async () =>
        definition.runPlanner(
          input,
          memoryContext,
          getRegisteredToolNames(),
          getDelegatableAgentNames(),
        ),
      {
        agentName: "PlannerAgent",
        inputSummary: input,
        outputSummary: (value) =>
          `actions=${(value as WorkflowPlan).actions.map((action) => action.type).join(",")}`,
        actionType: "replan",
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

  complete(): WorkflowRunRecord {
    return completeRun(this.runId);
  }

  fail(error: string): WorkflowRunRecord {
    return failRun(this.runId, error);
  }
}
