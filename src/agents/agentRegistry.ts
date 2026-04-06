import { BugAgent } from "./bugAgent";
import { BugTriageAgent } from "./bugTriageAgent";
import { CriticAgent } from "./criticAgent";
import { IssueAgent } from "./issueAgent";
import { IssueTriageAgent } from "./issueTriageAgent";
import { JiraAnalyzeAgent } from "./jiraAnalyzeAgent";
import { PlannerAgent } from "./plannerAgent";
import { PRAgent } from "./prAgent";
import { PRCreateAgent } from "./prCreateAgent";
import { PRTriageAgent } from "./prTriageAgent";
import { ReplannerAgent } from "./replannerAgent";
import { RepoInvestigateAgent } from "./repoInvestigateAgent";
import { ReviewerAgent } from "./reviewerAgent";
import { REGISTERED_AGENT_NAMES, RegisteredAgentName } from "../core/types";

interface RunnableAgent {
  run(input: string): Promise<unknown>;
}

type AgentFactory = () => RunnableAgent;

const agentFactories: Record<RegisteredAgentName, AgentFactory> = {
  PlannerAgent: () => new PlannerAgent(),
  ReplannerAgent: () => new ReplannerAgent(),
  CriticAgent: () => new CriticAgent(),
  ReviewerAgent: () => new ReviewerAgent(),
  IssueTriageAgent: () => new IssueTriageAgent(),
  BugTriageAgent: () => new BugTriageAgent(),
  PRTriageAgent: () => new PRTriageAgent(),
  IssueAgent: () => new IssueAgent(),
  BugAgent: () => new BugAgent(),
  PRAgent: () => new PRAgent(),
  JiraAnalyzeAgent: () => new JiraAnalyzeAgent(),
  PRCreateAgent: () => new PRCreateAgent(),
  RepoInvestigateAgent: () => new RepoInvestigateAgent(),
};

export function getDelegatableAgentNames(): RegisteredAgentName[] {
  return [...REGISTERED_AGENT_NAMES];
}

export function isRegisteredAgentName(value: string): value is RegisteredAgentName {
  return value in agentFactories;
}

export async function runDelegatedAgent(agentName: RegisteredAgentName, input: string): Promise<unknown> {
  const factory = agentFactories[agentName];
  return factory().run(input);
}
