import { BaseAgent } from "../core/baseAgent";
import { reviewerAssessmentSchema } from "../core/actionSchemas";
import { ReviewerAssessment } from "../core/types";
import { callLLM } from "../core/llmClient";
import { loadPrompt } from "../helpers/loadPrompt";

export class ReviewerAgent extends BaseAgent<ReviewerAssessment> {
  async run(input: string): Promise<ReviewerAssessment> {
    const promptTemplate = loadPrompt("reviewerPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, reviewerAssessmentSchema);
  }
}
