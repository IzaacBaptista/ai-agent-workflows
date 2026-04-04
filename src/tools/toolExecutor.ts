import { z } from "zod";
import { WorkflowToolName, WorkflowToolRequest, WorkflowToolResult } from "../core/types";
import { ApiResponse, callExternalApi } from "./externalApiTool";
import { CodeSearchResult, searchCode } from "./codeSearchTool";
import { FileReadResult, readFiles } from "./readFileTool";

const searchCodeInputSchema = z.object({
  terms: z.array(z.string().trim().min(1)).min(1),
});

const readFileInputSchema = z.object({
  files: z.array(z.string().trim().min(1)).min(1),
});

const externalApiInputSchema = z.object({
  endpoint: z.string().trim().min(1),
});

const toolSchemas = {
  search_code: searchCodeInputSchema,
  read_file: readFileInputSchema,
  call_external_api: externalApiInputSchema,
} satisfies Record<WorkflowToolName, z.ZodTypeAny>;

type ValidatedToolInputMap = {
  search_code: z.infer<typeof searchCodeInputSchema>;
  read_file: z.infer<typeof readFileInputSchema>;
  call_external_api: z.infer<typeof externalApiInputSchema>;
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

  const parsed = externalApiInputSchema.parse(request.input);
  const data = await callExternalApi(parsed.endpoint);

  return {
    tool: "call_external_api",
    summary: buildExternalApiSummary(data),
    data,
    signature: buildWorkflowToolSignature("call_external_api", parsed),
  };
}
