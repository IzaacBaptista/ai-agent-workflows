import { BaseAgent } from "../core/baseAgent";
import { workflowPlanSchema } from "../core/actionSchemas";
import { callLLM } from "../core/llmClient";
import { RelevantMemoryContext, RegisteredAgentName, WorkflowPlan, WorkflowToolName } from "../core/types";
import { buildPlannerContextFromMemory } from "../helpers/buildPlannerContextFromMemory";
import { loadPrompt } from "../helpers/loadPrompt";

export class PlannerAgent extends BaseAgent<WorkflowPlan> {
  async run(input: string): Promise<WorkflowPlan> {
    const promptTemplate = loadPrompt("plannerPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;

    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, workflowPlanSchema);
  }

  async runForWorkflow(
    workflowName: string,
    input: string,
    memoryContext: RelevantMemoryContext,
    availableTools: WorkflowToolName[],
    delegatableAgents: RegisteredAgentName[],
  ): Promise<WorkflowPlan> {
    return this.run([
      `Workflow: ${workflowName}`,
      "Available runtime actions: analyze, tool_call, delegate, finalize",
      `Available tools: ${availableTools.join(", ")}`,
      `Delegatable agents: ${delegatableAgents.join(", ")}`,
      "",
      buildPlannerContextFromMemory(memoryContext),
      "",
      "Input:",
      input,
    ].join("\n"));
  }
}
