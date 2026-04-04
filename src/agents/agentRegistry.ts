import { BugAgent } from "./bugAgent";
import { BugTriageAgent } from "./bugTriageAgent";
import { CriticAgent } from "./criticAgent";
import { IssueAgent } from "./issueAgent";
import { IssueTriageAgent } from "./issueTriageAgent";
import { PlannerAgent } from "./plannerAgent";
import { PRAgent } from "./prAgent";
import { PRTriageAgent } from "./prTriageAgent";
import { ReplannerAgent } from "./replannerAgent";
import { ReviewerAgent } from "./reviewerAgent";
import { RegisteredAgentName } from "../core/types";

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
};

export function getDelegatableAgentNames(): RegisteredAgentName[] {
  return Object.keys(agentFactories) as RegisteredAgentName[];
}

export function isRegisteredAgentName(value: string): value is RegisteredAgentName {
  return value in agentFactories;
}

export async function runDelegatedAgent(agentName: RegisteredAgentName, input: string): Promise<unknown> {
  const factory = agentFactories[agentName];
  return factory().run(input);
}
