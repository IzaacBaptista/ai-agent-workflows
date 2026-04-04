import { BaseAgent } from "../core/baseAgent";
import { workflowReplanSchema } from "../core/actionSchemas";
import { callLLM } from "../core/llmClient";
import { RelevantMemoryContext, RegisteredAgentName, WorkflowReplan, WorkflowToolName } from "../core/types";
import { buildPlannerContextFromMemory } from "../helpers/buildPlannerContextFromMemory";
import { loadPrompt } from "../helpers/loadPrompt";

export class ReplannerAgent extends BaseAgent<WorkflowReplan> {
  async run(input: string): Promise<WorkflowReplan> {
    const promptTemplate = loadPrompt("replannerPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;

    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, workflowReplanSchema);
  }

  async runForWorkflow(
    workflowName: string,
    context: string,
    memoryContext: RelevantMemoryContext,
    availableTools: WorkflowToolName[],
    delegatableAgents: RegisteredAgentName[],
  ): Promise<WorkflowReplan> {
    return this.run([
      `Workflow: ${workflowName}`,
      "Available runtime actions: analyze, tool_call, delegate, finalize",
      `Available tools: ${availableTools.join(", ")}`,
      `Delegatable agents: ${delegatableAgents.join(", ")}`,
      "",
      buildPlannerContextFromMemory(memoryContext),
      "",
      context,
    ].join("\n"));
  }
}
