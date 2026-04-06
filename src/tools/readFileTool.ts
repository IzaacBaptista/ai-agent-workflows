import { existsSync, readFileSync } from "fs";
import { extname, resolve } from "path";
import { getProjectConfig } from "../config/projectConfig";

export interface FileReadResult {
  file: string;
  content: string;
}

const ALLOWED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
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

function getAllowedRoots(baseDir = process.cwd()): string[] {
  const config = getProjectConfig(baseDir);

  if (config.allowedPaths && config.allowedPaths.length > 0) {
    return config.allowedPaths.map((p) => resolve(baseDir, p));
  }

  return [resolve(baseDir)];
}

function isAllowedPath(absolutePath: string, baseDir = process.cwd()): boolean {
  const roots = getAllowedRoots(baseDir);
  return roots.some(
    (root) => absolutePath === root || absolutePath.startsWith(`${root}/`),
  );
}

function getReadPathValidationError(file: string, baseDir = process.cwd()): string | undefined {
  const absolutePath = resolve(baseDir, file);
  const extension = extname(absolutePath);

  if (!isAllowedPath(absolutePath, baseDir)) {
    return `File "${file}" is outside the allowed read scope`;
  }

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return `File "${file}" has unsupported extension "${extension}"`;
  }

  if (!existsSync(absolutePath)) {
    return `File "${file}" does not exist`;
  }

  return undefined;
}

export function getReadFileValidationError(
  files: string[],
  maxFiles = 3,
  baseDir = process.cwd(),
): string | undefined {
  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);

  for (const file of uniqueFiles) {
    const error = getReadPathValidationError(file, baseDir);
    if (error) {
      return error;
    }
  }

  return undefined;
}

export function readFiles(
  files: string[],
  maxFiles = 3,
  maxCharsPerFile = 1200,
  baseDir = process.cwd(),
): FileReadResult[] {
  const validationError = getReadFileValidationError(files, maxFiles, baseDir);
  if (validationError) {
    throw new Error(validationError);
  }

  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);

  return uniqueFiles.map((file) => {
    const absolutePath = resolve(baseDir, file);

    const content = readFileSync(absolutePath, "utf-8");
    const trimmedContent =
      content.length <= maxCharsPerFile ? content : `${content.slice(0, maxCharsPerFile)}...`;

    return {
      file: absolutePath,
      content: trimmedContent,
    };
  });
}
