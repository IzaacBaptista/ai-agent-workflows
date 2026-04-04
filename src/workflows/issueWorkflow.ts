import { CriticAgent } from "../agents/criticAgent";
import { IssueAgent } from "../agents/issueAgent";
import { IssueTriageAgent } from "../agents/issueTriageAgent";
import { PlannerAgent } from "../agents/plannerAgent";
import { ReplannerAgent } from "../agents/replannerAgent";
import { CommandExecutionResult, IssueAnalysis, IssueTriage, WorkflowResult } from "../core/types";
import { WorkflowDefinition, WorkflowRuntime } from "../core/workflowRuntime";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";
import {
  logAgentExecutionFailure,
  logAgentExecutionSuccess,
  startAgentExecution,
} from "../tools/loggingTool";

function buildIssueWorkflowContext(
  issue: string,
  triage: IssueTriage | undefined,
  codeSearchResults: Record<string, CodeSearchResult[]> | undefined,
  fileReadResults: FileReadResult[] | undefined,
  commandResults: CommandExecutionResult[] | undefined,
): string {
  return [
    "Issue input:",
    issue,
    "",
    "Triage summary:",
    triage?.summary ?? "No triage available",
    "",
    "Investigation areas:",
    ...(triage?.investigationAreas ?? []).map((item) => `- ${item}`),
    "",
    "Validation checks:",
    ...(triage?.validationChecks ?? []).map((item) => `- ${item}`),
    "",
    "Code search results:",
    ...Object.entries(codeSearchResults ?? {}).flatMap(([term, matches]) => {
      if (matches.length === 0) {
        return [`- ${term}: no matches found`];
      }

      return [
        `- ${term}:`,
        ...matches.map(
          (match) => `  - ${match.file}:${match.line} ${match.snippet.replace(/\n/g, " ").trim()}`,
        ),
      ];
    }),
    "",
    "Read file results:",
    ...(fileReadResults ?? []).map((file) => `- ${file.file}: ${file.content.replace(/\n/g, " ").trim()}`),
    "",
    "Command results:",
    ...(commandResults ?? []).map(
      (result) =>
        `- ${result.command}: exitCode=${result.exitCode ?? "null"} timedOut=${result.timedOut} stdout=${result.stdout.replace(/\n/g, " ").trim()} stderr=${result.stderr.replace(/\n/g, " ").trim()}`,
    ),
  ].join("\n");
}

function buildIssueCritiqueContext(issue: string, workflowContext: string): string {
  return [
    "Original input:",
    issue,
    "",
    "Analysis context:",
    workflowContext,
  ].join("\n");
}

function buildReplanContext(
  originalInput: string,
  completedAction: unknown,
  runtime: WorkflowRuntime,
  remainingActions: unknown[],
): string {
  const run = runtime.getRunRecord();

  return [
    "Original input:",
    originalInput,
    "",
    "Completed action:",
    JSON.stringify(completedAction),
    "",
    "Working artifacts:",
    JSON.stringify(run.artifacts),
    "",
    "Executed steps:",
    JSON.stringify(run.steps),
    "",
    "Remaining actions:",
    JSON.stringify(remainingActions),
  ].join("\n");
}

const issueWorkflowDefinition: WorkflowDefinition<IssueTriage, IssueAnalysis> = {
  workflowName: "IssueWorkflow",
  triageAgentName: "IssueTriageAgent",
  finalAgentName: "IssueAgent",
  runPlanner: (input, memoryContext, availableTools, delegatableAgents) => {
    const agent = new PlannerAgent();
    return agent.runForWorkflow("IssueWorkflow", input, memoryContext, availableTools, delegatableAgents);
  },
  runReplanner: (context, memoryContext, availableTools, delegatableAgents) => {
    const agent = new ReplannerAgent();
    return agent.runForWorkflow("IssueWorkflow", context, memoryContext, availableTools, delegatableAgents);
  },
  runCritic: (context, candidateResult, workingMemory, memoryContext) => {
    const critic = new CriticAgent();
    return critic.review("IssueWorkflow", context, candidateResult, workingMemory, memoryContext);
  },
  runTriage: async (task, input) => {
    const agent = new IssueTriageAgent();
    return agent.run([`Task:\n${task}`, "", "Issue:", input].join("\n"));
  },
  runFinal: async (task, context) => {
    const agent = new IssueAgent();
    return agent.run([`Task:\n${task}`, "", context].join("\n"));
  },
  buildFinalContext: (input, runtime, triage) => {
    const codeSearchResults = runtime.getRunRecord().artifacts.codeSearchResults as
      | Record<string, CodeSearchResult[]>
      | undefined;
    const fileReadResults = runtime.getRunRecord().artifacts.fileReadResults as
      | FileReadResult[]
      | undefined;
    const commandResults = runtime.getRunRecord().artifacts.commandResults as
      | CommandExecutionResult[]
      | undefined;
    return buildIssueWorkflowContext(input, triage, codeSearchResults, fileReadResults, commandResults);
  },
  buildCritiqueContext: (input, _runtime, _candidateResult, finalContext) =>
    buildIssueCritiqueContext(input, finalContext),
  buildReplanContext: (input, completedAction, runtime, remainingActions) =>
    buildReplanContext(input, completedAction, runtime, remainingActions),
  summarizeTriage: (triage) => `investigationAreas=${triage.investigationAreas.length}`,
  summarizeResult: (result) => `questions=${result.questions.length}`,
};

export async function runIssueWorkflow(issue: string): Promise<WorkflowResult<IssueAnalysis>> {
  const execution = startAgentExecution("IssueWorkflow", issue);
  const runtime = new WorkflowRuntime({
    workflowName: "IssueWorkflow",
    input: issue,
  });

  try {
    const result = await runtime.runActionQueue(issueWorkflowDefinition, issue);
    runtime.complete();
    logAgentExecutionSuccess(execution, issue, result);
    return { success: true, data: result, meta: runtime.getMeta() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.fail(message);
    logAgentExecutionFailure(execution, issue, error);
    console.error("[IssueWorkflow] Failed:", message);
    return { success: false, error: message, meta: runtime.getMeta() };
  }
}
