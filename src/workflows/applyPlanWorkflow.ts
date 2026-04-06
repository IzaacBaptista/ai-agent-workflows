import { CoderAgent } from "../agents/coderAgent";
import {
  AppliedCodePatchResult,
  CommandExecutionResult,
  JiraAnalysis,
} from "../core/types";
import { applyCodePatchPlan } from "../tools/editPatchTool";
import { runAllowedCommand } from "../tools/runCommandTool";

export type ApplyPlanResult =
  | {
      success: true;
      patchResult: AppliedCodePatchResult;
      validationResult?: CommandExecutionResult;
    }
  | { success: false; error: string };

function buildCoderInput(issueKey: string, analysis: JiraAnalysis): string {
  return [
    `Apply implementation plan for Jira issue: ${issueKey}`,
    "",
    "Summary:",
    analysis.summary,
    "",
    "Implementation plan:",
    ...analysis.implementationPlan.map((step) => `- ${step}`),
    "",
    "Acceptance criteria:",
    ...analysis.acceptanceCriteria.map((c) => `- ${c}`),
    "",
    "Risks:",
    ...analysis.risks.map((r) => `- ${r}`),
  ].join("\n");
}

export async function runApplyPlanWorkflow(
  issueKey: string,
  analysis: JiraAnalysis,
): Promise<ApplyPlanResult> {
  const coderInput = buildCoderInput(issueKey, analysis);

  let patchPlan;
  try {
    const coder = new CoderAgent();
    patchPlan = await coder.run(coderInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `CoderAgent failed: ${message}` };
  }

  if (patchPlan.edits.length === 0) {
    return { success: false, error: "CoderAgent produced no file edits" };
  }

  const requestedFiles = patchPlan.edits.map((edit) => edit.path);

  let patchResult: AppliedCodePatchResult;
  try {
    patchResult = applyCodePatchPlan(patchPlan, requestedFiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Patch application failed: ${message}` };
  }

  let validationResult: CommandExecutionResult | undefined;
  if (patchPlan.validationCommand) {
    try {
      validationResult = await runAllowedCommand(patchPlan.validationCommand);
    } catch {
      // best-effort: validation failure is surfaced through the result, not an exception
    }
  }

  return { success: true, patchResult, validationResult };
}
