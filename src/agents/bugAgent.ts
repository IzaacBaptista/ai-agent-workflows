import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { BugAnalysis } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const bugAnalysisSchema = z.object({
  summary: z.string(),
  possibleCauses: z.array(z.string()),
  investigationSteps: z.array(z.string()),
  fixSuggestions: z.array(z.string()),
  risks: z.array(z.string())
});

export class BugAgent extends BaseAgent<BugAnalysis> {
  async run(input: string): Promise<BugAnalysis> {
    const promptTemplate = loadPrompt("bugPrompt");
    const finalPrompt = `${promptTemplate}\n\nBug description:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, bugAnalysisSchema);
  }
}
