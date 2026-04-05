import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, extname, resolve } from "path";
import {
  AppliedCodePatchResult,
  CodePatchPlan,
  EditableFileContext,
} from "../core/types";

const ALLOWED_EDIT_EXTENSIONS = new Set([".ts", ".js", ".json", ".md", ".sh"]);
const ALLOWED_EDIT_ROOTS = [
  resolve(process.cwd(), "src"),
  resolve(process.cwd(), "prompts"),
  resolve(process.cwd(), "docs"),
  resolve(process.cwd(), "evals"),
  resolve(process.cwd(), "scripts"),
];
const ALLOWED_EDIT_FILES = new Set([
  resolve(process.cwd(), "README.md"),
  resolve(process.cwd(), "package.json"),
  resolve(process.cwd(), "tsconfig.json"),
]);

type EditableFileContextLoader = (files: string[]) => EditableFileContext[];
type CodePatchApplier = (plan: CodePatchPlan, requestedFiles: string[]) => AppliedCodePatchResult;

let editableFileContextLoader: EditableFileContextLoader = defaultLoadEditableFileContexts;
let codePatchApplier: CodePatchApplier = defaultApplyCodePatchPlan;

function isAllowedEditPath(absolutePath: string): boolean {
  if (ALLOWED_EDIT_FILES.has(absolutePath)) {
    return true;
  }

  return ALLOWED_EDIT_ROOTS.some(
    (allowedRoot) => absolutePath === allowedRoot || absolutePath.startsWith(`${allowedRoot}/`),
  );
}

function resolveEditablePath(file: string): string {
  const absolutePath = resolve(file);
  const extension = extname(absolutePath);

  if (!isAllowedEditPath(absolutePath)) {
    throw new Error(`File "${file}" is outside the allowed edit scope`);
  }

  if (!ALLOWED_EDIT_EXTENSIONS.has(extension) && !ALLOWED_EDIT_FILES.has(absolutePath)) {
    throw new Error(`File "${file}" has unsupported extension "${extension}"`);
  }

  return absolutePath;
}

function defaultLoadEditableFileContexts(
  files: string[],
  maxFiles = 3,
  maxCharsPerFile = 16_000,
): EditableFileContext[] {
  const uniqueFiles = Array.from(new Set(files)).slice(0, maxFiles);

  return uniqueFiles.map((file) => {
    const absolutePath = resolveEditablePath(file);
    const exists = existsSync(absolutePath);
    const content = exists ? readFileSync(absolutePath, "utf-8") : "";

    if (content.length > maxCharsPerFile) {
      throw new Error(`Editable file "${file}" exceeds the maximum supported size for edit_patch`);
    }

    return {
      path: absolutePath,
      exists,
      content,
    };
  });
}

function defaultApplyCodePatchPlan(
  plan: CodePatchPlan,
  requestedFiles: string[],
): AppliedCodePatchResult {
  const requestedPaths = new Set(requestedFiles.map((file) => resolveEditablePath(file)));

  for (const edit of plan.edits) {
    const absolutePath = resolveEditablePath(edit.path);
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
    const absolutePath = resolveEditablePath(edit.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, edit.content, "utf-8");

    return {
      path: absolutePath,
      changeType: edit.changeType,
      bytesWritten: Buffer.byteLength(edit.content, "utf-8"),
    };
  });

  return {
    summary: plan.summary,
    edits: appliedEdits,
    validationCommand: plan.validationCommand,
  };
}

export function loadEditableFileContexts(files: string[]): EditableFileContext[] {
  return editableFileContextLoader(files);
}

export function applyCodePatchPlan(
  plan: CodePatchPlan,
  requestedFiles: string[],
): AppliedCodePatchResult {
  return codePatchApplier(plan, requestedFiles);
}

export function setEditableFileContextLoaderForTesting(
  loader?: EditableFileContextLoader,
): void {
  editableFileContextLoader = loader ?? defaultLoadEditableFileContexts;
}

export function setCodePatchApplierForTesting(applier?: CodePatchApplier): void {
  codePatchApplier = applier ?? defaultApplyCodePatchPlan;
}
