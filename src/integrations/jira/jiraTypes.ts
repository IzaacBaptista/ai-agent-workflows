export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  issueType: string;
  status: string;
  priority: string;
  assignee?: string;
  labels: string[];
  components: string[];
  url: string;
}
