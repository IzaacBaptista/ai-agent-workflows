import { ZodSchema } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function collectTextParts(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const textParts: string[] = [];

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.text === "string" && item.text.trim().length > 0) {
      textParts.push(item.text);
      continue;
    }

    if (item.type === "output_text" && typeof item.text === "string" && item.text.trim().length > 0) {
      textParts.push(item.text);
    }
  }

  return textParts;
}

function extractResponseText(response: unknown): string {
  if (!isRecord(response)) {
    throw new Error("LLM response is not an object");
  }

  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text;
  }

  if (!Array.isArray(response.output) || response.output.length === 0) {
    throw new Error("LLM response missing `output` array");
  }

  const textParts: string[] = [];

  for (const outputItem of response.output) {
    if (!isRecord(outputItem)) {
      continue;
    }

    textParts.push(...collectTextParts(outputItem.content));
  }

  if (textParts.length === 0) {
    throw new Error("LLM response contained no text content in `output`");
  }

  return textParts.join("\n").trim();
}

export abstract class BaseAgent<TOutput> {
  abstract run(input: string): Promise<TOutput>;

  protected parseResponse(response: unknown, schema: ZodSchema<TOutput>): TOutput {
    const responseText = extractResponseText(response);

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(responseText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`LLM returned invalid JSON: ${message}`);
    }

    try {
      return schema.parse(parsedJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`LLM response failed schema validation: ${message}`);
    }
  }
}
