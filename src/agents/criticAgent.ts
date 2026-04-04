import { BaseAgent } from "../core/baseAgent";
import { workflowCritiqueSchema } from "../core/actionSchemas";
import { callLLM } from "../core/llmClient";
import { RelevantMemoryContext, WorkflowCritique, WorkingMemorySnapshot } from "../core/types";
import { buildPlannerContextFromMemory } from "../helpers/buildPlannerContextFromMemory";
import { summarizeWorkingMemory } from "../memory/workingMemory";
import { loadPrompt } from "../helpers/loadPrompt";

export class CriticAgent extends BaseAgent<WorkflowCritique> {
  async run(input: string): Promise<WorkflowCritique> {
    const promptTemplate = loadPrompt("criticPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;
    const response = await callLLM(finalPrompt);
    return this.parseResponse(response, workflowCritiqueSchema);
  }

  async review(
    workflowName: string,
    context: string,
    candidateResult: unknown,
    workingMemory: WorkingMemorySnapshot,
    memoryContext: RelevantMemoryContext,
  ): Promise<WorkflowCritique> {
    return this.run([
      `Workflow: ${workflowName}`,
      "",
      buildPlannerContextFromMemory(memoryContext),
      "",
      "Working memory:",
      summarizeWorkingMemory(workingMemory),
      "",
      "Review context:",
      context,
      "",
      "Candidate result:",
      JSON.stringify(candidateResult),
    ].join("\n"));
  }
}
