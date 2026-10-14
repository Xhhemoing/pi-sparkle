import { DomainValidationError } from "../domain/errors.js";

export interface DevelopmentTrial {
  readonly mode: "scripted" | "live";
  readonly taskId: string;
  readonly accepted: boolean;
  readonly attempts: number;
  readonly durationMs: number;
  readonly costSource: "observed" | "estimated" | "unknown";
  readonly costUsd?: number;
  readonly evidenceRef?: string;
}

/** Descriptive trial metrics; these do not establish comparative model benefit. */
export function summarizeDevelopmentTrials(trials: readonly DevelopmentTrial[]) {
  const fail = (reason: string): never => { throw new DomainValidationError(`development evaluation: ${reason}`); };
  if (!Array.isArray(trials) || trials.length > 512) fail("requires at most 512 trials");
  const ids = new Set<string>();
  for (const trial of trials) {
    if (trial === null || typeof trial !== "object" || !["scripted", "live"].includes(trial.mode) ||
        typeof trial.taskId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(trial.taskId) || ids.has(trial.taskId)) fail("invalid or repeated task identity");
    ids.add(trial.taskId);
    if (typeof trial.accepted !== "boolean" || !Number.isSafeInteger(trial.attempts) || trial.attempts < 1 || trial.attempts > 5 ||
        !Number.isFinite(trial.durationMs) || trial.durationMs < 0 || trial.durationMs > 1_800_000) fail("invalid outcome, attempts or duration");
    if (!["observed", "estimated", "unknown"].includes(trial.costSource) ||
        (trial.costSource === "unknown" ? trial.costUsd !== undefined :
          trial.costUsd === undefined || !Number.isFinite(trial.costUsd) || trial.costUsd < 0)) fail("invalid cost attribution");
    if (trial.evidenceRef !== undefined && (typeof trial.evidenceRef !== "string" || trial.evidenceRef.length > 4096)) fail("invalid evidence reference");
    if (Object.keys(trial).some((key) => !["mode", "taskId", "accepted", "attempts", "durationMs", "costSource", "costUsd", "evidenceRef"].includes(key))) fail("unsupported trial field");
  }
  const modes = new Set(trials.map((trial) => trial.mode));
  if (modes.size > 1) fail("mixed scripted/live trials require separate reports");
  const accepted = trials.filter((trial) => trial.accepted);
  const repaired = trials.filter((trial) => trial.attempts > 1);
  const observed = trials.filter((trial) => trial.costSource === "observed");
  const observedCostUsd = observed.reduce((sum, trial) => sum + trial.costUsd!, 0);
  const rate = (number: number, denominator: number) => denominator === 0 ? undefined : number / denominator;
  return {
    schemaVersion: 1 as const, mode: trials[0]?.mode, tasks: trials.length, accepted: accepted.length,
    firstPassRate: rate(accepted.filter((trial) => trial.attempts === 1).length, trials.length),
    acceptanceRate: rate(accepted.length, trials.length),
    repairSuccessRate: rate(repaired.filter((trial) => trial.accepted).length, repaired.length),
    totalAttempts: trials.reduce((sum, trial) => sum + trial.attempts, 0),
    totalDurationMs: trials.reduce((sum, trial) => sum + trial.durationMs, 0),
    observedCostUsd,
    estimatedCostUsd: trials.filter((trial) => trial.costSource === "estimated").reduce((sum, trial) => sum + trial.costUsd!, 0),
    costCoverage: rate(observed.length, trials.length),
    costPerAcceptedTaskUsd: observed.length === trials.length && accepted.length > 0 ? observedCostUsd / accepted.length : undefined,
    supportsLiveEffectivenessClaim: false as const
  };
}
