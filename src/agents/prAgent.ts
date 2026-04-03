import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { PRReview } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const prReviewSchema = z.object({
  summary: z.string(),
  impacts: z.array(z.string()),
  risks: z.array(z.string()),
  suggestions: z.array(z.string()),
  testRecommendations: z.array(z.string())
});

export class PRAgent extends BaseAgent<PRReview> {
  async run(input: string): Promise<PRReview> {
    const promptTemplate = loadPrompt("prPrompt");
    const finalPrompt = `${promptTemplate}\n\nCode changes:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, prReviewSchema);
  }
}
