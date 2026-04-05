import { z } from "zod";
import {
  REGISTERED_AGENT_NAMES,
  ReviewerAssessment,
  RuntimeAction,
  WORKFLOW_TOOL_NAMES,
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
      type: z.literal("edit_patch"),
      task: z.string(),
      files: z.array(z.string().trim().min(1)).min(1).max(3),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("tool_call"),
      toolName: z.enum(WORKFLOW_TOOL_NAMES),
      input: z.unknown(),
      reason: z.string(),
    }),
    z.object({
      type: z.literal("delegate"),
      targetAgent: z.enum(REGISTERED_AGENT_NAMES),
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

export const codePatchPlanSchema = z.object({
  summary: z.string(),
  edits: z.array(
    z.object({
      path: z.string().trim().min(1),
      changeType: z.enum(["create", "update"]),
      content: z.string(),
      reason: z.string(),
    }),
  ).max(3),
  validationCommand: z.enum(["build", "test", "lint"]).optional(),
});
