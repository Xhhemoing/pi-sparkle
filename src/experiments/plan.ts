import { DomainValidationError } from "../domain/errors.js";
import { isCandidateId, isResourceVersionId } from "../domain/ids.js";
import type { CandidateId, ResourceVersionId } from "../domain/ids.js";

/**
 * M6-T3 experiment plan. This freezes the candidate evaluation protocol
 * (population, metrics, thresholds, budget, randomization, stop policy) before
 * any assignment. It is machinery only: validating a plan does not claim
 * Outcome-supported improvement and does not attach R1/bandit to the live loop.
 */

export type ExperimentMode = "shadow" | "canary";
export type MissingOutcomePolicy = "exclude" | "treat-as-failure" | "abort";

export const SUPPORTED_EXPERIMENT_PLAN_VERSION = 1;
export const EXPERIMENT_ID_PATTERN = /^exp_[A-Za-z0-9_-]{1,64}$/;

export interface ExperimentPlan {
  readonly planVersion: 1;
  readonly experimentId: string;
  readonly mode: ExperimentMode;
  readonly baselineVersionId: ResourceVersionId;
  readonly candidateId: CandidateId;
  readonly population: readonly string[];
  readonly metrics: readonly string[];
  readonly thresholds: {
    readonly maxGuardrailBreaches: number;
    readonly maxCostUsd: number;
  };
  readonly budget: {
    readonly maxAssignments: number;
    readonly maxWallClockMs: number;
  };
  readonly randomization: { readonly seed: number };
  readonly stopPolicy: {
    readonly onGuardrail: "halt";
    readonly onBudgetExhausted: "halt";
  };
  readonly missingOutcomePolicy: MissingOutcomePolicy;
  readonly canary?: {
    readonly maxExposure: number;
    readonly reversibleScopes: readonly string[];
  } | undefined;
}

function assertIntegerAtLeast(value: number, label: string, min: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new DomainValidationError(`${label} must be an integer >= ${min}`);
  }
}

function assertUniqueNonEmpty(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new DomainValidationError(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  let unique = 0;
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty entry`);
    }
    // Single table probe per entry: `add` plus a size counter detects the
    // duplicate exactly where `has` + `add` would (a duplicate `add` is a
    // no-op, so `size` stalls), with identical first-fault order and message.
    // This validator runs on every fail-closed restore, so the probe count
    // dominates the mandated Ω(P) re-validation cost.
    seen.add(value);
    unique += 1;
    if (seen.size !== unique) {
      throw new DomainValidationError(`${label} contains a duplicate: ${value}`);
    }
  }
}

export function validateExperimentPlan(plan: ExperimentPlan): void {
  if (typeof plan !== "object" || plan === null) {
    throw new DomainValidationError("experiment plan is required");
  }
  if (plan.planVersion !== SUPPORTED_EXPERIMENT_PLAN_VERSION) {
    throw new DomainValidationError(`unsupported planVersion: ${String(plan.planVersion)}`);
  }
  if (typeof plan.experimentId !== "string" || !EXPERIMENT_ID_PATTERN.test(plan.experimentId)) {
    throw new DomainValidationError(`invalid experimentId: ${String(plan.experimentId)}`);
  }
  if (plan.mode !== "shadow" && plan.mode !== "canary") {
    throw new DomainValidationError(`invalid mode: ${String(plan.mode)}`);
  }
  if (!isResourceVersionId(plan.baselineVersionId)) {
    throw new DomainValidationError(`invalid baselineVersionId: ${String(plan.baselineVersionId)}`);
  }
  if (!isCandidateId(plan.candidateId)) {
    throw new DomainValidationError(`invalid candidateId: ${String(plan.candidateId)}`);
  }
  assertUniqueNonEmpty(plan.population, "population");
  assertUniqueNonEmpty(plan.metrics, "metrics");

  if (typeof plan.thresholds !== "object" || plan.thresholds === null) {
    throw new DomainValidationError("thresholds are required");
  }
  assertIntegerAtLeast(plan.thresholds.maxGuardrailBreaches, "maxGuardrailBreaches", 0);
  if (
    typeof plan.thresholds.maxCostUsd !== "number" ||
    !Number.isFinite(plan.thresholds.maxCostUsd) ||
    plan.thresholds.maxCostUsd < 0
  ) {
    throw new DomainValidationError("maxCostUsd must be a finite number >= 0");
  }

  if (typeof plan.budget !== "object" || plan.budget === null) {
    throw new DomainValidationError("budget is required");
  }
  assertIntegerAtLeast(plan.budget.maxAssignments, "maxAssignments", 1);
  assertIntegerAtLeast(plan.budget.maxWallClockMs, "maxWallClockMs", 1);

  if (typeof plan.randomization !== "object" || plan.randomization === null) {
    throw new DomainValidationError("randomization is required");
  }
  if (!Number.isInteger(plan.randomization.seed)) {
    throw new DomainValidationError("seed must be an integer");
  }

  if (typeof plan.stopPolicy !== "object" || plan.stopPolicy === null) {
    throw new DomainValidationError("stopPolicy is required");
  }
  if (plan.stopPolicy.onGuardrail !== "halt") {
    throw new DomainValidationError(`invalid onGuardrail: ${String(plan.stopPolicy.onGuardrail)}`);
  }
  if (plan.stopPolicy.onBudgetExhausted !== "halt") {
    throw new DomainValidationError(
      `invalid onBudgetExhausted: ${String(plan.stopPolicy.onBudgetExhausted)}`
    );
  }

  if (
    plan.missingOutcomePolicy !== "exclude" &&
    plan.missingOutcomePolicy !== "treat-as-failure" &&
    plan.missingOutcomePolicy !== "abort"
  ) {
    throw new DomainValidationError(
      `invalid missingOutcomePolicy: ${String(plan.missingOutcomePolicy)}`
    );
  }

  if (plan.mode === "shadow" && plan.canary !== undefined) {
    throw new DomainValidationError("shadow plans must not include a canary block");
  }
  if (plan.mode === "canary") {
    if (plan.canary === undefined || typeof plan.canary !== "object" || plan.canary === null) {
      throw new DomainValidationError("canary mode requires a canary block");
    }
    assertIntegerAtLeast(plan.canary.maxExposure, "maxExposure", 1);
    assertUniqueNonEmpty(plan.canary.reversibleScopes, "reversibleScopes");
  }
}
