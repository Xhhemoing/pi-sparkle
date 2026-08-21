import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCandidateId, createResourceVersionId } from "../../../src/domain/ids.js";
import type { CandidateId, ResourceVersionId } from "../../../src/domain/ids.js";
import { validateExperimentPlan } from "../../../src/experiments/plan.js";
import type { ExperimentPlan } from "../../../src/experiments/plan.js";

const BASELINE = createResourceVersionId(() => "base01");
const CANDIDATE = createCandidateId(() => "cand01");

function shadowPlan(overrides: Partial<ExperimentPlan> = {}): ExperimentPlan {
  return {
    planVersion: 1,
    experimentId: "exp_shadow-1",
    mode: "shadow",
    baselineVersionId: BASELINE,
    candidateId: CANDIDATE,
    population: ["ep-a", "ep-b", "ep-c", "ep-d"],
    metrics: ["utility", "cost"],
    thresholds: { maxGuardrailBreaches: 1, maxCostUsd: 10 },
    budget: { maxAssignments: 8, maxWallClockMs: 10_000 },
    randomization: { seed: 42 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude",
    ...overrides,
  };
}

function canaryPlan(overrides: Partial<ExperimentPlan> = {}): ExperimentPlan {
  return shadowPlan({
    experimentId: "exp_canary-1",
    mode: "canary",
    canary: { maxExposure: 2, reversibleScopes: ["prompt", "rubric"] },
    ...overrides,
  });
}

describe("M6-T3: experiment plan", () => {
  it("freezes baseline, candidate, population, metrics, thresholds, budget, randomization, and stop policy", () => {
    const plan = shadowPlan();
    validateExperimentPlan(plan);
    assert.equal(plan.planVersion, 1);
    assert.equal(plan.experimentId, "exp_shadow-1");
    assert.equal(plan.mode, "shadow");
    assert.equal(plan.baselineVersionId, BASELINE);
    assert.equal(plan.candidateId, CANDIDATE);
    assert.deepEqual(plan.population, ["ep-a", "ep-b", "ep-c", "ep-d"]);
    assert.deepEqual(plan.metrics, ["utility", "cost"]);
    assert.deepEqual(plan.thresholds, { maxGuardrailBreaches: 1, maxCostUsd: 10 });
    assert.deepEqual(plan.budget, { maxAssignments: 8, maxWallClockMs: 10_000 });
    assert.deepEqual(plan.randomization, { seed: 42 });
    assert.deepEqual(plan.stopPolicy, { onGuardrail: "halt", onBudgetExhausted: "halt" });
    assert.equal(plan.missingOutcomePolicy, "exclude");
  });

  it("accepts a canary plan with reversible scopes and fixed exposure", () => {
    const plan = canaryPlan();
    validateExperimentPlan(plan);
    assert.equal(plan.mode, "canary");
    assert.equal(plan.canary?.maxExposure, 2);
    assert.deepEqual(plan.canary?.reversibleScopes, ["prompt", "rubric"]);
  });

  it("rejects an invalid experimentId", () => {
    assert.throws(() => validateExperimentPlan(shadowPlan({ experimentId: "nope" })), /experimentId/);
    assert.throws(() => validateExperimentPlan(shadowPlan({ experimentId: "exp_" })), /experimentId/);
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ experimentId: `exp_${"a".repeat(65)}` })),
      /experimentId/
    );
  });

  it("rejects invalid baseline or candidate ids", () => {
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({ baselineVersionId: "not-a-version" as ResourceVersionId })
        ),
      /baselineVersionId/
    );
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ candidateId: "not-a-candidate" as CandidateId })),
      /candidateId/
    );
  });

  it("rejects empty or duplicate population hashes and empty metrics", () => {
    assert.throws(() => validateExperimentPlan(shadowPlan({ population: [] })), /population/);
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ population: ["ep-a", "ep-a"] })),
      /duplicate/
    );
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ population: ["ep-a", ""] })),
      /population/
    );
    assert.throws(() => validateExperimentPlan(shadowPlan({ metrics: [] })), /metrics/);
    assert.throws(() => validateExperimentPlan(shadowPlan({ metrics: ["utility", ""] })), /metrics/);
  });

  it("rejects non-integer budgets, negative thresholds, and a non-integer seed", () => {
    assert.throws(
      () =>
        validateExperimentPlan(shadowPlan({ budget: { maxAssignments: 1.5, maxWallClockMs: 10 } })),
      /maxAssignments/
    );
    assert.throws(
      () =>
        validateExperimentPlan(shadowPlan({ budget: { maxAssignments: 0, maxWallClockMs: 10 } })),
      /maxAssignments/
    );
    assert.throws(
      () =>
        validateExperimentPlan(shadowPlan({ budget: { maxAssignments: 1, maxWallClockMs: 0 } })),
      /maxWallClockMs/
    );
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({ thresholds: { maxGuardrailBreaches: -1, maxCostUsd: 1 } })
        ),
      /maxGuardrailBreaches/
    );
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({ thresholds: { maxGuardrailBreaches: 1.2, maxCostUsd: 1 } })
        ),
      /maxGuardrailBreaches/
    );
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({ thresholds: { maxGuardrailBreaches: 0, maxCostUsd: -0.01 } })
        ),
      /maxCostUsd/
    );
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ randomization: { seed: 1.5 } })),
      /seed/
    );
  });

  it("rejects canary mode without a canary block or with empty reversibleScopes", () => {
    assert.throws(() => validateExperimentPlan(canaryPlan({ canary: undefined })), /canary/);
    assert.throws(
      () =>
        validateExperimentPlan(
          canaryPlan({ canary: { maxExposure: 1, reversibleScopes: [] } })
        ),
      /reversibleScopes/
    );
    assert.throws(
      () =>
        validateExperimentPlan(
          canaryPlan({ canary: { maxExposure: 0, reversibleScopes: ["prompt"] } })
        ),
      /maxExposure/
    );
  });

  it("rejects a shadow plan that carries a canary block", () => {
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({
            mode: "shadow",
            canary: { maxExposure: 1, reversibleScopes: ["prompt"] },
          })
        ),
      /canary/
    );
  });

  it("rejects an unsupported plan version, mode, stop policy, or missing-outcome policy", () => {
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ planVersion: 2 as 1 })),
      /planVersion/
    );
    assert.throws(
      () => validateExperimentPlan(shadowPlan({ mode: "live" as "shadow" })),
      /mode/
    );
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({ stopPolicy: { onGuardrail: "continue" as "halt", onBudgetExhausted: "halt" } })
        ),
      /onGuardrail/
    );
    assert.throws(
      () =>
        validateExperimentPlan(
          shadowPlan({
            missingOutcomePolicy: "impute" as ExperimentPlan["missingOutcomePolicy"],
          })
        ),
      /missingOutcomePolicy/
    );
  });
});
