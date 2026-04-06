import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, resolve } from "path";
import { getProjectConfig } from "../config/projectConfig";

export interface CodeSearchResult {
  file: string;
  line: number;
  snippet: string;
}

const SEARCHABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".json",
  ".php",
  ".py",
  ".rb",
  ".java",
  ".go",
  ".rs",
  ".kt",
  ".swift",
  ".yaml",
  ".yml",
  ".sql",
  ".vue",
  ".sh",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "storage",
]);
const COMMON_SEARCH_ROOTS = ["src", "app", "lib", "server", "services", "packages", "modules"];

function getSearchRoots(baseDir = process.cwd()): string[] {
  const config = getProjectConfig(baseDir);
  const configuredRoots =
    config.searchPaths && config.searchPaths.length > 0
      ? config.searchPaths
      : config.allowedPaths && config.allowedPaths.length > 0
        ? config.allowedPaths
        : undefined;

  if (configuredRoots) {
    return configuredRoots
      .map((entry) => resolve(baseDir, entry))
      .filter((entry) => existsSync(entry) && statSync(entry).isDirectory());
  }

  const discoveredRoots = COMMON_SEARCH_ROOTS
    .map((entry) => resolve(baseDir, entry))
    .filter((entry) => existsSync(entry));

  if (discoveredRoots.length > 0) {
    return discoveredRoots;
  }

  return [resolve(baseDir)];
}

function collectFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry)) {
      continue;
    }

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

export function searchCode(term: string, limit = 5, baseDir = process.cwd()): CodeSearchResult[] {
  if (!term.trim()) {
    return [];
  }

  const normalizedTerm = term.toLowerCase();
  const files = Array.from(new Set(getSearchRoots(baseDir).flatMap((root) => collectFiles(root))));
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
