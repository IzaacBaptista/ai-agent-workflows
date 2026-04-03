import { BaseAgent } from "../core/baseAgent";
import { callLLM } from "../core/llmClient";
import fs from "fs";
import path from "path";

export class PRAgent extends BaseAgent {
  async run(input: string) {
    const promptPath = path.resolve(__dirname, "../../prompts/prPrompt.md");
    const promptTemplate = fs.readFileSync(promptPath, "utf-8");

    const finalPrompt = `${promptTemplate}\n\nCode Changes:\n${input}`;

    const response = await callLLM(finalPrompt);

    return this.parseResponse(response);
  }
}
