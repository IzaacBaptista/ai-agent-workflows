import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { RepoInvestigationResult } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const repoInvestigationResultSchema = z.object({
  summary: z.string(),
  relevantFiles: z.array(z.string()),
  codePatterns: z.array(z.string()),
  hypotheses: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

export class RepoInvestigateAgent extends BaseAgent<RepoInvestigationResult> {
  async run(input: string): Promise<RepoInvestigationResult> {
    const promptTemplate = loadPrompt("repoInvestigatePrompt");
    const finalPrompt = `${promptTemplate}\n\nInvestigation context:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, repoInvestigationResultSchema);
  }
}
