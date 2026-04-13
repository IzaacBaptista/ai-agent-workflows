import { GitLogResult, GitStatusResult, IssueTriage } from "../core/types";
import { CodeSearchResult, searchCode } from "../tools/codeSearchTool";
import { FileReadResult, getReadFileValidationError, readFiles } from "../tools/readFileTool";
import { getGitLog, getGitStatus } from "../tools/gitTool";
import {
  summarizeCodeSearchResults,
  summarizeFileReadResults,
  summarizeGitLogResult,
  summarizeGitStatusResult,
} from "./contextSummary";

const MAX_SEARCH_TERMS = 5;
const MAX_FILE_CANDIDATES = 3;
const LOG_MAX_COMMITS = 10;
const FILE_PATH_PATTERN = /\.(ts|tsx|js|jsx|json|md|py|go|java|rb|php|yaml|yml|sh)$/;

export interface CollectedContext {
  codeSearchResults: Record<string, CodeSearchResult[]>;
  fileReadResults: FileReadResult[];
  gitStatus: GitStatusResult;
  gitLog: GitLogResult;
}

export async function collectTriageContext(triage: IssueTriage): Promise<CollectedContext> {
  const codeSearchResults: Record<string, CodeSearchResult[]> = {};
  for (const term of triage.codeSearchTerms.slice(0, MAX_SEARCH_TERMS)) {
    codeSearchResults[term] = searchCode(term);
  }

  const fileCandidates = triage.investigationAreas
    .filter((area) => FILE_PATH_PATTERN.test(area))
    .slice(0, MAX_FILE_CANDIDATES);

  let fileReadResults: FileReadResult[] = [];
  if (fileCandidates.length > 0 && !getReadFileValidationError(fileCandidates)) {
    try {
      fileReadResults = readFiles(fileCandidates);
    } catch {
      // best-effort: skip files that cannot be read
    }
  }

  const emptyGitStatus: GitStatusResult = { entries: [], raw: "" };
  const emptyGitLog: GitLogResult = { commits: [], truncated: false };

  const [gitStatus, gitLog] = await Promise.all([
    getGitStatus().catch(() => emptyGitStatus),
    getGitLog(undefined, LOG_MAX_COMMITS).catch(() => emptyGitLog),
  ]);

  return { codeSearchResults, fileReadResults, gitStatus, gitLog };
}

export function formatCollectedContext(context: CollectedContext): string {
  return [
    ...summarizeCodeSearchResults(context.codeSearchResults),
    "",
    ...summarizeFileReadResults(context.fileReadResults),
    "",
    ...summarizeGitStatusResult(context.gitStatus),
    "",
    ...summarizeGitLogResult(context.gitLog),
  ].join("\n");
}
