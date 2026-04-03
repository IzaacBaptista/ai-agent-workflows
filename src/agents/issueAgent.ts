import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import fs from "fs";
import path from "path";

export class IssueAgent extends BaseAgent {
  async run(input: string) {
    const promptPath = path.resolve(__dirname, "../../prompts/issuePrompt.md");
    const promptTemplate = fs.readFileSync(promptPath, "utf-8");

    const finalPrompt = `${promptTemplate}\n\nIssue:\n${input}`;

    const response = await callLLM(finalPrompt);

    return this.parseResponse(response);
  }

  private parseResponse(response: any) {
    try {
      const text = response.output[0].content[0].text;
      return JSON.parse(text);
    } catch (error) {
      return {
        error: "Failed to parse LLM response",
        raw: response
      };
    }
  }
}
