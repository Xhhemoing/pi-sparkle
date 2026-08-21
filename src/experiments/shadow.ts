import { DomainValidationError } from "../domain/errors.js";
import { createIsolationGuard } from "./isolation.js";
import { validateExperimentPlan } from "./plan.js";
import type { ExperimentPlan } from "./plan.js";
import { createSeededRng } from "./replay.js";

/**
 * M6-T3 candidate shadow runner (not the routing bandit in src/routing/shadow.ts).
 *
 * Live action is always baseline. The runner may record a hypothetical candidate
 * decision but never changes the selected live action, never mutates live run
 * policy, and never claims Outcome-supported improvement.
 *
 * Conservative analysis policy: `userIntervention` always aborts (halt reason
 * `user-intervention: <episodeHash>`), independent of `missingOutcomePolicy`.
 */

export interface ExperimentOutcome {
  readonly episodeHash: string;
  readonly utility: number;
  readonly costUsd: number;
  readonly guardrailBreached: boolean;
  readonly missing?: boolean | undefined;
  readonly userIntervention?: boolean | undefined;
}

export interface ShadowAssignment {
  readonly episodeHash: string;
  readonly liveAction: "baseline";
  readonly shadowDecision: "baseline" | "candidate";
  readonly changedLiveAction: false;
}

export interface ShadowState {
  readonly plan: ExperimentPlan;
  readonly halted: boolean;
  readonly haltReason: string | undefined;
  readonly assignments: readonly ShadowAssignment[];
  readonly outcomes: readonly ExperimentOutcome[];
  readonly guardrailBreaches: number;
  readonly startedAtMs: number;
  readonly elapsedMs: number;
}

export interface ExperimentRunnerOptions {
  readonly nowMs?: (() => number) | undefined;
  readonly outputRoot?: string | undefined;
  readonly readOnlyRoots?: readonly string[] | undefined;
}

export interface ShadowRunner {
  start(nowMs: number): ShadowState;
  assign(state: ShadowState, episodeHash: string, nowMs: number): ShadowState;
  recordOutcome(state: ShadowState, outcome: ExperimentOutcome, nowMs: number): ShadowState;
  restore(serialized: ShadowState): ShadowState;
  cancel(state: ShadowState, nowMs: number): ShadowState;
}

export interface ExperimentClockState {
  readonly plan: ExperimentPlan;
  readonly halted: boolean;
  readonly haltReason: string | undefined;
  readonly startedAtMs: number;
  readonly elapsedMs: number;
}

interface OutcomePolicyResult {
  readonly outcome: ExperimentOutcome;
  readonly count: boolean;
  readonly haltReason: string | undefined;
}

export function bindExperimentIsolation(options?: ExperimentRunnerOptions): void {
  if (options?.outputRoot === undefined) {
    return;
  }
  createIsolationGuard({
    readOnlyRoots: options.readOnlyRoots ?? [],
    outputRoot: options.outputRoot,
  });
}

export function applyExperimentClock<S extends ExperimentClockState>(state: S, nowMs: number): S {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new DomainValidationError("nowMs must be a finite number");
  }
  const elapsedMs = nowMs - state.startedAtMs;
  if (elapsedMs < 0) {
    throw new DomainValidationError("nowMs must not precede startedAtMs");
  }
  if (state.halted) {
    return { ...state, elapsedMs };
  }
  if (elapsedMs >= state.plan.budget.maxWallClockMs) {
    return { ...state, elapsedMs, halted: true, haltReason: "timeout" };
  }
  return { ...state, elapsedMs };
}

export function haltOnAssignmentBudget<
  S extends ExperimentClockState & { readonly assignments: readonly unknown[] },
>(state: S): S {
  if (state.halted) {
    return state;
  }
  if (state.assignments.length >= state.plan.budget.maxAssignments) {
    return { ...state, halted: true, haltReason: "budget-exhausted" };
  }
  return state;
}

export function cancelExperiment<S extends ExperimentClockState>(state: S, nowMs: number): S {
  const next = applyExperimentClock(state, nowMs);
  if (next.halted) {
    return next;
  }
  return { ...next, halted: true, haltReason: "cancelled" };
}

export function validateExperimentOutcome(outcome: ExperimentOutcome): void {
  if (typeof outcome !== "object" || outcome === null) {
    throw new DomainValidationError("outcome is required");
  }
  if (typeof outcome.episodeHash !== "string" || outcome.episodeHash.trim() === "") {
    throw new DomainValidationError("outcome episodeHash is required");
  }
  if (typeof outcome.utility !== "number" || !Number.isFinite(outcome.utility)) {
    throw new DomainValidationError("outcome utility must be a finite number");
  }
  if (typeof outcome.costUsd !== "number" || !Number.isFinite(outcome.costUsd) || outcome.costUsd < 0) {
    throw new DomainValidationError("outcome costUsd must be a finite number >= 0");
  }
  if (typeof outcome.guardrailBreached !== "boolean") {
    throw new DomainValidationError("outcome guardrailBreached must be a boolean");
  }
  if (outcome.missing !== undefined && typeof outcome.missing !== "boolean") {
    throw new DomainValidationError("outcome missing must be a boolean when present");
  }
  if (outcome.userIntervention !== undefined && typeof outcome.userIntervention !== "boolean") {
    throw new DomainValidationError("outcome userIntervention must be a boolean when present");
  }
}

/**
 * Apply the frozen missing-outcome policy. User intervention always aborts.
 */
export function applyMissingOutcomePolicy(
  plan: ExperimentPlan,
  outcome: ExperimentOutcome
): OutcomePolicyResult {
  if (outcome.userIntervention === true) {
    return {
      outcome,
      count: false,
      haltReason: `user-intervention: ${outcome.episodeHash}`,
    };
  }
  if (outcome.missing !== true) {
    return { outcome, count: true, haltReason: undefined };
  }
  if (plan.missingOutcomePolicy === "exclude") {
    return { outcome, count: false, haltReason: undefined };
  }
  if (plan.missingOutcomePolicy === "abort") {
    return {
      outcome,
      count: false,
      haltReason: `missing-outcome: ${outcome.episodeHash}`,
    };
  }
  return {
    outcome: {
      episodeHash: outcome.episodeHash,
      utility: 0,
      costUsd: 0,
      guardrailBreached: outcome.guardrailBreached,
      missing: true,
      userIntervention: outcome.userIntervention,
    },
    count: true,
    haltReason: undefined,
  };
}

function accumulatedCostUsd(outcomes: readonly ExperimentOutcome[]): number {
  let total = 0;
  for (const item of outcomes) {
    if (item.missing === true) {
      continue;
    }
    total += item.costUsd;
  }
  return total;
}

export function recordExperimentOutcome<
  S extends ExperimentClockState & {
    readonly assignments: readonly { readonly episodeHash: string }[];
    readonly outcomes: readonly ExperimentOutcome[];
    readonly guardrailBreaches: number;
  },
>(state: S, outcome: ExperimentOutcome, nowMs: number): S {
  validateExperimentOutcome(outcome);
  const next = applyExperimentClock(state, nowMs);
  if (!next.assignments.some((assignment) => assignment.episodeHash === outcome.episodeHash)) {
    throw new DomainValidationError(`outcome for unassigned episode: ${outcome.episodeHash}`);
  }
  if (next.outcomes.some((item) => item.episodeHash === outcome.episodeHash)) {
    throw new DomainValidationError(`duplicate outcome for ${outcome.episodeHash}`);
  }
  const resolved = applyMissingOutcomePolicy(next.plan, outcome);
  const outcomes = [...next.outcomes, resolved.outcome];
  let { halted, haltReason, guardrailBreaches } = next;
  if (!halted && resolved.haltReason !== undefined) {
    halted = true;
    haltReason = resolved.haltReason;
  }
  if (resolved.count && resolved.outcome.guardrailBreached) {
    guardrailBreaches += 1;
    if (!halted && guardrailBreaches > next.plan.thresholds.maxGuardrailBreaches) {
      halted = true;
      haltReason = `guardrail: ${outcome.episodeHash}`;
    }
  }
  if (resolved.count && !halted && accumulatedCostUsd(outcomes) > next.plan.thresholds.maxCostUsd) {
    halted = true;
    haltReason = `cost: ${outcome.episodeHash}`;
  }
  return { ...next, outcomes, halted, haltReason, guardrailBreaches };
}

export function requirePopulationEpisode(plan: ExperimentPlan, episodeHash: string): void {
  if (typeof episodeHash !== "string" || episodeHash.trim() === "") {
    throw new DomainValidationError("episodeHash is required");
  }
  if (!plan.population.includes(episodeHash)) {
    throw new DomainValidationError(`episode ${episodeHash} is not in the frozen population`);
  }
}

export function requireUniqueAssignment(
  assignments: readonly { readonly episodeHash: string }[],
  episodeHash: string
): void {
  if (assignments.some((assignment) => assignment.episodeHash === episodeHash)) {
    throw new DomainValidationError(`duplicate assignment for ${episodeHash}`);
  }
}

export function canonicalHaltReason(value: unknown, halted: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (halted) {
      throw new DomainValidationError("halted experiment is missing haltReason");
    }
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError("haltReason must be a non-empty string when present");
  }
  return value;
}

export function assertFiniteNowMs(nowMs: number): void {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new DomainValidationError("nowMs must be a finite number");
  }
}

function shadowDecisionAt(seed: number, index: number): "baseline" | "candidate" {
  const rng = createSeededRng(seed);
  let value = 0;
  for (let i = 0; i <= index; i++) {
    value = rng();
  }
  return value < 0.5 ? "candidate" : "baseline";
}

function restoreShadowState(serialized: ShadowState, expected: ExperimentPlan): ShadowState {
  if (typeof serialized !== "object" || serialized === null) {
    throw new DomainValidationError("shadow state is required");
  }
  validateExperimentPlan(serialized.plan);
  if (serialized.plan.experimentId !== expected.experimentId) {
    throw new DomainValidationError("restored plan does not match runner");
  }
  if (serialized.plan.mode !== "shadow") {
    throw new DomainValidationError("shadow restore requires mode \"shadow\"");
  }
  if (typeof serialized.halted !== "boolean") {
    throw new DomainValidationError("halted must be a boolean");
  }
  if (!Array.isArray(serialized.assignments) || !Array.isArray(serialized.outcomes)) {
    throw new DomainValidationError("assignments and outcomes must be arrays");
  }
  if (!Number.isInteger(serialized.guardrailBreaches) || serialized.guardrailBreaches < 0) {
    throw new DomainValidationError("guardrailBreaches must be an integer >= 0");
  }
  if (typeof serialized.startedAtMs !== "number" || !Number.isFinite(serialized.startedAtMs)) {
    throw new DomainValidationError("startedAtMs must be a finite number");
  }
  if (typeof serialized.elapsedMs !== "number" || !Number.isFinite(serialized.elapsedMs) || serialized.elapsedMs < 0) {
    throw new DomainValidationError("elapsedMs must be a finite number >= 0");
  }
  for (const assignment of serialized.assignments) {
    if (assignment.liveAction !== "baseline" || assignment.changedLiveAction !== false) {
      throw new DomainValidationError("shadow state must not change the live action");
    }
    if (assignment.shadowDecision !== "baseline" && assignment.shadowDecision !== "candidate") {
      throw new DomainValidationError("invalid shadowDecision");
    }
    requirePopulationEpisode(serialized.plan, assignment.episodeHash);
  }
  const haltReason = canonicalHaltReason(serialized.haltReason, serialized.halted);
  return {
    plan: serialized.plan,
    halted: serialized.halted,
    haltReason,
    assignments: [...serialized.assignments],
    outcomes: [...serialized.outcomes],
    guardrailBreaches: serialized.guardrailBreaches,
    startedAtMs: serialized.startedAtMs,
    elapsedMs: serialized.elapsedMs,
  };
}

export function createShadowRunner(
  plan: ExperimentPlan,
  options?: ExperimentRunnerOptions
): ShadowRunner {
  validateExperimentPlan(plan);
  if (plan.mode !== "shadow") {
    throw new DomainValidationError("shadow runner requires mode \"shadow\"");
  }
  bindExperimentIsolation(options);

  return {
    start(nowMs) {
      assertFiniteNowMs(nowMs);
      return {
        plan,
        halted: false,
        haltReason: undefined,
        assignments: [],
        outcomes: [],
        guardrailBreaches: 0,
        startedAtMs: nowMs,
        elapsedMs: 0,
      };
    },
    assign(state, episodeHash, nowMs) {
      const current = restoreShadowState(state, plan);
      const next = applyExperimentClock(current, nowMs);
      if (next.halted) {
        return next;
      }
      requirePopulationEpisode(next.plan, episodeHash);
      requireUniqueAssignment(next.assignments, episodeHash);
      const assignment: ShadowAssignment = {
        episodeHash,
        liveAction: "baseline",
        shadowDecision: shadowDecisionAt(next.plan.randomization.seed, next.assignments.length),
        changedLiveAction: false,
      };
      return haltOnAssignmentBudget({
        ...next,
        assignments: [...next.assignments, assignment],
      });
    },
    recordOutcome(state, outcome, nowMs) {
      return recordExperimentOutcome(restoreShadowState(state, plan), outcome, nowMs);
    },
    restore(serialized) {
      return restoreShadowState(serialized, plan);
    },
    cancel(state, nowMs) {
      return cancelExperiment(restoreShadowState(state, plan), nowMs);
    },
  };
}
