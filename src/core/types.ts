export type WorkflowRunStatus = "running" | "completed" | "failed";
export type WorkflowStepStatus = "running" | "completed" | "failed";
export const WORKFLOW_TOOL_NAMES = [
  "search_code",
  "read_file",
  "call_external_api",
  "run_command",
  "git_status",
  "git_diff",
  "git_log",
] as const;
export type WorkflowToolName = typeof WORKFLOW_TOOL_NAMES[number];
export type WorkflowCommandName = "build" | "test" | "lint";
export const REGISTERED_AGENT_NAMES = [
  "PlannerAgent",
  "ReplannerAgent",
  "CriticAgent",
  "ReviewerAgent",
  "IssueTriageAgent",
  "BugTriageAgent",
  "PRTriageAgent",
  "IssueAgent",
  "BugAgent",
  "PRAgent",
  "JiraAnalyzeAgent",
  "PRCreateAgent",
  "RepoInvestigateAgent",
] as const;
export type RegisteredAgentName = typeof REGISTERED_AGENT_NAMES[number];
export type RuntimeActionType =
  | "plan"
  | "analyze"
  | "edit_patch"
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

export interface EditPatchRuntimeAction {
  type: "edit_patch";
  task: string;
  files: string[];
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
  | EditPatchRuntimeAction
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
  maxEditActionsPerRun: number;
  maxFilesPerEditAction: number;
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
  blocked?: boolean;
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
  editActionCount: number;
  delegationCount: number;
  maxDelegationDepthReached: number;
  memoryHits: number;
  criticRedirectCount: number;
  jiraIssueKey?: string;
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

export interface CommandExecutionResult {
  command: WorkflowCommandName;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  signal?: NodeJS.Signals | null;
}

export type CodePatchChangeType = "create" | "update";

export interface CodePatchFileEdit {
  path: string;
  changeType: CodePatchChangeType;
  content: string;
  reason: string;
}

export interface CodePatchPlan {
  summary: string;
  edits: CodePatchFileEdit[];
  validationCommand?: WorkflowCommandName;
}

export interface EditableFileContext {
  path: string;
  exists: boolean;
  content: string;
}

export interface AppliedCodePatchEdit {
  path: string;
  changeType: CodePatchChangeType;
  bytesWritten: number;
}

export type PatchValidationOutcome = "not_run" | "improved" | "unchanged" | "regressed";

export interface AppliedCodePatchResult {
  summary: string;
  edits: AppliedCodePatchEdit[];
  validationCommand?: WorkflowCommandName;
  validationBefore?: CommandExecutionResult;
  validationAfter?: CommandExecutionResult;
  validationOutcome: PatchValidationOutcome;
  gitStatus?: GitStatusResult;
  gitDiff?: GitDiffResult;
  unexpectedChangedFiles: string[];
  isolationMode: "direct" | "isolated_worktree";
  worktreeCleanedUp?: boolean;
}

export interface GitStatusEntry {
  indexStatus: string;
  workingTreeStatus: string;
  path: string;
}

export interface GitStatusResult {
  entries: GitStatusEntry[];
  raw: string;
}

export interface GitDiffResult {
  staged: boolean;
  diff: string;
  changedFiles: string[];
  truncated: boolean;
}

export interface WorkflowToolCallRecord {
  toolName: string;
  signature: string;
  request: unknown;
  result?: WorkflowToolResult;
  suppressed: boolean;
  cached: boolean;
  workingMemorySignature: string;
  decisionSignature?: string;
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
  kind: "tool" | "delegate" | "planner" | "replanner" | "critic" | "edit_patch";
  message: string;
  signature?: string;
  createdAt: string;
}

export interface WorkingMemorySnapshot {
  workflowName: string;
  triage?: unknown;
  lastCritique?: WorkflowCritique;
  toolCalls: WorkflowToolCallRecord[];
  patchResults: AppliedCodePatchResult[];
  patchSignals: string[];
  delegations: WorkflowDelegationRecord[];
  commandResults: CommandExecutionResult[];
  commandSignals: string[];
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
  patchPatterns: string[];
  commandPatterns: string[];
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

export interface JiraAnalysis {
  summary: string;
  implementationPlan: string[];
  acceptanceCriteria: string[];
  risks: string[];
  testScenarios: string[];
  suggestedBranchName: string;
  suggestedPRTitle: string;
}

export interface PRCreatePlan {
  title: string;
  description: string;
  suggestedBranchName: string;
  labels: string[];
}

export interface PRCreateResult extends PRCreatePlan {
  prUrl?: string;
  prNumber?: number;
}

export interface RepoInvestigationResult {
  summary: string;
  relevantFiles: string[];
  codePatterns: string[];
  hypotheses: string[];
  nextSteps: string[];
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
  files: string[];
}

export interface GitLogResult {
  commits: GitLogEntry[];
  query?: string;
  truncated: boolean;
}
