import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, extname, resolve } from "path";
import {
  AppliedCodePatchResult,
  CodePatchPlan,
  EditableFileContext,
} from "../core/types";

const ALLOWED_EDIT_EXTENSIONS = new Set([".ts", ".js", ".json", ".md", ".sh"]);

type EditableFileContextLoader = (files: string[], baseDir?: string) => EditableFileContext[];
type CodePatchApplier = (
  plan: CodePatchPlan,
  requestedFiles: string[],
  baseDir?: string,
) => AppliedCodePatchResult;

let editableFileContextLoader: EditableFileContextLoader = defaultLoadEditableFileContexts;
let codePatchApplier: CodePatchApplier = defaultApplyCodePatchPlan;

function buildAllowedEditRoots(baseDir = process.cwd()): string[] {
  return [
    resolve(baseDir, "src"),
    resolve(baseDir, "prompts"),
    resolve(baseDir, "docs"),
    resolve(baseDir, "evals"),
    resolve(baseDir, "scripts"),
  ];
}

function buildAllowedEditFiles(baseDir = process.cwd()): Set<string> {
  return new Set([
    resolve(baseDir, "README.md"),
    resolve(baseDir, "package.json"),
    resolve(baseDir, "tsconfig.json"),
  ]);
}

function isAllowedEditPath(absolutePath: string, baseDir = process.cwd()): boolean {
  const allowedEditFiles = buildAllowedEditFiles(baseDir);

  if (allowedEditFiles.has(absolutePath)) {
    return true;
  }

  return buildAllowedEditRoots(baseDir).some(
    (allowedRoot) => absolutePath === allowedRoot || absolutePath.startsWith(`${allowedRoot}/`),
  );
}

function resolveEditablePath(file: string, baseDir = process.cwd()): string {
  const absolutePath = resolve(baseDir, file);
  const extension = extname(absolutePath);
  const allowedEditFiles = buildAllowedEditFiles(baseDir);

  if (!isAllowedEditPath(absolutePath, baseDir)) {
    throw new Error(`File "${file}" is outside the allowed edit scope`);
  }

  if (!ALLOWED_EDIT_EXTENSIONS.has(extension) && !allowedEditFiles.has(absolutePath)) {
    throw new Error(`File "${file}" has unsupported extension "${extension}"`);
  }

  return absolutePath;
}

function defaultLoadEditableFileContexts(
  files: string[],
  baseDir = process.cwd(),
  maxFiles = 3,
  maxCharsPerFile = 64_000,
  maxTotalChars = 80_000,
): EditableFileContext[] {
  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);
  let totalChars = 0;

  return uniqueFiles.map((file) => {
    const absolutePath = resolveEditablePath(file, baseDir);
    const exists = existsSync(absolutePath);
    const content = exists ? readFileSync(absolutePath, "utf-8") : "";

    if (content.length > maxCharsPerFile) {
      throw new Error(`Editable file "${file}" exceeds the maximum supported size for edit_patch`);
    }

    totalChars += content.length;
    if (totalChars > maxTotalChars) {
      throw new Error("Combined editable context exceeds the maximum supported size for edit_patch");
    }

    return {
      path: file,
      exists,
      content,
    };
  });
}

function defaultApplyCodePatchPlan(
  plan: CodePatchPlan,
  requestedFiles: string[],
  baseDir = process.cwd(),
): AppliedCodePatchResult {
  const requestedPaths = new Set(requestedFiles.map((file) => resolveEditablePath(file, baseDir)));

  for (const edit of plan.edits) {
    const absolutePath = resolveEditablePath(edit.path, baseDir);
    if (!requestedPaths.has(absolutePath)) {
      throw new Error(`Patch edit "${edit.path}" was not declared in the edit_patch action`);
    }

    const exists = existsSync(absolutePath);
    if (edit.changeType === "update" && !exists) {
      throw new Error(`Cannot update missing file "${edit.path}"`);
    }

    if (edit.changeType === "create" && exists) {
      throw new Error(`Cannot create existing file "${edit.path}"`);
    }
  }

  const appliedEdits = plan.edits.map((edit) => {
    const absolutePath = resolveEditablePath(edit.path, baseDir);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, edit.content, "utf-8");

    return {
      path: edit.path,
      changeType: edit.changeType,
      bytesWritten: Buffer.byteLength(edit.content, "utf-8"),
    };
  });

  return {
    summary: plan.summary,
    edits: appliedEdits,
    validationCommand: plan.validationCommand,
    validationOutcome: "not_run",
    unexpectedChangedFiles: [],
    isolationMode: "direct",
  };
}

export function loadEditableFileContexts(files: string[], baseDir?: string): EditableFileContext[] {
  return editableFileContextLoader(files, baseDir);
}

export function applyCodePatchPlan(
  plan: CodePatchPlan,
  requestedFiles: string[],
  baseDir?: string,
): AppliedCodePatchResult {
  return codePatchApplier(plan, requestedFiles, baseDir);
}

export function setEditableFileContextLoaderForTesting(
  loader?: EditableFileContextLoader,
): void {
  editableFileContextLoader = loader ?? defaultLoadEditableFileContexts;
}

export function setCodePatchApplierForTesting(applier?: CodePatchApplier): void {
  codePatchApplier = applier ?? defaultApplyCodePatchPlan;
}
