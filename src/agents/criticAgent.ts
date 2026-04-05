import { BaseAgent } from "../core/baseAgent";
import { runtimeActionSchema, workflowCritiqueSchema } from "../core/actionSchemas";
import { callLLM } from "../core/llmClient";
import { RelevantMemoryContext, WorkflowCritique, WorkingMemorySnapshot } from "../core/types";
import { buildPlannerContextFromMemory } from "../helpers/buildPlannerContextFromMemory";
import { buildWorkflowActionGuidance } from "../helpers/buildWorkflowActionGuidance";
import { summarizeWorkingMemory } from "../memory/workingMemory";
import { loadPrompt } from "../helpers/loadPrompt";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function isConfidence(value: unknown): value is WorkflowCritique["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}

export class CriticAgent extends BaseAgent<WorkflowCritique> {
  private repairCritiquePayload(parsedResponse: unknown, parseError: Error): WorkflowCritique {
    const fallbackSummary = "Critic returned invalid structured output; replanning with the current evidence.";

    if (!isRecord(parsedResponse)) {
      return {
        approved: false,
        summary: fallbackSummary,
        missingEvidence: [parseError.message],
        confidence: "low",
      };
    }

    const approved = typeof parsedResponse.approved === "boolean" ? parsedResponse.approved : false;
    const summary =
      typeof parsedResponse.summary === "string" && parsedResponse.summary.trim().length > 0
        ? parsedResponse.summary.trim()
        : fallbackSummary;
    const missingEvidence = Array.isArray(parsedResponse.missingEvidence)
      ? parsedResponse.missingEvidence.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
    const nextAction = runtimeActionSchema.safeParse(parsedResponse.nextAction);

    return workflowCritiqueSchema.parse({
      approved,
      summary,
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : [parseError.message],
      confidence: isConfidence(parsedResponse.confidence) ? parsedResponse.confidence : "low",
      ...(approved || !nextAction.success ? {} : { nextAction: nextAction.data }),
    });
  }

  async run(input: string): Promise<WorkflowCritique> {
    const promptTemplate = loadPrompt("criticPrompt");
    const finalPrompt = `${promptTemplate}\n\n${input}`;
    const response = await callLLM(finalPrompt);

    try {
      return this.parseResponse(response, workflowCritiqueSchema);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));

      try {
        return this.repairCritiquePayload(this.parseResponseJson(response), parseError);
      } catch {
        return {
          approved: false,
          summary: "Critic returned invalid structured output; replanning with the current evidence.",
          missingEvidence: [parseError.message],
          confidence: "low",
        };
      }
    }
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
      buildWorkflowActionGuidance(workflowName, `${context}\n${JSON.stringify(candidateResult)}`),
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
