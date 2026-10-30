import { DomainValidationError } from "../domain/errors.js";
import type { CostGateEvent } from "../pi-adapter/pi-executor.js";

import {
  TASK_THINKING_LEVELS as THINKING_LEVELS,
  isTaskThinkingLevel as isThinkingLevel,
  type TaskThinkingLevel as CliThinkingLevel
} from "../domain/task-model-selection.js";

export { THINKING_LEVELS, isThinkingLevel };
export type { CliThinkingLevel };

/**
 * Resolves the thinking level for one run: --thinking wins over
 * PI_THINKING_LEVEL, which wins over "off". Per-run only — Pi's TUI /thinking
 * selector is session-scoped and persisted there, and this flag never writes it.
 */
export function resolveThinkingLevel(
  flag: string | undefined,
  env: string | undefined = process.env.PI_THINKING_LEVEL
): CliThinkingLevel {
  const requested = flag ?? env ?? "off";
  if (!isThinkingLevel(requested)) {
    const source = flag !== undefined ? "--thinking" : "PI_THINKING_LEVEL";
    throw new DomainValidationError(`${source} must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  return requested;
}

/**
 * `run --max-cost-usd <usd>` as the operator typed it.
 *
 * Absent stays absent: no layer invents a cap, so an omitted flag makes the
 * call the CLI made before the flag existed. What is present must be a plain
 * decimal — the `--lock-wait-ms` spelling discipline, for the same reason.
 * `1e4`, `0x10` and ` 5 ` all coerce to a number JavaScript is happy with and
 * an operator did not mean to type, and a budget is the wrong place to guess.
 */
export function parseRunCostCeiling(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DomainValidationError(
      `--max-cost-usd must be a positive finite number of US dollars, got: ${raw}`
    );
  }
  return parsed;
}

/**
 * The stderr line a requested-but-unenforceable ceiling owes the operator.
 *
 * A cap the gate could not arm is the dishonest case: the run continues with
 * no ceiling at all, and without this it does so with no trace on any record.
 * Every CLI custom provider without explicit rates is an unpriced model, so
 * this is the common outcome, not a corner.
 *
 * `stopped` prints nothing: a real ceiling stop already ends the transcript
 * visibly, and a second line would be a claim with no new fact behind it.
 * `no-cap` is unreachable — the executor emits `disarmed` only when a cap was
 * requested — and is handled here so the union stays exhaustive.
 */
export function formatCostGateWarning(event: CostGateEvent): string | undefined {
  if (event.kind === "stopped") return undefined;
  switch (event.reason) {
    case "unpriced-model":
      return (
        `warning: cost ceiling not enforced for task ${event.taskId}: ` +
        `requested ${event.maxCostUsd} USD, but the catalog quotes no usable price ` +
        "for this model, so spend is unknowable; the run continues uncapped\n"
      );
    case "invalid-cap":
      return (
        `warning: cost ceiling not enforced for task ${event.taskId}: ` +
        `requested ${event.maxCostUsd} USD is not a positive finite number of dollars; ` +
        "the run continues uncapped\n"
      );
    case "no-cap":
      return undefined;
  }
}

/**
 * Says what a resumed executor was actually built from.
 *
 * Nothing records the `--primary-model`/`--thinking` a run started with: no
 * event payload carries executor configuration, and `materializeCheckpoint`
 * derives `checkpoint.json` from the replayed log, so a field written there
 * would not survive the next rebuild. Resume therefore takes the flags again
 * (see `resumeCommand`) and discloses which configuration it built — including
 * the silent fallback to ambient defaults, which is the case that made a run
 * started on `--primary-model X --thinking high` continue on neither.
 *
 * `kind` is the executor resume is about to build, or undefined when it builds
 * none (a plain checkpoint rebuild, or a flowchart resume without --executor).
 */
export function describeResumeExecutorConfig(input: {
  readonly kind: string | undefined;
  readonly primaryModelFlag: string | undefined;
  readonly modelOverride: { readonly providerId: string; readonly modelId: string } | undefined;
  readonly thinkingFlag: string | undefined;
  readonly thinkingLevel: CliThinkingLevel;
}): string | undefined {
  const flagged = input.primaryModelFlag !== undefined || input.thinkingFlag !== undefined;
  if (input.kind === undefined) {
    return flagged
      ? "warning: resume ignored --primary-model/--thinking: this resume rebuilds no executor (pass --executor to rebuild one)"
      : undefined;
  }
  if (input.kind !== "pi") {
    return flagged
      ? `warning: resume ignored --primary-model/--thinking: they configure --executor pi, and this resume builds the ${input.kind} executor`
      : undefined;
  }
  const model =
    input.primaryModelFlag === undefined
      ? "the default primary model"
      : input.modelOverride === undefined
        ? `primary model ${input.primaryModelFlag} (not a provider/model pair, so the default channel still applies)`
        : `primary model ${input.modelOverride.providerId}/${input.modelOverride.modelId}`;
  if (!flagged) {
    return (
      `warning: resume rebuilt the pi executor on defaults (${model}, thinking ${input.thinkingLevel}); ` +
      "the run's own --primary-model/--thinking are not recorded, so pass them again if it did not start on defaults"
    );
  }
  return (
    `note: resume rebuilt the pi executor with ${model} and thinking ${input.thinkingLevel}; ` +
    "the run's own executor configuration is not recorded, so this is what you asked for now, not what it started with"
  );
}

