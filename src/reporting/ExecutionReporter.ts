import { RunSummaryFormatter } from "./RunSummaryFormatter";
import { RunTimelineFormatter } from "./RunTimelineFormatter";
import { ExecutionReporterInput, OutputMode } from "./reportingTypes";

export class ExecutionReporter {
  static render<T>(input: ExecutionReporterInput<T>, mode: OutputMode): string {
    if (mode === "summary") {
      return RunSummaryFormatter.format(input);
    }

    if (mode === "timeline") {
      return RunTimelineFormatter.format(input);
    }

    return "";
  }
}
