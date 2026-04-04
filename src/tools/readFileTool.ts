import { readFileSync } from "fs";
import { resolve } from "path";

export interface FileReadResult {
  file: string;
  content: string;
}

export function readFiles(files: string[], maxFiles = 3, maxCharsPerFile = 1200): FileReadResult[] {
  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);

  return uniqueFiles.map((file) => {
    const absolutePath = resolve(file);
    const content = readFileSync(absolutePath, "utf-8");
    const trimmedContent =
      content.length <= maxCharsPerFile ? content : `${content.slice(0, maxCharsPerFile)}...`;

    return {
      file: absolutePath,
      content: trimmedContent,
    };
  });
}
