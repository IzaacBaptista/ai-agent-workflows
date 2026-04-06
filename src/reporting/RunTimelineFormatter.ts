import { WorkflowStepRecord } from "../core/types";
import { ExecutionReporterInput } from "./reportingTypes";
import {
  extractFailureSummary,
  extractResultSummary,
  getTargetRepository,
  getHumanOutcomeLabel,
  groupWorkflowSteps,
  truncateText,
} from "./reportingUtils";

function getPrimaryAgent(attempts: WorkflowStepRecord[]): string | undefined {
  return attempts.find((attempt) => attempt.agentName)?.agentName;
}

function getPrimaryInputSummary(attempts: WorkflowStepRecord[]): string | undefined {
  return attempts.find((attempt) => attempt.inputSummary)?.inputSummary;
}

function formatAttemptLine(attempt: WorkflowStepRecord): string {
  if (attempt.blocked) {
    const detail = truncateText((attempt.outputSummary || "blocked").replace(/^blocked:\s*/i, ""), 180);
    return `   Attempt ${attempt.attempt}: blocked - ${detail}`;
  }

  const detail =
    attempt.status === "completed"
      ? truncateText(attempt.outputSummary || "completed", 180)
      : truncateText(attempt.error || "failed", 180);

  return `   Attempt ${attempt.attempt}: ${attempt.status} - ${detail}`;
}

export class RunTimelineFormatter {
  static format<T>(input: ExecutionReporterInput<T>): string {
    const { result, runRecord } = input;
    const lines: string[] = [`${result.meta.workflowName} — ${getHumanOutcomeLabel(result)}`, ""];
    const repoRoot = getTargetRepository(result.meta, runRecord);
    if (repoRoot) {
      lines.push(`Repository: ${repoRoot}`, "");
    }
    const groups = groupWorkflowSteps(runRecord);

    if (groups.length === 0) {
      lines.push("No recorded steps.");
    } else {
      groups.forEach((group, index) => {
        lines.push(`${index + 1}. ${group.displayName}`);

        const agentName = getPrimaryAgent(group.attempts);
        if (agentName) {
          lines.push(`   Agent: ${agentName}`);
        }

        const inputSummary = getPrimaryInputSummary(group.attempts);
        if (inputSummary) {
          lines.push(`   Input: ${truncateText(inputSummary, 180)}`);
        }

        if (group.attempts.length === 1) {
          const attempt = group.attempts[0];
          if (attempt.blocked) {
            lines.push(
              `   Blocked: ${truncateText((attempt.outputSummary || "blocked").replace(/^blocked:\s*/i, ""), 180)}`,
            );
          } else if (attempt.status === "completed") {
            lines.push(`   Result: ${truncateText(attempt.outputSummary || "completed", 180)}`);
          } else {
            lines.push(`   Failure: ${truncateText(attempt.error || "failed", 180)}`);
          }
        } else {
          for (const attempt of group.attempts) {
            lines.push(formatAttemptLine(attempt));
          }
        }

        lines.push("");
      });
    }

    if (result.success) {
      const resultSummary = extractResultSummary(result, runRecord);
      if (resultSummary) {
        lines.push("Result:", resultSummary);
      }
    } else {
      lines.push("Failure:", extractFailureSummary(result, runRecord));
    }

    return lines.join("\n").trimEnd();
  }
}
