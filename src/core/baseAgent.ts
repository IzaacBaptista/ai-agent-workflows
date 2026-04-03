export abstract class BaseAgent {
  abstract run(input: string): Promise<any>;
}
