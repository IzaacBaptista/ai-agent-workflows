import { readFileSync } from "fs";
import { join } from "path";

export const loadPrompt = (promptName: string): string => {
  const promptPath = join(__dirname, "../../prompts", `${promptName}.md`);
  return readFileSync(promptPath, "utf-8");
};
