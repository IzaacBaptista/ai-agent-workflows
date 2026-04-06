import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "../cli/parseCliArgs";

function argv(...tokens: string[]): string[] {
  return ["node", "ai", ...tokens];
}

// ─── jira analyze — new flags ─────────────────────────────────────────────────

test("parseCliArgs jira analyze returns issueKey", () => {
  const cmd = parseCliArgs(argv("jira", "analyze", "REL-123"));
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.issueKey, "REL-123");
  assert.equal(cmd.planOnly, undefined);
  assert.equal(cmd.yes, undefined);
  assert.equal(cmd.agentic, undefined);
});

test("parseCliArgs jira analyze --plan-only sets planOnly flag", () => {
  const cmd = parseCliArgs(argv("jira", "analyze", "REL-123", "--plan-only"));
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.planOnly, true);
  assert.equal(cmd.yes, undefined);
  assert.equal(cmd.agentic, undefined);
});

test("parseCliArgs jira analyze --yes sets yes flag", () => {
  const cmd = parseCliArgs(argv("jira", "analyze", "REL-123", "--yes"));
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.yes, true);
});

test("parseCliArgs jira analyze -y sets yes flag (short alias)", () => {
  const cmd = parseCliArgs(argv("jira", "analyze", "REL-123", "-y"));
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.yes, true);
});

test("parseCliArgs jira analyze --agentic sets agentic flag", () => {
  const cmd = parseCliArgs(argv("jira", "analyze", "REL-123", "--agentic"));
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.agentic, true);
});

test("parseCliArgs jira analyze combines multiple flags", () => {
  const cmd = parseCliArgs(
    argv("jira", "analyze", "REL-123", "--agentic", "--yes", "--plan-only"),
  );
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.agentic, true);
  assert.equal(cmd.yes, true);
  assert.equal(cmd.planOnly, true);
  assert.equal(cmd.issueKey, "REL-123");
});

test("parseCliArgs jira analyze --repo sets repoRoot and does not leak into issueKey", () => {
  const cmd = parseCliArgs(
    argv("jira", "analyze", "REL-123", "--repo", "/tmp/myproject"),
  );
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.issueKey, "REL-123");
  assert.equal(cmd.repoRoot, "/tmp/myproject");
});

test("parseCliArgs jira analyze with flags before issueKey still parses correctly", () => {
  const cmd = parseCliArgs(argv("jira", "analyze", "--yes", "REL-456"));
  assert.equal(cmd.kind, "jira-analyze");
  if (cmd.kind !== "jira-analyze") return;
  assert.equal(cmd.issueKey, "REL-456");
  assert.equal(cmd.yes, true);
});

// ─── new flags do not bleed into other commands ───────────────────────────────

test("parseCliArgs jira issue is unaffected by --plan-only", () => {
  // --plan-only is a known flag so it gets consumed; it is just not used by jira-issue
  const cmd = parseCliArgs(argv("jira", "issue", "REL-123", "--plan-only"));
  assert.equal(cmd.kind, "jira-issue");
  if (cmd.kind !== "jira-issue") return;
  assert.equal(cmd.issueKey, "REL-123");
});

test("parseCliArgs github pr create is unaffected by --agentic", () => {
  const cmd = parseCliArgs(argv("github", "pr", "create", "REL-99", "--agentic"));
  assert.equal(cmd.kind, "github-pr-create");
  if (cmd.kind !== "github-pr-create") return;
  assert.equal(cmd.issueKey, "REL-99");
});

// ─── existing behaviour unchanged ────────────────────────────────────────────

test("parseCliArgs jira issue returns correct kind and key", () => {
  const cmd = parseCliArgs(argv("jira", "issue", "REL-1"));
  assert.equal(cmd.kind, "jira-issue");
  if (cmd.kind !== "jira-issue") return;
  assert.equal(cmd.issueKey, "REL-1");
});

test("parseCliArgs github pr review returns correct kind", () => {
  const cmd = parseCliArgs(argv("github", "pr", "review", "42"));
  assert.equal(cmd.kind, "github-pr-review");
});

test("parseCliArgs repo investigate returns correct kind", () => {
  const cmd = parseCliArgs(argv("repo", "investigate", "slow query on login"));
  assert.equal(cmd.kind, "repo-investigate");
  if (cmd.kind !== "repo-investigate") return;
  assert.equal(cmd.query, "slow query on login");
});

test("parseCliArgs unknown command returns unknown kind", () => {
  const cmd = parseCliArgs(argv("jira", "deploy", "REL-1"));
  assert.equal(cmd.kind, "unknown");
});

test("parseCliArgs empty argv returns unknown kind", () => {
  const cmd = parseCliArgs(["node", "ai"]);
  assert.equal(cmd.kind, "unknown");
});
