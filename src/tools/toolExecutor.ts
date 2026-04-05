import { z } from "zod";
import {
  CommandExecutionResult,
  GitDiffResult,
  GitStatusResult,
  WorkflowCommandName,
  WorkflowToolName,
  WorkflowToolRequest,
  WorkflowToolResult,
} from "../core/types";
import { ApiResponse, callExternalApi } from "./externalApiTool";
import { CodeSearchResult, searchCode } from "./codeSearchTool";
import { getGitDiff, getGitStatus } from "./gitTool";
import { FileReadResult, getReadFileValidationError, readFiles } from "./readFileTool";
import { getAllowedCommandNames, isAllowedCommandName, runAllowedCommand } from "./runCommandTool";

const searchCodeInputSchema = z.object({
  terms: z.array(z.string().trim().min(1)).min(1),
});

const readFileInputSchema = z.object({
  files: z.array(z.string().trim().min(1)).min(1),
});

const externalApiInputSchema = z.object({
  endpoint: z.string().trim().min(1),
});

const gitStatusInputSchema = z.object({});

const gitDiffInputSchema = z.object({
  staged: z.boolean().optional().default(false),
});

const runCommandInputSchema = z.object({
  command: z.string().trim().min(1),
}).superRefine((value, ctx) => {
  if (!isAllowedCommandName(value.command)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsupported command "${value.command}". Allowed commands: ${getAllowedCommandNames().join(", ")}`,
    });
  }
});

const toolSchemas = {
  search_code: searchCodeInputSchema,
  read_file: readFileInputSchema,
  call_external_api: externalApiInputSchema,
  run_command: runCommandInputSchema,
  git_status: gitStatusInputSchema,
  git_diff: gitDiffInputSchema,
} satisfies Record<WorkflowToolName, z.ZodTypeAny>;

type ValidatedToolInputMap = {
  search_code: z.infer<typeof searchCodeInputSchema>;
  read_file: z.infer<typeof readFileInputSchema>;
  call_external_api: z.infer<typeof externalApiInputSchema>;
  run_command: z.infer<typeof runCommandInputSchema>;
  git_status: z.infer<typeof gitStatusInputSchema>;
  git_diff: z.infer<typeof gitDiffInputSchema>;
};

function buildSearchCodeSummary(results: Record<string, CodeSearchResult[]>): string {
  const matches = Object.values(results).reduce((total, entries) => total + entries.length, 0);
  return `terms=${Object.keys(results).length},matches=${matches}`;
}

function buildReadFileSummary(results: FileReadResult[]): string {
  return `files=${results.length}`;
}

function buildExternalApiSummary(result: ApiResponse): string {
  return `status=${result.status}`;
}

function buildRunCommandSummary(result: CommandExecutionResult): string {
  return `command=${result.command},exitCode=${result.exitCode ?? "null"},timedOut=${result.timedOut}`;
}

function buildGitStatusSummary(result: GitStatusResult): string {
  return `entries=${result.entries.length}`;
}

function buildGitDiffSummary(result: GitDiffResult): string {
  return `files=${result.changedFiles.length},staged=${result.staged},truncated=${result.truncated}`;
}

export function getRegisteredToolNames(): WorkflowToolName[] {
  return Object.keys(toolSchemas) as WorkflowToolName[];
}

export function isRegisteredWorkflowTool(value: string): value is WorkflowToolName {
  return value in toolSchemas;
}

export function validateWorkflowToolInput(
  toolName: WorkflowToolName,
  input: unknown,
): { success: true; data: ValidatedToolInputMap[WorkflowToolName] } | { success: false; error: string } {
  const schema = toolSchemas[toolName];
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.message,
    };
  }

  if (toolName === "read_file") {
    const readFileInput = readFileInputSchema.parse(parsed.data);
    const readFileError = getReadFileValidationError(readFileInput.files);
    if (readFileError) {
      return {
        success: false,
        error: readFileError,
      };
    }
  }

  return { success: true, data: parsed.data };
}

export function buildWorkflowToolSignature(toolName: WorkflowToolName, input: unknown): string {
  const normalize = (values: string[]) => values.map((value) => value.trim().toLowerCase()).sort().join("|");

  if (toolName === "search_code") {
    const parsed = searchCodeInputSchema.parse(input);
    return `${toolName}:${normalize(parsed.terms)}`;
  }

  if (toolName === "read_file") {
    const parsed = readFileInputSchema.parse(input);
    return `${toolName}:${normalize(parsed.files)}`;
  }

  if (toolName === "run_command") {
    const parsed = runCommandInputSchema.parse(input);
    return `${toolName}:${parsed.command.trim().toLowerCase()}`;
  }

  if (toolName === "git_status") {
    gitStatusInputSchema.parse(input);
    return "git_status:working_tree";
  }

  if (toolName === "git_diff") {
    const parsed = gitDiffInputSchema.parse(input);
    return `${toolName}:${parsed.staged ? "staged" : "working_tree"}`;
  }

  const parsed = externalApiInputSchema.parse(input);
  return `${toolName}:${parsed.endpoint.trim().toLowerCase()}`;
}

export async function executeWorkflowTool(request: WorkflowToolRequest): Promise<WorkflowToolResult> {
  if (request.toolName === "search_code") {
    const parsed = searchCodeInputSchema.parse(request.input);
    const data = Object.fromEntries(
      parsed.terms.map((term) => [term, searchCode(term)]),
    ) as Record<string, CodeSearchResult[]>;

    return {
      tool: "search_code",
      summary: buildSearchCodeSummary(data),
      data,
      signature: buildWorkflowToolSignature("search_code", parsed),
    };
  }

  if (request.toolName === "read_file") {
    const parsed = readFileInputSchema.parse(request.input);
    const data = readFiles(parsed.files);

    return {
      tool: "read_file",
      summary: buildReadFileSummary(data),
      data,
      signature: buildWorkflowToolSignature("read_file", parsed),
    };
  }

  if (request.toolName === "run_command") {
    const parsed = runCommandInputSchema.parse(request.input);
    const data = await runAllowedCommand(parsed.command as WorkflowCommandName);

    return {
      tool: "run_command",
      summary: buildRunCommandSummary(data),
      data,
      signature: buildWorkflowToolSignature("run_command", parsed),
    };
  }

  if (request.toolName === "git_status") {
    const parsed = gitStatusInputSchema.parse(request.input);
    const data = await getGitStatus();

    return {
      tool: "git_status",
      summary: buildGitStatusSummary(data),
      data,
      signature: buildWorkflowToolSignature("git_status", parsed),
    };
  }

  if (request.toolName === "git_diff") {
    const parsed = gitDiffInputSchema.parse(request.input);
    const data = await getGitDiff(parsed.staged);

    return {
      tool: "git_diff",
      summary: buildGitDiffSummary(data),
      data,
      signature: buildWorkflowToolSignature("git_diff", parsed),
    };
  }

  const parsed = externalApiInputSchema.parse(request.input);
  const data = await callExternalApi(parsed.endpoint);

  return {
    tool: "call_external_api",
    summary: buildExternalApiSummary(data),
    data,
    signature: buildWorkflowToolSignature("call_external_api", parsed),
  };
}
