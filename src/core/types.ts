export type WorkflowRunStatus = "running" | "completed" | "failed";
export type WorkflowStepStatus = "running" | "completed" | "failed";
export type WorkflowToolName = "search_code" | "read_file" | "call_external_api";
export type WorkflowPlannedAction =
  | "triage"
  | "search_code"
  | "read_file"
  | "call_external_api"
  | "final_analysis";

export interface WorkflowExecutionPolicy {
  maxSteps: number;
  maxRetriesPerStep: number;
  timeoutMs: number;
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
  githubComment?: {
    posted: boolean;
    error?: string;
  };
}

export type WorkflowResult<T> =
  | { success: true; data: T; meta: WorkflowExecutionMeta }
  | { success: false; error: string; meta: WorkflowExecutionMeta };

export interface WorkflowPlanStep {
  action: WorkflowPlannedAction;
  purpose: string;
}

export interface WorkflowPlan {
  summary: string;
  steps: WorkflowPlanStep[];
}

export interface WorkflowReplan {
  summary: string;
  steps: WorkflowPlanStep[];
}

export interface WorkflowCritique {
  approved: boolean;
  summary: string;
  gaps: string[];
  recommendedActions: WorkflowPlannedAction[];
}

export interface WorkflowToolRequest {
  tool: WorkflowToolName;
  terms?: string[];
  files?: string[];
  endpoint?: string;
}

export interface WorkflowToolResult {
  tool: WorkflowToolName;
  summary: string;
  data: unknown;
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
