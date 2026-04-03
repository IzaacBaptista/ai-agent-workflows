import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import fs from "fs";
import path from "path";

export class BugAgent extends BaseAgent {
  async run(input: string) {
    const promptPath = path.resolve(__dirname, "../../prompts/bugPrompt.md");
    const promptTemplate = fs.readFileSync(promptPath, "utf-8");

    const finalPrompt = `${promptTemplate}\n\nBug Report:\n${input}`;

    const response = await callLLM(finalPrompt);

    return this.parseResponse(response);
  }
}
