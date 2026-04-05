import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  GitDiffResult,
  GitStatusResult,
  RuntimeAction,
  WorkflowExecutionMeta,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowValidationError,
} from "../core/types";
import { CodeSearchResult } from "../tools/codeSearchTool";
import { FileReadResult } from "../tools/readFileTool";

const DEFAULT_TEXT_LIMIT = 220;

function truncateText(value: string, limit = DEFAULT_TEXT_LIMIT): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

function summarizeOverflow(count: number, label: string): string[] {
  return count > 0 ? [`- ... ${count} more ${label}`] : [];
}

export function summarizeStringList(
  title: string,
  items: string[] | undefined,
  options: { maxItems?: number; emptyLabel?: string } = {},
): string[] {
  const maxItems = options.maxItems ?? 5;
  const values = (items ?? []).filter((item) => item.trim().length > 0);

  if (values.length === 0) {
    return [title, `- ${options.emptyLabel ?? "None"}`];
  }

  return [
    title,
    ...values.slice(0, maxItems).map((item) => `- ${truncateText(item, 180)}`),
    ...summarizeOverflow(values.length - maxItems, "items"),
  ];
}

export function summarizeCodeSearchResults(
  results: Record<string, CodeSearchResult[]> | undefined,
): string[] {
  const entries = Object.entries(results ?? {});

  if (entries.length === 0) {
    return ["Code search results:", "- None"];
  }

  const lines = ["Code search results:"];

  for (const [term, matches] of entries.slice(0, 4)) {
    if (matches.length === 0) {
      lines.push(`- ${term}: no matches found`);
      continue;
    }

    lines.push(`- ${term}: ${matches.length} matches`);
    for (const match of matches.slice(0, 2)) {
      lines.push(
        `  - ${match.file}:${match.line} ${truncateText(match.snippet, 160)}`,
      );
    }
    lines.push(...summarizeOverflow(matches.length - 2, "matches"));
  }

  lines.push(...summarizeOverflow(entries.length - 4, "queries"));
  return lines;
}

export function summarizeFileReadResults(results: FileReadResult[] | undefined): string[] {
  const files = results ?? [];
  if (files.length === 0) {
    return ["Read file results:", "- None"];
  }

  return [
    "Read file results:",
    ...files.slice(0, 3).map((file) => `- ${file.file}: ${truncateText(file.content, 280)}`),
    ...summarizeOverflow(files.length - 3, "files"),
  ];
}

export function summarizePatchResults(results: AppliedCodePatchResult[] | undefined): string[] {
  const patches = results ?? [];
  if (patches.length === 0) {
    return ["Applied patches:", "- None"];
  }

  const lines = ["Applied patches:"];
  for (const patch of patches.slice(0, 2)) {
    lines.push(
      `- ${truncateText(patch.summary, 180)} outcome=${patch.validationOutcome} unexpectedChangedFiles=${patch.unexpectedChangedFiles.length} cleanup=${patch.worktreeCleanedUp === false ? "failed" : "ok"}`,
    );
    for (const edit of patch.edits.slice(0, 3)) {
      lines.push(`  - ${edit.changeType} ${edit.path} bytes=${edit.bytesWritten}`);
    }
    lines.push(...summarizeOverflow(patch.edits.length - 3, "edits"));

    if (patch.gitDiff) {
      lines.push(
        `  - diff files=${patch.gitDiff.changedFiles.length} truncated=${patch.gitDiff.truncated}`,
      );
      for (const changedFile of patch.gitDiff.changedFiles.slice(0, 4)) {
        lines.push(`    - ${changedFile}`);
      }
      lines.push(...summarizeOverflow(patch.gitDiff.changedFiles.length - 4, "changed files"));
    }
  }

  lines.push(...summarizeOverflow(patches.length - 2, "patches"));
  return lines;
}

export function summarizeCommandResults(results: CommandExecutionResult[] | undefined): string[] {
  const commands = results ?? [];
  if (commands.length === 0) {
    return ["Command results:", "- None"];
  }

  return [
    "Command results:",
    ...commands.slice(0, 3).map(
      (result) =>
        `- ${result.command}: exitCode=${result.exitCode ?? "null"} timedOut=${result.timedOut} stdout=${truncateText(result.stdout, 120)} stderr=${truncateText(result.stderr, 120)}`,
    ),
    ...summarizeOverflow(commands.length - 3, "command results"),
  ];
}

export function summarizeGitStatusResult(result: GitStatusResult | undefined): string[] {
  if (!result) {
    return ["Git status:", "- None"];
  }

  if (result.entries.length === 0) {
    return ["Git status:", "- clean working tree"];
  }

  return [
    "Git status:",
    ...result.entries.slice(0, 8).map(
      (entry) => `- ${entry.indexStatus}${entry.workingTreeStatus} ${entry.path}`,
    ),
    ...summarizeOverflow(result.entries.length - 8, "status entries"),
  ];
}

export function summarizeGitDiffResult(result: GitDiffResult | undefined): string[] {
  if (!result) {
    return ["Git diff:", "- None"];
  }

  return [
    "Git diff:",
    `- staged=${result.staged} files=${result.changedFiles.length} truncated=${result.truncated}`,
    ...result.changedFiles.slice(0, 6).map((file) => `- ${file}`),
    ...summarizeOverflow(result.changedFiles.length - 6, "changed files"),
    `- preview: ${truncateText(result.diff, 240) || "no diff output"}`,
  ];
}

export function summarizeUnknownValue(title: string, value: unknown, emptyLabel = "None"): string[] {
  if (value == null) {
    return [title, `- ${emptyLabel}`];
  }

  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return [title, `- ${truncateText(serialized, 240)}`];
}

function formatRuntimeAction(action: RuntimeAction): string {
  if (action.type === "tool_call") {
    return `tool_call(${action.toolName})`;
  }

  if (action.type === "delegate") {
    return `delegate(${action.targetAgent})`;
  }

  return action.type;
}

function formatStep(step: WorkflowStepRecord): string {
  const label =
    step.name === "tool_call" && step.toolName
      ? `tool_call(${step.toolName})`
      : step.name === "delegate" && step.targetAgent
        ? `delegate(${step.targetAgent})`
        : step.name;
  const status = step.blocked ? "blocked" : step.status;
  const detail = step.blocked
    ? step.outputSummary
    : step.status === "failed"
      ? step.error
      : step.outputSummary;

  return `${label}: ${status}${detail ? ` (${truncateText(detail, 140)})` : ""}`;
}

export function summarizeRuntimeBudget(
  run: WorkflowRunRecord,
  meta: WorkflowExecutionMeta,
): string[] {
  const remainingSteps = Math.max(run.policy.maxSteps - run.steps.length, 0);
  const remainingToolCalls = Math.max(run.policy.maxToolCalls - meta.toolCallCount, 0);
  const remainingEditActions = Math.max(run.policy.maxEditActionsPerRun - meta.editActionCount, 0);
  const pressure =
    remainingSteps <= 1 ? "high" : remainingSteps <= 3 ? "medium" : "normal";

  return [
    "Execution budget:",
    `- steps=${run.steps.length}/${run.policy.maxSteps} remaining=${remainingSteps} pressure=${pressure}`,
    `- toolCalls=${meta.toolCallCount}/${run.policy.maxToolCalls} remaining=${remainingToolCalls}`,
    `- editActions=${meta.editActionCount}/${run.policy.maxEditActionsPerRun} remaining=${remainingEditActions}`,
  ];
}

export function summarizeEvidenceOverview(run: WorkflowRunRecord): string[] {
  const evidence: string[] = [];

  if (run.artifacts.codeSearchResults) {
    evidence.push("code_search_results");
  }

  if (run.artifacts.fileReadResults) {
    evidence.push("file_read_results");
  }

  if (run.artifacts.commandResults) {
    evidence.push("command_results");
  }

  if (run.artifacts.patchResults) {
    evidence.push("patch_results");
  }

  if (run.artifacts.gitStatusResult) {
    evidence.push("git_status_result");
  }

  if (run.artifacts.gitDiffResult) {
    evidence.push("git_diff_result");
  }

  if (evidence.length === 0) {
    return ["Evidence on hand:", "- none"];
  }

  return ["Evidence on hand:", ...evidence.map((item) => `- ${item}`)];
}

export function summarizeRecentSteps(
  steps: WorkflowStepRecord[],
  maxItems = 5,
): string[] {
  if (steps.length === 0) {
    return ["Recent steps:", "- none"];
  }

  const recentSteps = steps.slice(-maxItems);
  return [
    "Recent steps:",
    ...recentSteps.map((step) => `- ${formatStep(step)}`),
    ...summarizeOverflow(steps.length - recentSteps.length, "earlier steps"),
  ];
}

export function summarizeValidationErrors(
  errors: WorkflowValidationError[] | undefined,
  maxItems = 4,
): string[] {
  const values = errors ?? [];
  if (values.length === 0) {
    return ["Validation errors:", "- none"];
  }

  return [
    "Validation errors:",
    ...values.slice(-maxItems).map((entry) => `- ${truncateText(entry.kind + ": " + entry.message, 180)}`),
    ...summarizeOverflow(values.length - Math.min(values.length, maxItems), "earlier validation errors"),
  ];
}

export function summarizeRemainingActions(actions: RuntimeAction[], maxItems = 5): string[] {
  if (actions.length === 0) {
    return ["Remaining actions:", "- none"];
  }

  return [
    "Remaining actions:",
    ...actions.slice(0, maxItems).map((action) => {
      if (action.type === "tool_call") {
        return `- ${formatRuntimeAction(action)}: ${truncateText(action.reason, 120)}`;
      }

      if ("task" in action) {
        return `- ${formatRuntimeAction(action)}: ${truncateText(action.task, 120)}`;
      }

      return `- ${formatRuntimeAction(action)}: ${truncateText(action.reason, 120)}`;
    }),
    ...summarizeOverflow(actions.length - maxItems, "queued actions"),
  ];
}

export function summarizeCompletedAction(action: unknown): string[] {
  const serialized = typeof action === "string" ? action : JSON.stringify(action);
  return ["Completed action:", `- ${truncateText(serialized, 220)}`];
}
