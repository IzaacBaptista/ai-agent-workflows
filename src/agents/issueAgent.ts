import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";

export class IssueAgent extends BaseAgent {
  async run(input: string) {
    const prompt = `Analyze this issue and generate:\n- Questions\n- Acceptance Criteria\n- Technical Plan\n- Test Scenarios\n\nIssue:\n${input}`;

    return callLLM(prompt);
  }
}
