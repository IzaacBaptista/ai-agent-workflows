import { ZodSchema } from "zod";

export abstract class BaseAgent<TOutput> {
  abstract run(input: string): Promise<TOutput>;

  protected parseResponse(response: unknown, schema: ZodSchema<TOutput>): TOutput {
    try {
      const raw = response as { output: Array<{ content: Array<{ text: string }> }> };
      const text = raw.output[0].content[0].text;
      const parsed = JSON.parse(text);
      return schema.parse(parsed);
    } catch (error) {
      throw new Error(`Failed to parse or validate LLM response: ${(error as Error).message}`);
    }
  }
}
