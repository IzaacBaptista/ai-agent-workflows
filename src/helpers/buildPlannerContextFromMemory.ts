import { RelevantMemoryContext } from "../core/types";

export function buildPlannerContextFromMemory(memoryContext: RelevantMemoryContext): string {
  return [
    "Relevant memory",
    memoryContext.summary,
    "",
    `Memory hits: ${memoryContext.memoryHits}`,
  ].join("\n");
}
