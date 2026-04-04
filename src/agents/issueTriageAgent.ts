import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { IssueTriage } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const issueTriageSchema = z.object({
  summary: z.string(),
  investigationAreas: z.array(z.string()),
  codeSearchTerms: z.array(z.string()),
  validationChecks: z.array(z.string())
});

export class IssueTriageAgent extends BaseAgent<IssueTriage> {
  async run(input: string): Promise<IssueTriage> {
    const promptTemplate = loadPrompt("issueTriagePrompt");
    const finalPrompt = `${promptTemplate}\n\nIssue:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, issueTriageSchema);
  }
}
