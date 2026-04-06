import test from "node:test";
import assert from "node:assert/strict";
import { buildGitHubPRReviewInput } from "../helpers/buildGitHubPRReviewInput";

function buildLargeDiff(fileCount: number): string {
  return Array.from({ length: fileCount }, (_, index) => {
    const fileName = `src/feature/file-${index + 1}.ts`;
    const patch = `@@ -1,1 +1,40 @@\n-${"old line ".repeat(80)}\n+${"new line ".repeat(120)}`;
    return `--- ${fileName} (modified, +40/-1)\n${patch}`;
  }).join("\n\n");
}

test("buildGitHubPRReviewInput truncates oversized PR payloads and summarizes changed files", () => {
  const output = buildGitHubPRReviewInput({
    repository: "owner/repo",
    prNumber: 10,
    title: "feat: large pull request",
    description: "A".repeat(6000),
    diff: buildLargeDiff(24),
  });

  assert.match(output, /Changed files: 24/);
  assert.match(output, /additional file\(s\) omitted/);
  assert.match(output, /Patch excerpts:/);
  assert.match(output, /Description was truncated for planner input/);
  assert.match(output, /Diff was truncated for planner input/);
  assert.ok(output.length < 18000);
});
