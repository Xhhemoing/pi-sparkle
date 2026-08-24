import { DomainValidationError } from "../domain/errors.js";
import {
  applyExperimentClock,
  bindExperimentIsolation,
  cancelExperiment,
  canonicalHaltReason,
  haltOnAssignmentBudget,
  recordExperimentOutcome,
  requirePopulationEpisode,
  requirePopulationMember,
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

/**
 * Resolve the reversed membership re-validation (S6-F-1) for the pending
 * (deduplicated) assignment hashes: scan the population — whose full content
 * validateExperimentPlan just re-validated — counting hits, and stop once
 * every pending hash is matched. Population entries are unique, so counting
 * hits decides membership exactly. On any miss, replay the exact
 * per-assignment probe so the first offender is named with the production
 * message.
 */
function resolveCanaryPendingMembership(
  serialized: CanaryState,
  pending: ReadonlySet<string>
): void {
  const target = pending.size;
  if (target === 0) {
    return;
  }
  let found = 0;
  for (const hash of serialized.plan.population) {
    if (pending.has(hash)) {
      found += 1;
      if (found === target) {
        return;
      }
    }
  }
  const population = new Set(serialized.plan.population);
  for (const assignment of serialized.assignments) {
    requirePopulationMember(population, assignment.episodeHash);
  }
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
  // Reversed membership re-validation (S6-F-1, see restoreShadowState) with
  // an aligned-prefix fast path (S7-F-1). An assignment hash that is
  // string-equal to the population entry at the SAME index is thereby a
  // unique non-empty string and a member of the frozen population (the
  // population content was just re-validated by validateExperimentPlan
  // above), so the aligned prefix needs no trim probe and no hash-table work.
  // In canary order the hash check leads the per-assignment body, so the
  // alignment compare reads the same property first and the action/exposure
  // checks (and exposure accumulation) proceed unchanged for aligned entries.
  // The first misalignment falls back to the pending-Set scheme for the
  // remaining suffix — prefix membership is already proven — and a
  // misalignment at index 0 re-runs the plain landed loop so fully unaligned
  // inputs pay only one extra compare instead of a per-iteration tax.
  // Structural faults are captured, not thrown, because a membership fault at
  // an earlier index must still win the first-fault race; the failure path
  // replays the exact per-assignment probe to name the first offender with
  // the same message. The fail-closed Ω(P + A) content re-read is unchanged.
  const assignments = serialized.assignments;
  const population = serialized.plan.population;
  let derivedExposure = 0;
  let structuralFault: DomainValidationError | undefined;
  let index = 0;
  for (; index < assignments.length; index++) {
    const assignment = assignments[index] as CanaryAssignment;
    if (assignment.episodeHash !== population[index]) {
      break;
    }
    if (assignment.action !== "baseline" && assignment.action !== "candidate") {
      structuralFault = new DomainValidationError("invalid canary action");
      break;
    }
    if (assignment.action === "candidate") {
      derivedExposure += 1;
    }
    if (!Number.isInteger(assignment.exposureCount) || assignment.exposureCount < 0) {
      structuralFault = new DomainValidationError("assignment exposureCount must be an integer >= 0");
      break;
    }
  }
  if (structuralFault === undefined && index < assignments.length) {
    const pending = new Set<string>();
    if (index === 0) {
      // Fully unaligned head: the plain reversed scheme, verbatim.
      for (const assignment of assignments) {
        if (typeof assignment.episodeHash !== "string" || assignment.episodeHash.trim() === "") {
          structuralFault = new DomainValidationError("episodeHash is required");
          break;
        }
        pending.add(assignment.episodeHash);
        if (assignment.action !== "baseline" && assignment.action !== "candidate") {
          structuralFault = new DomainValidationError("invalid canary action");
          break;
        }
        if (assignment.action === "candidate") {
          derivedExposure += 1;
        }
        if (!Number.isInteger(assignment.exposureCount) || assignment.exposureCount < 0) {
          structuralFault = new DomainValidationError("assignment exposureCount must be an integer >= 0");
          break;
        }
      }
    } else {
      // Aligned prefix ended at `index`: nothing of that assignment has been
      // checked yet (alignment leads the body), so the landed per-assignment
      // sequence resumes exactly there.
      for (let i = index; i < assignments.length; i++) {
        const assignment = assignments[i] as CanaryAssignment;
        if (typeof assignment.episodeHash !== "string" || assignment.episodeHash.trim() === "") {
          structuralFault = new DomainValidationError("episodeHash is required");
          break;
        }
        pending.add(assignment.episodeHash);
        if (assignment.action !== "baseline" && assignment.action !== "candidate") {
          structuralFault = new DomainValidationError("invalid canary action");
          break;
        }
        if (assignment.action === "candidate") {
          derivedExposure += 1;
        }
        if (!Number.isInteger(assignment.exposureCount) || assignment.exposureCount < 0) {
          structuralFault = new DomainValidationError("assignment exposureCount must be an integer >= 0");
          break;
        }
      }
    }
    resolveCanaryPendingMembership(serialized, pending);
  }
  if (structuralFault !== undefined) {
    throw structuralFault;
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
