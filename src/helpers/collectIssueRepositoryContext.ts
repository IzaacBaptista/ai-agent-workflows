import { relative, resolve } from "path";
import { IssueRepositoryContext } from "../core/types";
import { JiraIssue } from "../integrations/jira/jiraTypes";
import { getGitDiffAt, getGitStatusAt } from "../tools/gitTool";
import { readFiles } from "../tools/readFileTool";
import { searchCode } from "../tools/codeSearchTool";

const STOP_WORDS = new Set([
  "about",
  "after",
  "ainda",
  "algo",
  "algum",
  "alguma",
  "algumas",
  "alguns",
  "apenas",
  "assim",
  "banco",
  "cada",
  "como",
  "com",
  "como",
  "comum",
  "das",
  "deve",
  "deveria",
  "dos",
  "ela",
  "eles",
  "entre",
  "essa",
  "esse",
  "esta",
  "está",
  "este",
  "fazer",
  "foi",
  "from",
  "have",
  "isso",
  "isto",
  "mais",
  "mas",
  "mesmo",
  "muito",
  "nao",
  "não",
  "need",
  "nos",
  "nós",
  "numa",
  "num",
  "para",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "pois",
  "por",
  "porque",
  "precisa",
  "quando",
  "ser",
  "sem",
  "seu",
  "seus",
  "sua",
  "suas",
  "sobre",
  "that",
  "this",
  "the",
  "uma",
  "umas",
  "uns",
  "with",
]);

function trimEmpty(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizePath(filePath: string, baseDir: string): string {
  const relativePath = relative(baseDir, filePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : filePath;
}

function extractQuotedTerms(value: string): string[] {
  return Array.from(value.matchAll(/["'`“”‘’]([^"'`“”‘’]{3,})["'`“”‘’]/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter((match) => match.length > 0);
}

function extractTokenTerms(value: string): string[] {
  return value
    .split(/[^a-z0-9_/-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token.toLowerCase()))
    .filter((token) => !/^\d+$/.test(token));
}

export function deriveIssueSearchTerms(issue: JiraIssue, limit = 8): string[] {
  const weightedTerms = [
    ...extractQuotedTerms(issue.summary),
    ...extractQuotedTerms(issue.description),
    ...issue.labels,
    ...issue.components,
    ...extractTokenTerms(issue.summary),
    ...extractTokenTerms(issue.description).slice(0, 12),
  ];

  return uniqueStrings(trimEmpty(weightedTerms)).slice(0, limit);
}

function summarizeSearchResults(
  codeSearchResults: IssueRepositoryContext["codeSearchResults"],
  baseDir: string,
): string[] {
  const lines = ["Code search results:"];

  for (const [term, matches] of Object.entries(codeSearchResults)) {
    if (matches.length === 0) {
      lines.push(`- ${term}: no matches`);
      continue;
    }

    lines.push(`- ${term}:`);
    for (const match of matches.slice(0, 3)) {
      lines.push(`  - ${normalizePath(match.file, baseDir)}:${match.line}`);
      lines.push(`    ${match.snippet.replace(/\s+/g, " ").trim()}`);
    }
  }

  return lines;
}

function summarizeFileReads(
  fileReadResults: IssueRepositoryContext["fileReadResults"],
  baseDir: string,
): string[] {
  const lines = ["Candidate file excerpts:"];

  if (fileReadResults.length === 0) {
    lines.push("- no files were selected for direct reading");
    return lines;
  }

  for (const entry of fileReadResults) {
    lines.push(`- ${normalizePath(entry.file, baseDir)}`);
    lines.push("```");
    lines.push(entry.content.trim());
    lines.push("```");
  }

  return lines;
}

function summarizeGitStatus(
  gitStatus: IssueRepositoryContext["gitStatus"],
): string[] {
  if (gitStatus.entries.length === 0) {
    return ["Git status:", "- working tree clean"];
  }

  return [
    "Git status:",
    ...gitStatus.entries.slice(0, 10).map(
      (entry) => `- ${entry.indexStatus}${entry.workingTreeStatus} ${entry.path}`,
    ),
  ];
}

function summarizeGitDiff(
  gitDiff: IssueRepositoryContext["gitDiff"],
): string[] {
  if (!gitDiff.diff) {
    return ["Git diff:", "- no local diff"];
  }

  return [
    "Git diff preview:",
    "```diff",
    gitDiff.diff.trim(),
    "```",
  ];
}

export async function collectIssueRepositoryContext(
  issue: JiraIssue,
  baseDir = process.cwd(),
): Promise<IssueRepositoryContext> {
  const repoRoot = resolve(baseDir);
  const searchTerms = deriveIssueSearchTerms(issue);
  const codeSearchResults = Object.fromEntries(
    searchTerms.map((term) => [term, searchCode(term, 5, repoRoot)]),
  ) as IssueRepositoryContext["codeSearchResults"];

  const relevantFiles = uniqueStrings(
    Object.values(codeSearchResults)
      .flatMap((matches) => matches.map((match) => normalizePath(match.file, repoRoot))),
  ).slice(0, 5);

  const fileReadResults = readFiles(relevantFiles, 3, 2400, repoRoot).map((entry) => ({
    file: normalizePath(entry.file, repoRoot),
    content: entry.content,
  }));

  const gitStatus = await getGitStatusAt(repoRoot);
  const gitDiff = await getGitDiffAt(repoRoot, false);

  const summary =
    relevantFiles.length > 0
      ? `Collected repository evidence from ${relevantFiles.length} relevant file(s).`
      : "Collected Jira context and repository state, but no direct file match was found.";

  const promptContext = [
    `Repository root: ${repoRoot}`,
    `Derived search terms: ${searchTerms.join(", ") || "none"}`,
    "",
    ...summarizeSearchResults(codeSearchResults, repoRoot),
    "",
    ...summarizeFileReads(fileReadResults, repoRoot),
    "",
    ...summarizeGitStatus(gitStatus),
    "",
    ...summarizeGitDiff(gitDiff),
  ].join("\n");

  return {
    summary,
    searchTerms,
    relevantFiles,
    codeSearchResults,
    fileReadResults,
    gitStatus,
    gitDiff,
    promptContext,
  };
}
