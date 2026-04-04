import { z } from "zod";
import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import { PRTriage } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

const prTriageSchema = z.object({
  summary: z.string(),
  reviewFocus: z.array(z.string()),
  codeSearchTerms: z.array(z.string()),
  regressionChecks: z.array(z.string())
});

export class PRTriageAgent extends BaseAgent<PRTriage> {
  async run(input: string): Promise<PRTriage> {
    const promptTemplate = loadPrompt("prTriagePrompt");
    const finalPrompt = `${promptTemplate}\n\nCode changes:\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, prTriageSchema);
  }
}
