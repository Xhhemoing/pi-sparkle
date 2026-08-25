import type { TaskId } from "../domain/ids.js";
import type { TaskResult } from "../protocol/v1.js";
import type { ChildInspection } from "../run/inspection.js";

/**
 * Human fragment for a terminal TASK_RESULT: outcome, verification kind, and
 * summary. An UNOBSERVED verification with no evidence gets an explicit
 * "(unverified)" suffix so a SUCCESS outcome is not read as a verified one.
 */
export function formatTaskResultLine(result: TaskResult): string {
  const unverifiedSuffix =
    result.verification.kind === "UNOBSERVED" && result.verification.evidenceIds.length === 0
      ? " (unverified)"
      : "";
  return `${result.outcome}${unverifiedSuffix} verification=${result.verification.kind} — ${result.summary}`;
}

/**
 * Task ids of children whose verification is not PASSED. A child without a
 * terminal TASK_RESULT counts as unverified. Report-only: this never changes
 * an outcome and introduces no new judgement.
 */
export function unverifiedTaskIds(children: readonly ChildInspection[]): TaskId[] {
  return children
    .filter(
      (child) =>
        child.terminalResult === undefined || child.terminalResult.verification.kind !== "PASSED"
    )
    .map((child) => child.taskId);
}

/** "unverified: N/M (tsk_a, tsk_b)", or undefined when there are no children. */
export function formatUnverifiedSummary(children: readonly ChildInspection[]): string | undefined {
  if (children.length === 0) return undefined;
  const unverified = unverifiedTaskIds(children);
  const ids = unverified.length > 0 ? ` (${unverified.join(", ")})` : "";
  return `unverified: ${unverified.length}/${children.length}${ids}`;
}
