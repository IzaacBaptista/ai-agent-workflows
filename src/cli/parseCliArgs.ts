import { normalizeOutputMode, OutputMode } from "../reporting/reportingTypes";

export interface ParsedCliArgs {
  command?: string;
  input: string;
  outputMode: OutputMode;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [, , command, ...rest] = argv;
  const inputTokens: string[] = [];
  let requestedOutputMode: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (token === "--output" || token === "-o") {
      requestedOutputMode = rest[index + 1];
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

    inputTokens.push(token);
  }

  return {
    command,
    input: inputTokens.join(" ").trim(),
    outputMode: normalizeOutputMode(requestedOutputMode),
  };
}
