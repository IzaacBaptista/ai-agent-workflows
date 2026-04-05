import { z } from "zod";

export const evalWorkflowSchema = z.enum(["issue", "bug", "pr"]);

export const evalReportCheckSchema = z.object({
  label: z.string(),
  passed: z.boolean(),
  details: z.string().optional(),
});

export type EvalReportCheck = z.infer<typeof evalReportCheckSchema>;

export const evalReportScenarioSchema = z.object({
  id: z.string(),
  workflow: evalWorkflowSchema,
  description: z.string(),
  passed: z.boolean(),
  runId: z.string().optional(),
  error: z.string().optional(),
  notes: z.array(z.string()),
  checks: z.array(evalReportCheckSchema),
});

export type EvalReportScenario = z.infer<typeof evalReportScenarioSchema>;

export const evalReportSchema = z.object({
  generatedAt: z.string(),
  runStorageDir: z.string(),
  scenarioCount: z.number().int().nonnegative(),
  passedScenarioCount: z.number().int().nonnegative(),
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  failedScenarioIds: z.array(z.string()),
  scenarios: z.array(evalReportScenarioSchema),
});

export type EvalReport = z.infer<typeof evalReportSchema>;

export const evalBaselineScenarioSchema = z.object({
  id: z.string(),
  mustPass: z.boolean(),
  requiredChecks: z.array(z.string()),
});

export type EvalBaselineScenario = z.infer<typeof evalBaselineScenarioSchema>;

export const evalBaselineSchema = z.object({
  generatedAt: z.string(),
  sourceReportGeneratedAt: z.string().optional(),
  scenarioCount: z.number().int().nonnegative(),
  scenarios: z.array(evalBaselineScenarioSchema),
});

export type EvalBaseline = z.infer<typeof evalBaselineSchema>;
