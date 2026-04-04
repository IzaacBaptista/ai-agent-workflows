import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join } from "path";

export interface CodeSearchResult {
  file: string;
  line: number;
  snippet: string;
}

const SEARCHABLE_EXTENSIONS = new Set([".ts", ".js", ".md", ".json"]);
const DEFAULT_SEARCH_ROOT = join(process.cwd(), "src");

function collectFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (SEARCHABLE_EXTENSIONS.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildSnippet(lines: string[], index: number): string {
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length, index + 2);
  return lines.slice(start, end).join("\n").trim();
}

export function searchCode(term: string, limit = 5): CodeSearchResult[] {
  if (!term.trim()) {
    return [];
  }

  const normalizedTerm = term.toLowerCase();
  const files = collectFiles(DEFAULT_SEARCH_ROOT);
  const results: CodeSearchResult[] = [];

  for (const file of files) {
    if (results.length >= limit) {
      break;
    }

    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(normalizedTerm)) {
        continue;
      }

      results.push({
        file,
        line: index + 1,
        snippet: buildSnippet(lines, index)
      });

      if (results.length >= limit) {
        break;
      }
    }
  }

  return results;
}
