import { RelevantMemoryContext } from "../core/types";

export function buildPlannerContextFromMemory(memoryContext: RelevantMemoryContext): string {
  return [
    "Relevant memory",
    memoryContext.summary,
    "",
    `Patch patterns: ${memoryContext.patchPatterns.join(", ") || "none"}`,
    "",
    `Command patterns: ${memoryContext.commandPatterns.join(", ") || "none"}`,
    "",
    `Memory hits: ${memoryContext.memoryHits}`,
  ].join("\n");
}
