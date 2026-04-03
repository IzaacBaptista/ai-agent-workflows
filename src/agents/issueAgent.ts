import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { IssueAnalysis } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const issueAnalysisSchema = z.object({
  summary: z.string(),
  questions: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  technicalPlan: z.array(z.string()),
  testScenarios: z.array(z.string()),
  risks: z.array(z.string()),
  assumptions: z.array(z.string())
});

export class IssueAgent extends BaseAgent<IssueAnalysis> {
  async run(input: string): Promise<IssueAnalysis> {
    const promptTemplate = loadPrompt("issuePrompt");
    const finalPrompt = `${promptTemplate}\n\nIssue:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, issueAnalysisSchema);
  }
}
