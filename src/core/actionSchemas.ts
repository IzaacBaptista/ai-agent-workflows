import { z } from "zod";
import {
  ReviewerAssessment,
  RuntimeAction,
  WorkflowCritique,
  WorkflowPlan,
  WorkflowReplan,
} from "./types";

export const runtimeActionSchema: z.ZodType<RuntimeAction> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("analyze"),
      stage: z.enum(["triage", "analysis"]),
      task: z.string(),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("tool_call"),
      toolName: z.string(),
      input: z.unknown(),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("delegate"),
      targetAgent: z.string(),
      task: z.string(),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("critique"),
      task: z.string(),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("replan"),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("finalize"),
      task: z.string(),
      reason: z.string(),
    }),
  ]),
);

export const workflowPlanSchema: z.ZodType<WorkflowPlan> = z.object({
  summary: z.string(),
  actions: z.array(runtimeActionSchema).min(1),
});

export const workflowReplanSchema: z.ZodType<WorkflowReplan> = z.object({
  summary: z.string(),
  actions: z.array(runtimeActionSchema).min(1),
});

export const workflowCritiqueSchema: z.ZodType<WorkflowCritique> = z.object({
  approved: z.boolean(),
  summary: z.string(),
  missingEvidence: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  nextAction: runtimeActionSchema.optional(),
});

export const reviewerAssessmentSchema: z.ZodType<ReviewerAssessment> = z.object({
  supported: z.boolean(),
  summary: z.string(),
  missingEvidence: z.array(z.string()),
  recommendedAction: runtimeActionSchema.optional(),
});
