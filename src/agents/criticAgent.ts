import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { WorkflowCritique } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const workflowCritiqueSchema = z.object({
  approved: z.boolean(),
  summary: z.string(),
  gaps: z.array(z.string()),
  recommendedActions: z.array(
    z.enum(["triage", "search_code", "read_file", "call_external_api", "final_analysis"]),
  ),
});

export class CriticAgent extends BaseAgent<WorkflowCritique> {
  async run(input: string): Promise<WorkflowCritique> {
    const promptTemplate = loadPrompt("criticPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, workflowCritiqueSchema);
  }

  async review(workflowName: string, context: string, candidateResult: unknown): Promise<WorkflowCritique> {
    return this.run([
      `Workflow: ${workflowName}`,
      "",
      "Review context:",
      context,
      "",
      "Candidate result:",
      JSON.stringify(candidateResult),
    ].join("\n"));
  }
}
