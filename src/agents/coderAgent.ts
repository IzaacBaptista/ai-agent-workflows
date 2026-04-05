import { BaseAgent } from "../core/baseAgent";
import { codePatchPlanSchema } from "../core/actionSchemas";
import { callLLM } from "../core/llmClient";
import { CodePatchPlan } from "../core/types";
import { loadPrompt } from "../helpers/loadPrompt";

export class CoderAgent extends BaseAgent<CodePatchPlan> {
  async run(input: string): Promise<CodePatchPlan> {
    const promptTemplate = loadPrompt("coderPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, codePatchPlanSchema);
  }
}
