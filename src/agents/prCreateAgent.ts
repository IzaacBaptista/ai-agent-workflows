import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { PRCreatePlan } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const prCreatePlanSchema = z.object({
  title: z.string(),
  description: z.string(),
  suggestedBranchName: z.string(),
  labels: z.array(z.string()),
});

export class PRCreateAgent extends BaseAgent<PRCreatePlan> {
  async run(input: string): Promise<PRCreatePlan> {
    const promptTemplate = loadPrompt("prCreatePrompt");
    const finalPrompt = `${promptTemplate}\n\nContext:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, prCreatePlanSchema);
  }
}
