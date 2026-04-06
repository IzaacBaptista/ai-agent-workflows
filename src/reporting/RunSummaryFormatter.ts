import { WorkflowExecutionMeta } from "../core/types";
import { ExecutionReporterInput } from "./reportingTypes";
import {
  buildHighLevelFlow,
  buildNarrativeWhatHappened,
  extractResultSummary,
  getTargetRepository,
  getBehaviorSignal,
  getHumanOutcomeLabel,
  humanizeFailureSummary,
} from "./reportingUtils";

export class RunSummaryFormatter {
  static format<T>(input: ExecutionReporterInput<T>): string {
    const { result, runRecord } = input;
    const lines: string[] = [
      `${result.meta.workflowName} — ${getHumanOutcomeLabel(result)}`,
    ];
    const repoRoot = getTargetRepository(result.meta as WorkflowExecutionMeta, runRecord);
    if (repoRoot) {
      lines.push("", "Repository:", `- ${repoRoot}`);
    }

    const whatHappened = buildNarrativeWhatHappened(result, runRecord);
    if (whatHappened.length > 0) {
      lines.push("", "What happened:", ...whatHappened.map((item) => `- ${item}`));
    }

    if (result.success) {
      const resultSummary = extractResultSummary(result, runRecord);
      if (resultSummary) {
        lines.push("", "Result:", resultSummary);
      }
    } else {
      lines.push("", "Why it failed:", `- ${humanizeFailureSummary(result, runRecord)}`);
    }

    const flow = buildHighLevelFlow(runRecord);
    if (flow) {
      lines.push("", "Flow:", flow);
    }

    const behaviorSignal = getBehaviorSignal(result.meta as WorkflowExecutionMeta, runRecord);
    if (behaviorSignal) {
      lines.push("", "Behavior:", behaviorSignal);
    }

    return lines.join("\n");
  }
}
