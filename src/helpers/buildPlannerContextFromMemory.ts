import { RelevantMemoryContext } from "../core/types";

export function buildPlannerContextFromMemory(memoryContext: RelevantMemoryContext): string {
  return [
    "Relevant memory",
    memoryContext.summary,
    "",
    `Command patterns: ${memoryContext.commandPatterns.join(", ") || "none"}`,
    "",
    `Memory hits: ${memoryContext.memoryHits}`,
  ].join("\n");
}
