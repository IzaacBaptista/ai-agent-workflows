import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { WorkflowReplan } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const workflowReplanSchema = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      action: z.enum(["triage", "search_code", "read_file", "call_external_api", "final_analysis"]),
      purpose: z.string(),
    }),
  ).min(1),
});

export class ReplannerAgent extends BaseAgent<WorkflowReplan> {
  async run(input: string): Promise<WorkflowReplan> {
    const promptTemplate = loadPrompt("replannerPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;

    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, workflowReplanSchema);
  }

  async runForWorkflow(workflowName: string, context: string): Promise<WorkflowReplan> {
    return this.run([
      `Workflow: ${workflowName}`,
      "Available actions: triage, search_code, read_file, call_external_api, final_analysis",
      "",
      context,
    ].join("\n"));
  }
}
