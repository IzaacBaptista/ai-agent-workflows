import { readFileSync } from "fs";
import { extname, resolve } from "path";

export interface FileReadResult {
  file: string;
  content: string;
}

const ALLOWED_EXTENSIONS = new Set([".ts", ".js", ".json", ".md"]);
const ALLOWED_ROOT = resolve(process.cwd(), "src");

function isAllowedPath(absolutePath: string): boolean {
  return absolutePath === ALLOWED_ROOT || absolutePath.startsWith(`${ALLOWED_ROOT}/`);
}

export function readFiles(files: string[], maxFiles = 3, maxCharsPerFile = 1200): FileReadResult[] {
  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);

  return uniqueFiles.map((file) => {
    const absolutePath = resolve(file);
    const extension = extname(absolutePath);

    if (!isAllowedPath(absolutePath)) {
      throw new Error(`File "${file}" is outside the allowed read scope`);
    }

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error(`File "${file}" has unsupported extension "${extension}"`);
    }

    const content = readFileSync(absolutePath, "utf-8");
    const trimmedContent =
      content.length <= maxCharsPerFile ? content : `${content.slice(0, maxCharsPerFile)}...`;

    return {
      file: absolutePath,
      content: trimmedContent,
    };
  });
}
