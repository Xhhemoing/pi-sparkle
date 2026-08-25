import { join } from "node:path";

/**
 * P0 Q1 remediation (2026-08-22 privacy sign-off): the state root is split
 * into two explicit plane directories so runtime records and adaptation
 * records can never be co-located:
 *
 *   <stateRoot>/runtime/     run-event, run-checkpoint, run-pause,
 *                            track-questions, episode, model-invocation,
 *                            catalog-observed, providers-config, auth-credential
 *   <stateRoot>/adaptation/  feedback (+tombstones), preference,
 *                            preference-dataset, candidate, routing-eval-report,
 *                            routing-eval-dataset, learning-bandit, experiment
 *
 * Boundary rule: adaptation modules must not read runtime files directly.
 * Runtime data reaches the adaptation plane only as (a) derived signals with
 * no user text (taskSuccess PASS/FAIL), or (b) through the redaction pipes
 * (`redactFeedback` / `exportForDataset` / `exportRoutingEvalDataset`, which
 * truncates and scrubs the task objective before it can land in a replay
 * dataset). The plane-boundary test pins the current exceptions; new ones
 * require an explicit allowlist entry.
 */
export type Plane = "runtime" | "adaptation";

export function runtimeRoot(stateRoot: string): string {
  return join(stateRoot, "runtime");
}

export function adaptationRoot(stateRoot: string): string {
  return join(stateRoot, "adaptation");
}
