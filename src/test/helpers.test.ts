import test from "node:test";
import assert from "node:assert/strict";
import { buildGitHubPRReviewInput } from "../helpers/buildGitHubPRReviewInput";
import { buildPlannerContextFromMemory } from "../helpers/buildPlannerContextFromMemory";
import { buildWorkflowActionGuidance } from "../helpers/buildWorkflowActionGuidance";
import { formatPRReviewComment } from "../helpers/formatPRReviewComment";
import { RelevantMemoryContext, PRReview } from "../core/types";

// ─── buildGitHubPRReviewInput ────────────────────────────────────────────────

test("buildGitHubPRReviewInput formats PR fields into a string", () => {
  const input = buildGitHubPRReviewInput({
    repository: "owner/repo",
    prNumber: 42,
    title: "Fix authentication bug",
    description: "Resolves null pointer in auth middleware",
    diff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1,3 +1,4 @@",
  });

  assert.match(input, /Repository: owner\/repo/);
  assert.match(input, /PR Number: 42/);
  assert.match(input, /Title: Fix authentication bug/);
  assert.match(input, /Description:\s*\nResolves null pointer in auth middleware/);
  assert.match(input, /Patch excerpts:/);
  assert.match(input, /--- a\/src\/auth\.ts/);
});

test("buildGitHubPRReviewInput handles empty description and diff", () => {
  const input = buildGitHubPRReviewInput({
    repository: "org/project",
    prNumber: 1,
    title: "Initial commit",
    description: "",
    diff: "",
  });

  assert.match(input, /Repository: org\/project/);
  assert.match(input, /PR Number: 1/);
  assert.match(input, /Title: Initial commit/);
  assert.match(input, /Description:\s*\n/);
});

// ─── formatPRReviewComment ───────────────────────────────────────────────────

test("formatPRReviewComment renders all sections when populated", () => {
  const review: PRReview = {
    summary: "The PR looks good overall.",
    impacts: ["Adds new auth middleware", "Breaks existing session handling"],
    risks: ["May affect login flow"],
    suggestions: ["Add integration tests", "Update docs"],
    testRecommendations: ["Test auth flow end-to-end"],
  };

  const comment = formatPRReviewComment(review);

  assert.match(comment, /## 🤖 AI PR Review/);
  assert.match(comment, /### Summary/);
  assert.match(comment, /The PR looks good overall\./);
  assert.match(comment, /### Impacts/);
  assert.match(comment, /- Adds new auth middleware/);
  assert.match(comment, /- Breaks existing session handling/);
  assert.match(comment, /### Risks/);
  assert.match(comment, /- May affect login flow/);
  assert.match(comment, /### Suggestions/);
  assert.match(comment, /- Add integration tests/);
  assert.match(comment, /### Test Recommendations/);
  assert.match(comment, /- Test auth flow end-to-end/);
});

test("formatPRReviewComment omits sections with empty arrays", () => {
  const review: PRReview = {
    summary: "Only summary provided.",
    impacts: [],
    risks: [],
    suggestions: [],
    testRecommendations: [],
  };

  const comment = formatPRReviewComment(review);

  assert.match(comment, /## 🤖 AI PR Review/);
  assert.match(comment, /### Summary/);
  assert.match(comment, /Only summary provided\./);
  assert.doesNotMatch(comment, /### Impacts/);
  assert.doesNotMatch(comment, /### Risks/);
  assert.doesNotMatch(comment, /### Suggestions/);
  assert.doesNotMatch(comment, /### Test Recommendations/);
});

test("formatPRReviewComment renders some sections and omits others", () => {
  const review: PRReview = {
    summary: "Partial review.",
    impacts: ["Performance improvement"],
    risks: [],
    suggestions: ["Consider caching"],
    testRecommendations: [],
  };

  const comment = formatPRReviewComment(review);

  assert.match(comment, /### Impacts/);
  assert.match(comment, /- Performance improvement/);
  assert.doesNotMatch(comment, /### Risks/);
  assert.match(comment, /### Suggestions/);
  assert.match(comment, /- Consider caching/);
  assert.doesNotMatch(comment, /### Test Recommendations/);
});

// ─── buildWorkflowActionGuidance ─────────────────────────────────────────────

test("buildWorkflowActionGuidance includes workflow name context in output", () => {
  const guidance = buildWorkflowActionGuidance("BugWorkflow", "the app crashes on startup");

  assert.match(guidance, /Workflow execution guidance:/);
  assert.match(guidance, /Allowed run_command commands:/);
  assert.match(guidance, /In BugWorkflow/);
});

test("buildWorkflowActionGuidance detects build signals in context", () => {
  const guidance = buildWorkflowActionGuidance("BugWorkflow", "typescript compile error in utils.ts");
  assert.match(guidance, /build/);
  assert.match(guidance, /Detected command-driven verification signals:.*build/);
});

test("buildWorkflowActionGuidance detects test signals in context", () => {
  const guidance = buildWorkflowActionGuidance("BugWorkflow", "ci tests are failing due to timeout");
  assert.match(guidance, /test/);
  assert.match(guidance, /Detected command-driven verification signals:.*test/);
});

test("buildWorkflowActionGuidance detects both build and test signals", () => {
  const guidance = buildWorkflowActionGuidance("BugWorkflow", "typescript compile error and tests failing");
  assert.match(guidance, /Detected command-driven verification signals:.*build.*test/);
});

test("buildWorkflowActionGuidance shows no signals for generic context", () => {
  const guidance = buildWorkflowActionGuidance("IssueWorkflow", "user cannot log in after password reset");
  assert.match(guidance, /Detected command-driven verification signals: none/);
});

test("buildWorkflowActionGuidance includes PRReviewWorkflow-specific guidance", () => {
  const guidance = buildWorkflowActionGuidance("PRReviewWorkflow", "reviewing changes to core module");
  assert.match(guidance, /In PRReviewWorkflow/);
  assert.match(guidance, /git_status/);
  assert.doesNotMatch(guidance, /In BugWorkflow/);
  assert.doesNotMatch(guidance, /In IssueWorkflow/);
});

test("buildWorkflowActionGuidance includes IssueWorkflow-specific guidance", () => {
  const guidance = buildWorkflowActionGuidance("IssueWorkflow", "feature request for dark mode");
  assert.match(guidance, /In IssueWorkflow/);
  assert.doesNotMatch(guidance, /In BugWorkflow/);
  assert.doesNotMatch(guidance, /In PRReviewWorkflow/);
});

test("buildWorkflowActionGuidance includes BugWorkflow-specific guidance", () => {
  const guidance = buildWorkflowActionGuidance("BugWorkflow", "memory leak in server startup");
  assert.match(guidance, /In BugWorkflow/);
  assert.doesNotMatch(guidance, /In PRReviewWorkflow/);
  assert.doesNotMatch(guidance, /In IssueWorkflow/);
});

// ─── buildPlannerContextFromMemory ───────────────────────────────────────────

test("buildPlannerContextFromMemory formats memory context into a string", () => {
  const context: RelevantMemoryContext = {
    summary: "Two previous runs used search_code heavily",
    runs: [],
    failurePatterns: [],
    critiquePatterns: [],
    toolLoopPatterns: [],
    patchPatterns: ["src/core/workflowRuntime.ts"],
    commandPatterns: ["build"],
    memoryHits: 3,
  };

  const output = buildPlannerContextFromMemory(context);

  assert.match(output, /Relevant memory/);
  assert.match(output, /Two previous runs used search_code heavily/);
  assert.match(output, /Patch patterns: src\/core\/workflowRuntime\.ts/);
  assert.match(output, /Command patterns: build/);
  assert.match(output, /Memory hits: 3/);
});

test("buildPlannerContextFromMemory shows 'none' for empty pattern arrays", () => {
  const context: RelevantMemoryContext = {
    summary: "No patterns found",
    runs: [],
    failurePatterns: [],
    critiquePatterns: [],
    toolLoopPatterns: [],
    patchPatterns: [],
    commandPatterns: [],
    memoryHits: 0,
  };

  const output = buildPlannerContextFromMemory(context);

  assert.match(output, /Patch patterns: none/);
  assert.match(output, /Command patterns: none/);
  assert.match(output, /Memory hits: 0/);
});

test("buildPlannerContextFromMemory includes multiple patterns comma-separated", () => {
  const context: RelevantMemoryContext = {
    summary: "Multiple patterns",
    runs: [],
    failurePatterns: [],
    critiquePatterns: [],
    toolLoopPatterns: [],
    patchPatterns: ["src/a.ts", "src/b.ts"],
    commandPatterns: ["build", "test"],
    memoryHits: 5,
  };

  const output = buildPlannerContextFromMemory(context);

  assert.match(output, /Patch patterns: src\/a\.ts, src\/b\.ts/);
  assert.match(output, /Command patterns: build, test/);
});
