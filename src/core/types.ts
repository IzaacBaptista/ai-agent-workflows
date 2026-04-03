export interface IssueAnalysis {
  summary: string;
  questions: string[];
  acceptanceCriteria: string[];
  technicalPlan: string[];
  testScenarios: string[];
  risks: string[];
  assumptions: string[];
}

export interface BugAnalysis {
  summary: string;
  possibleCauses: string[];
  investigationSteps: string[];
  fixSuggestions: string[];
  risks: string[];
}

export interface PRReview {
  summary: string;
  impacts: string[];
  risks: string[];
  suggestions: string[];
  testRecommendations: string[];
}
