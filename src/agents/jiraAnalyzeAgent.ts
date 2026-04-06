import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { JiraAnalysis } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const jiraAnalysisSchema = z.object({
  summary: z.string(),
  relevantFiles: z.array(z.string()),
  implementationPlan: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  risks: z.array(z.string()),
  testScenarios: z.array(z.string()),
  suggestedBranchName: z.string(),
  suggestedPRTitle: z.string(),
});

export class JiraAnalyzeAgent extends BaseAgent<JiraAnalysis> {
  async run(input: string): Promise<JiraAnalysis> {
    const promptTemplate = loadPrompt("jiraAnalyzePrompt");
    const finalPrompt = `${promptTemplate}\n\nJira Issue:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, jiraAnalysisSchema);
  }
}
