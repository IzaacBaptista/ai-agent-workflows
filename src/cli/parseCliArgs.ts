import { normalizeOutputMode, OutputMode } from "../reporting/reportingTypes";

export type ParsedCliCommand =
  | { kind: "jira-issue"; issueKey: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "jira-analyze"; issueKey: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "jira-apply"; issueKey: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "jira-pr"; issueKey: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "github-pr-review"; input: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "github-pr-create"; issueKey: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "repo-investigate"; query: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "issue"; input: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "bug"; input: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "pr"; input: string; outputMode: OutputMode; repoRoot?: string }
  | { kind: "unknown"; raw: string[] };

function extractCliOptions(tokens: string[]): {
  outputMode: OutputMode;
  repoRoot?: string;
  remaining: string[];
} {
  const remaining: string[] = [];
  let requestedOutputMode: string | undefined;
  let repoRoot: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--output" || token === "-o") {
      requestedOutputMode = tokens[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--output=")) {
      requestedOutputMode = token.slice("--output=".length);
      continue;
    }

    if (token.startsWith("-o=")) {
      requestedOutputMode = token.slice("-o=".length);
      continue;
    }

    if (token === "--repo") {
      repoRoot = tokens[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--repo=")) {
      repoRoot = token.slice("--repo=".length);
      continue;
    }

    remaining.push(token);
  }

  return { outputMode: normalizeOutputMode(requestedOutputMode), repoRoot, remaining };
}

export function parseCliArgs(argv: string[]): ParsedCliCommand {
  const [, , namespace, ...afterNamespace] = argv;

  if (!namespace) {
    return { kind: "unknown", raw: [] };
  }

  const { outputMode, repoRoot, remaining } = extractCliOptions(afterNamespace);

  // Namespaced commands: ai jira <subcommand> <arg>
  if (namespace === "jira") {
    const [subcommand, ...rest] = remaining;
    const arg = rest.join(" ").trim();

    if (subcommand === "issue" && arg) {
      return { kind: "jira-issue", issueKey: arg, outputMode, repoRoot };
    }

    if (subcommand === "analyze" && arg) {
      return { kind: "jira-analyze", issueKey: arg, outputMode, repoRoot };
    }

    if (subcommand === "apply" && arg) {
      return { kind: "jira-apply", issueKey: arg, outputMode, repoRoot };
    }

    if (subcommand === "pr" && arg) {
      return { kind: "jira-pr", issueKey: arg, outputMode, repoRoot };
    }

    return { kind: "unknown", raw: [namespace, subcommand ?? "", ...rest] };
  }

  // Namespaced commands: ai github pr <subcommand> <arg>
  if (namespace === "github") {
    const [subA, subB, ...rest] = remaining;
    const arg = rest.join(" ").trim();

    if (subA === "pr" && subB === "review" && arg) {
      return { kind: "github-pr-review", input: arg, outputMode, repoRoot };
    }

    if (subA === "pr" && subB === "create" && arg) {
      return { kind: "github-pr-create", issueKey: arg, outputMode, repoRoot };
    }

    return { kind: "unknown", raw: [namespace, subA ?? "", subB ?? "", ...rest] };
  }

  // Namespaced command: ai repo investigate "<query>"
  if (namespace === "repo") {
    const [subcommand, ...rest] = remaining;
    const query = rest.join(" ").trim();

    if (subcommand === "investigate" && query) {
      return { kind: "repo-investigate", query, outputMode, repoRoot };
    }

    return { kind: "unknown", raw: [namespace, subcommand ?? "", ...rest] };
  }

  // Flat backward-compatible commands: ai issue "...", ai bug "...", ai pr "..."
  const input = remaining.join(" ").trim();

  if (namespace === "issue") {
    return { kind: "issue", input, outputMode, repoRoot };
  }

  if (namespace === "bug") {
    return { kind: "bug", input, outputMode, repoRoot };
  }

  if (namespace === "pr") {
    return { kind: "pr", input, outputMode, repoRoot };
  }

  return { kind: "unknown", raw: [namespace, ...remaining] };
}
