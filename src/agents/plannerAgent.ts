import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { WorkflowPlan } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const workflowPlanSchema = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      action: z.enum(["triage", "search_code", "read_file", "call_external_api", "final_analysis"]),
      purpose: z.string(),
    }),
  ).min(1),
});

export class PlannerAgent extends BaseAgent<WorkflowPlan> {
  async run(input: string): Promise<WorkflowPlan> {
    const promptTemplate = loadPrompt("plannerPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;

    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, workflowPlanSchema);
  }

  async runForWorkflow(workflowName: string, input: string): Promise<WorkflowPlan> {
    return this.run([
      `Workflow: ${workflowName}`,
      "Available actions: triage, search_code, read_file, call_external_api, final_analysis",
      "",
      "Input:",
      input,
    ].join("\n"));
  }
}
