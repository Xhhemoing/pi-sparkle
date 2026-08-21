import { DomainValidationError } from "../domain/errors.js";
import {
  applyExperimentClock,
  bindExperimentIsolation,
  cancelExperiment,
  canonicalHaltReason,
  haltOnAssignmentBudget,
  recordExperimentOutcome,
  requirePopulationEpisode,
  requireUniqueAssignment,
  assertFiniteNowMs,
} from "./shadow.js";
import type { ExperimentOutcome, ExperimentRunnerOptions } from "./shadow.js";
import { validateExperimentPlan } from "./plan.js";
import type { ExperimentPlan } from "./plan.js";

/**
 * M6-T3 canary runner. Candidate actions are assigned only inside predeclared
 * reversible scopes, up to a fixed exposure cap. Guardrail breaches halt new
 * assignments and record rollback evidence. This runner never claims
 * Outcome-supported improvement and never attaches R1/bandit to the live loop.
 *
 * Conservative analysis policy: `userIntervention` always aborts (halt reason
 * `user-intervention: <episodeHash>`), independent of `missingOutcomePolicy`.
 */

export interface CanaryAssignment {
  readonly episodeHash: string;
  readonly action: "baseline" | "candidate";
  readonly exposureCount: number;
}

export interface CanaryState {
  readonly plan: ExperimentPlan;
  readonly halted: boolean;
  readonly haltReason: string | undefined;
  readonly assignments: readonly CanaryAssignment[];
  readonly outcomes: readonly ExperimentOutcome[];
  readonly guardrailBreaches: number;
  readonly exposureCount: number;
  readonly startedAtMs: number;
  readonly elapsedMs: number;
}

export interface CanaryRunner {
  start(nowMs: number): CanaryState;
  assign(state: CanaryState, episodeHash: string, scope: string, nowMs: number): CanaryState;
  recordOutcome(state: CanaryState, outcome: ExperimentOutcome, nowMs: number): CanaryState;
  restore(serialized: CanaryState): CanaryState;
  cancel(state: CanaryState, nowMs: number): CanaryState;
}

function requireCanaryBlock(plan: ExperimentPlan): {
  readonly maxExposure: number;
  readonly reversibleScopes: readonly string[];
} {
  if (plan.canary === undefined) {
    throw new DomainValidationError("canary mode requires a canary block");
  }
  return plan.canary;
}

function restoreCanaryState(serialized: CanaryState, expected: ExperimentPlan): CanaryState {
  if (typeof serialized !== "object" || serialized === null) {
    throw new DomainValidationError("canary state is required");
  }
  validateExperimentPlan(serialized.plan);
  if (serialized.plan.experimentId !== expected.experimentId) {
    throw new DomainValidationError("restored plan does not match runner");
  }
  if (serialized.plan.mode !== "canary") {
    throw new DomainValidationError("canary restore requires mode \"canary\"");
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
  if (!Number.isInteger(serialized.exposureCount) || serialized.exposureCount < 0) {
    throw new DomainValidationError("exposureCount must be an integer >= 0");
  }
  if (typeof serialized.startedAtMs !== "number" || !Number.isFinite(serialized.startedAtMs)) {
    throw new DomainValidationError("startedAtMs must be a finite number");
  }
  if (typeof serialized.elapsedMs !== "number" || !Number.isFinite(serialized.elapsedMs) || serialized.elapsedMs < 0) {
    throw new DomainValidationError("elapsedMs must be a finite number >= 0");
  }
  let derivedExposure = 0;
  for (const assignment of serialized.assignments) {
    requirePopulationEpisode(serialized.plan, assignment.episodeHash);
    if (assignment.action !== "baseline" && assignment.action !== "candidate") {
      throw new DomainValidationError("invalid canary action");
    }
    if (assignment.action === "candidate") {
      derivedExposure += 1;
    }
    if (!Number.isInteger(assignment.exposureCount) || assignment.exposureCount < 0) {
      throw new DomainValidationError("assignment exposureCount must be an integer >= 0");
    }
  }
  if (derivedExposure !== serialized.exposureCount) {
    throw new DomainValidationError("exposureCount does not match candidate assignments");
  }
  const haltReason = canonicalHaltReason(serialized.haltReason, serialized.halted);
  return {
    plan: serialized.plan,
    halted: serialized.halted,
    haltReason,
    assignments: [...serialized.assignments],
    outcomes: [...serialized.outcomes],
    guardrailBreaches: serialized.guardrailBreaches,
    exposureCount: serialized.exposureCount,
    startedAtMs: serialized.startedAtMs,
    elapsedMs: serialized.elapsedMs,
  };
}

export function createCanaryRunner(
  plan: ExperimentPlan,
  options?: ExperimentRunnerOptions
): CanaryRunner {
  validateExperimentPlan(plan);
  if (plan.mode !== "canary") {
    throw new DomainValidationError("canary runner requires mode \"canary\"");
  }
  requireCanaryBlock(plan);
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
        exposureCount: 0,
        startedAtMs: nowMs,
        elapsedMs: 0,
      };
    },
    assign(state, episodeHash, scope, nowMs) {
      const current = restoreCanaryState(state, plan);
      const next = applyExperimentClock(current, nowMs);
      if (next.halted) {
        return next;
      }
      requirePopulationEpisode(next.plan, episodeHash);
      requireUniqueAssignment(next.assignments, episodeHash);
      if (typeof scope !== "string" || scope.trim() === "") {
        throw new DomainValidationError("canary scope is required");
      }
      const canary = requireCanaryBlock(next.plan);
      if (!canary.reversibleScopes.includes(scope)) {
        throw new DomainValidationError(`undeclared canary scope: ${scope}`);
      }
      const action = next.exposureCount < canary.maxExposure ? "candidate" : "baseline";
      const exposureCount = next.exposureCount + (action === "candidate" ? 1 : 0);
      const assignment: CanaryAssignment = { episodeHash, action, exposureCount };
      return haltOnAssignmentBudget({
        ...next,
        assignments: [...next.assignments, assignment],
        exposureCount,
      });
    },
    recordOutcome(state, outcome, nowMs) {
      return recordExperimentOutcome(restoreCanaryState(state, plan), outcome, nowMs);
    },
    restore(serialized) {
      return restoreCanaryState(serialized, plan);
    },
    cancel(state, nowMs) {
      return cancelExperiment(restoreCanaryState(state, plan), nowMs);
    },
  };
}
