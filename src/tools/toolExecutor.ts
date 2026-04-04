import { WorkflowToolRequest, WorkflowToolResult } from "../core/types";
import { searchCode, CodeSearchResult } from "./codeSearchTool";
import { readFiles, FileReadResult } from "./readFileTool";
import { callExternalApi, ApiResponse } from "./externalApiTool";

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

export async function executeWorkflowTool(request: WorkflowToolRequest): Promise<WorkflowToolResult> {
  if (request.tool === "search_code") {
    const terms = request.terms ?? [];
    const data = Object.fromEntries(
      terms.map((term) => [term, searchCode(term)]),
    ) as Record<string, CodeSearchResult[]>;

    return {
      tool: "search_code",
      summary: buildSearchCodeSummary(data),
      data,
    };
  }

  if (request.tool === "read_file") {
    const files = request.files ?? [];
    const data = readFiles(files);

    return {
      tool: "read_file",
      summary: buildReadFileSummary(data),
      data,
    };
  }

  const endpoint = request.endpoint ?? "health";
  const data = await callExternalApi(endpoint);

  return {
    tool: "call_external_api",
    summary: buildExternalApiSummary(data),
    data,
  };
}
