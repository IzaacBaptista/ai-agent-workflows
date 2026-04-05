import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  GitDiffResult,
  GitStatusResult,
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
