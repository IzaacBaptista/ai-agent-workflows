export type WorkflowRunStatus = "running" | "completed" | "failed";
export type WorkflowStepStatus = "running" | "completed" | "failed";
export type WorkflowToolName = "search_code" | "read_file" | "call_external_api";
export type RegisteredAgentName =
  | "PlannerAgent"
  | "ReplannerAgent"
  | "CriticAgent"
  | "ReviewerAgent"
  | "IssueTriageAgent"
  | "BugTriageAgent"
  | "PRTriageAgent"
  | "IssueAgent"
  | "BugAgent"
  | "PRAgent";
export type RuntimeActionType =
  | "analyze"
  | "tool_call"
  | "delegate"
  | "critique"
  | "replan"
  | "finalize";
export type RuntimeAnalysisStage = "triage" | "analysis";

export interface AnalyzeRuntimeAction {
  type: "analyze";
  stage: RuntimeAnalysisStage;
  task: string;
  reason: string;
}

export interface ToolCallRuntimeAction {
  type: "tool_call";
  toolName: WorkflowToolName | string;
  input: unknown;
  reason: string;
}

export interface DelegateRuntimeAction {
  type: "delegate";
  targetAgent: RegisteredAgentName | string;
  task: string;
  reason: string;
}

export interface CritiqueRuntimeAction {
  type: "critique";
  task: string;
  reason: string;
}

export interface ReplanRuntimeAction {
  type: "replan";
  reason: string;
}

export interface FinalizeRuntimeAction {
  type: "finalize";
  task: string;
  reason: string;
}

export type RuntimeAction =
  | AnalyzeRuntimeAction
  | ToolCallRuntimeAction
  | DelegateRuntimeAction
  | CritiqueRuntimeAction
  | ReplanRuntimeAction
  | FinalizeRuntimeAction;

export interface WorkflowExecutionPolicy {
  maxSteps: number;
  maxRetriesPerStep: number;
  timeoutMs: number;
  maxConsecutiveNoProgress: number;
  maxToolCalls: number;
  maxRepeatedIdenticalToolCalls: number;
  maxDelegationsPerRun: number;
  maxDelegationDepth: number;
  maxCriticRedirects: number;
}

export interface WorkflowStepRecord {
  stepId: string;
  name: string;
  status: WorkflowStepStatus;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
  agentName?: string;
  inputSummary?: string;
  outputSummary?: string;
  actionType?: RuntimeActionType;
  toolName?: string;
  targetAgent?: string;
  delegationDepth?: number;
  signature?: string;
  suppressed?: boolean;
}

export interface WorkflowRunRecord {
  runId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  input: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  policy: WorkflowExecutionPolicy;
  steps: WorkflowStepRecord[];
  artifacts: Record<string, unknown>;
}

export interface WorkflowExecutionMeta {
  runId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  stepCount: number;
  critiqueCount: number;
  replanCount: number;
  toolCallCount: number;
  delegationCount: number;
  maxDelegationDepthReached: number;
  memoryHits: number;
  criticRedirectCount: number;
  githubComment?: {
    posted: boolean;
    error?: string;
  };
}

export type WorkflowResult<T> =
  | { success: true; data: T; meta: WorkflowExecutionMeta }
  | { success: false; error: string; meta: WorkflowExecutionMeta };

export interface WorkflowPlan {
  summary: string;
  actions: RuntimeAction[];
}

export interface WorkflowReplan {
  summary: string;
  actions: RuntimeAction[];
}

export interface WorkflowCritique {
  approved: boolean;
  summary: string;
  missingEvidence: string[];
  confidence: "low" | "medium" | "high";
  nextAction?: RuntimeAction;
}

export interface ReviewerAssessment {
  supported: boolean;
  summary: string;
  missingEvidence: string[];
  recommendedAction?: RuntimeAction;
}

export interface WorkflowToolRequest {
  toolName: WorkflowToolName;
  input: unknown;
}

export interface WorkflowToolResult {
  tool: WorkflowToolName;
  summary: string;
  data: unknown;
  signature: string;
  cached?: boolean;
  suppressed?: boolean;
}

export interface WorkflowToolCallRecord {
  toolName: string;
  signature: string;
  request: unknown;
  result?: WorkflowToolResult;
  suppressed: boolean;
  cached: boolean;
  workingMemorySignature: string;
  createdAt: string;
}

export interface WorkflowDelegationRecord {
  targetAgent: string;
  task: string;
  reason: string;
  depth: number;
  output: unknown;
  createdAt: string;
}

export interface WorkflowValidationError {
  kind: "tool" | "delegate" | "planner" | "replanner" | "critic";
  message: string;
  signature?: string;
  createdAt: string;
}

export interface WorkingMemorySnapshot {
  workflowName: string;
  triage?: unknown;
  lastCritique?: WorkflowCritique;
  toolCalls: WorkflowToolCallRecord[];
  delegations: WorkflowDelegationRecord[];
  forcedFinalizationReason?: string;
  validationErrors: WorkflowValidationError[];
  evidence: string[];
}

export interface RelevantMemoryContext {
  summary: string;
  runs: WorkflowRunRecord[];
  failurePatterns: string[];
  critiquePatterns: string[];
  toolLoopPatterns: string[];
  memoryHits: number;
}

export interface IssueAnalysis {
  summary: string;
  questions: string[];
  acceptanceCriteria: string[];
  technicalPlan: string[];
  testScenarios: string[];
  risks: string[];
  assumptions: string[];
}

export interface IssueTriage {
  summary: string;
  investigationAreas: string[];
  codeSearchTerms: string[];
  validationChecks: string[];
}

export interface BugAnalysis {
  summary: string;
  possibleCauses: string[];
  investigationSteps: string[];
  fixSuggestions: string[];
  risks: string[];
}

export interface BugTriage {
  summary: string;
  hypotheses: string[];
  codeSearchTerms: string[];
  apiChecks: string[];
}

export interface PRReview {
  summary: string;
  impacts: string[];
  risks: string[];
  suggestions: string[];
  testRecommendations: string[];
}

export interface PRTriage {
  summary: string;
  reviewFocus: string[];
  codeSearchTerms: string[];
  regressionChecks: string[];
}
