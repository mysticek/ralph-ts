import { existsSync, appendFileSync, writeFileSync } from "fs";
import type { MetricRow } from "./types.ts";

const HEADER =
  "iteration,tool,story_id,stories_completed,duration_seconds,passing_before,passing_after,judge_verdict";

export function initMetrics(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, HEADER + "\n");
  }
}

export function logMetric(path: string, row: MetricRow): void {
  const line = [
    row.iteration,
    row.tool,
    row.storyId,
    row.storiesCompleted,
    row.durationSeconds,
    row.passingBefore,
    row.passingAfter,
    row.judgeVerdict,
  ].join(",");

  appendFileSync(path, line + "\n");
}
