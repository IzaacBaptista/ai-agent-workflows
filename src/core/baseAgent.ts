import { ZodSchema } from "zod";

export abstract class BaseAgent<TOutput> {
  abstract run(input: string): Promise<TOutput>;

  protected parseResponse(response: unknown, schema: ZodSchema<TOutput>): TOutput {
    if (response == null || typeof response !== "object") {
      throw new Error("LLM response is not an object");
    }
    const raw = response as Record<string, unknown>;
    if (!Array.isArray(raw.output) || raw.output.length === 0) {
      throw new Error("LLM response missing `output` array");
    }
    const firstOutput = raw.output[0] as Record<string, unknown>;
    if (!Array.isArray(firstOutput.content) || firstOutput.content.length === 0) {
      throw new Error("LLM response `output[0]` missing `content` array");
    }
    const firstContent = firstOutput.content[0] as Record<string, unknown>;
    if (typeof firstContent.text !== "string") {
      throw new Error("LLM response `output[0].content[0].text` is not a string");
    }
    try {
      const parsed = JSON.parse(firstContent.text);
      return schema.parse(parsed);
    } catch (error) {
      throw new Error(`Failed to parse or validate LLM response: ${(error as Error).message}`);
    }
  }
}
