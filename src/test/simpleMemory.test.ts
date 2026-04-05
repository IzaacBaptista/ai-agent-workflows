import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { env } from "../config/env";
import { buildRelevantMemoryContext } from "../memory/runMemoryStore";
import { getAllRunMemories, resetRunMemories } from "../memory/simpleMemory";

const runStorageDir = resolve(process.cwd(), env.RUN_STORAGE_DIR);

test("simpleMemory ignores non-run JSON files in the persisted run directory", () => {
  resetRunMemories({ clearPersistedRuns: true });

  const supportFilePath = join(runStorageDir, "llm-rate-limit.json");
  mkdirSync(dirname(supportFilePath), { recursive: true });
  writeFileSync(
    supportFilePath,
    JSON.stringify({
      openUntil: Date.now() + 5000,
      reason: "provider_rate_limit",
      updatedAt: new Date().toISOString(),
    }),
    "utf-8",
  );

  try {
    resetRunMemories();

    assert.deepEqual(getAllRunMemories(), []);
    assert.doesNotThrow(() =>
      buildRelevantMemoryContext("IssueWorkflow", "planner keeps retrying search_code"),
    );
  } finally {
    resetRunMemories({ clearPersistedRuns: true });
  }
});
