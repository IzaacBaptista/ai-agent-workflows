import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { BugTriage } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const bugTriageSchema = z.object({
  summary: z.string(),
  hypotheses: z.array(z.string()),
  codeSearchTerms: z.array(z.string()),
  apiChecks: z.array(z.string())
});

export class BugTriageAgent extends BaseAgent<BugTriage> {
  async run(input: string): Promise<BugTriage> {
    const promptTemplate = loadPrompt("bugTriagePrompt");
    const finalPrompt = `${promptTemplate}\n\nBug description:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, bugTriageSchema);
  }
}
