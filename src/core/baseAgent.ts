export abstract class BaseAgent {
  abstract run(input: string): Promise<any>;

  protected parseResponse(response: any) {
    try {
      const text = response.output[0].content[0].text;
      return JSON.parse(text);
    } catch (error) {
      return {
        error: "Failed to parse LLM response",
        details: error instanceof Error ? error.message : String(error),
        raw: response
      };
    }
  }
}
