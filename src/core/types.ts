export type WorkflowResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

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
