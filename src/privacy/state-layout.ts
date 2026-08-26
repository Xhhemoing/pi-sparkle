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
 * scrubs the task objective and the project root and only then bounds the
 * objective to an excerpt, before either can land in a replay dataset).
 * Scrubbing is best-effort, so what lands is classified sensitive rather than
 * called clean. The plane-boundary test pins the current exceptions; new ones
 * require an explicit allowlist entry.
 */
export type Plane = "runtime" | "adaptation";

export function runtimeRoot(stateRoot: string): string {
  return join(stateRoot, "runtime");
}

export function adaptationRoot(stateRoot: string): string {
  return join(stateRoot, "adaptation");
}

/**
 * The container every default `adapt dataset` export lands in. Publishing
 * binds the `<runId>` leaf to this directory (see
 * `src/privacy/eval-dataset-path.ts`), so it needs one spelling too.
 */
export function evalDatasetsRoot(stateRoot: string): string {
  return join(adaptationRoot(stateRoot), "eval-datasets");
}

/**
 * Where `adapt dataset --run <runId>` writes when the operator does not name a
 * directory. It lives here rather than in the exporter because the delete
 * tooling has to reach the same path: `deleteRunRecords` cascades into this
 * directory, and a second spelling of it would be a cascade that silently
 * misses. `--dir` exports are outside this path and outside that cascade.
 *
 * This is the *lexical* path both sides name. Whether the `<runId>` leaf is
 * really a directory of this state root — rather than a symlink pointing
 * somewhere the cascade cannot follow — is `eval-dataset-path.ts`'s question,
 * and both the exporter and the delete have to ask it.
 */
export function defaultEvalDatasetDir(stateRoot: string, runId: string): string {
  return join(evalDatasetsRoot(stateRoot), runId);
}
