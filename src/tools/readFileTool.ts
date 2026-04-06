import { existsSync, readFileSync } from "fs";
import { extname, resolve } from "path";
import { getProjectConfig } from "../config/projectConfig";

export interface FileReadResult {
  file: string;
  content: string;
}

const ALLOWED_EXTENSIONS = new Set([".ts", ".js", ".json", ".md"]);

function getAllowedRoots(): string[] {
  const config = getProjectConfig();

  if (config.allowedPaths && config.allowedPaths.length > 0) {
    return config.allowedPaths.map((p) => resolve(process.cwd(), p));
  }

  return [resolve(process.cwd(), "src")];
}

function isAllowedPath(absolutePath: string): boolean {
  const roots = getAllowedRoots();
  return roots.some(
    (root) => absolutePath === root || absolutePath.startsWith(`${root}/`),
  );
}

function getReadPathValidationError(file: string): string | undefined {
  const absolutePath = resolve(file);
  const extension = extname(absolutePath);

  if (!isAllowedPath(absolutePath)) {
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

export function getReadFileValidationError(files: string[], maxFiles = 3): string | undefined {
  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);

  for (const file of uniqueFiles) {
    const error = getReadPathValidationError(file);
    if (error) {
      return error;
    }
  }

  return undefined;
}

export function readFiles(files: string[], maxFiles = 3, maxCharsPerFile = 1200): FileReadResult[] {
  const validationError = getReadFileValidationError(files, maxFiles);
  if (validationError) {
    throw new Error(validationError);
  }

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
