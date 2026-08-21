import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCandidateId, createResourceVersionId } from "../../../src/domain/ids.js";
import { createCanaryRunner } from "../../../src/experiments/canary.js";
import type { CanaryState } from "../../../src/experiments/canary.js";
import type { ExperimentOutcome } from "../../../src/experiments/shadow.js";
import type { ExperimentPlan } from "../../../src/experiments/plan.js";

const BASELINE = createResourceVersionId(() => "base01");
const CANDIDATE = createCandidateId(() => "cand01");

function canaryPlan(overrides: Partial<ExperimentPlan> = {}): ExperimentPlan {
  return {
    planVersion: 1,
    experimentId: "exp_canary-1",
    mode: "canary",
    baselineVersionId: BASELINE,
    candidateId: CANDIDATE,
    population: ["ep-a", "ep-b", "ep-c", "ep-d"],
    metrics: ["utility", "cost"],
    thresholds: { maxGuardrailBreaches: 0, maxCostUsd: 10 },
    budget: { maxAssignments: 8, maxWallClockMs: 10_000 },
    randomization: { seed: 42 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude",
    canary: { maxExposure: 2, reversibleScopes: ["prompt", "rubric"] },
    ...overrides,
  };
}

function outcome(
  episodeHash: string,
  overrides: Partial<ExperimentOutcome> = {}
): ExperimentOutcome {
  return {
    episodeHash,
    utility: 0.5,
    costUsd: 0.1,
    guardrailBreached: false,
    ...overrides,
  };
}

function roundTrip(state: CanaryState): CanaryState {
  return JSON.parse(JSON.stringify(state)) as CanaryState;
}

describe("M6-T3: canary runner", () => {
  it("assigns the candidate only inside approved reversible scopes up to fixed exposure", () => {
    const runner = createCanaryRunner(canaryPlan());
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", "prompt", 1);
    state = runner.assign(state, "ep-b", "rubric", 2);
    state = runner.assign(state, "ep-c", "prompt", 3);
    assert.equal(state.assignments[0]?.action, "candidate");
    assert.equal(state.assignments[1]?.action, "candidate");
    assert.equal(state.assignments[2]?.action, "baseline");
    assert.equal(state.exposureCount, 2);
    assert.equal(state.assignments[2]?.exposureCount, 2);
  });

  it("rejects an undeclared or irreversible scope", () => {
    const runner = createCanaryRunner(canaryPlan());
    const state = runner.start(0);
    assert.throws(() => runner.assign(state, "ep-a", "credentials", 1), /scope/);
    assert.throws(() => runner.assign(state, "ep-a", "live-pointer", 1), /scope/);
  });

  it("stops new assignments on a guardrail breach and records rollback evidence", () => {
    const runner = createCanaryRunner(canaryPlan());
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", "prompt", 1);
    state = runner.recordOutcome(state, outcome("ep-a", { guardrailBreached: true }), 2);
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /guardrail/);
    assert.match(state.haltReason ?? "", /ep-a/);
    const halted = runner.assign(state, "ep-b", "prompt", 3);
    assert.equal(halted.assignments.length, 1);
    assert.equal(halted.exposureCount, 1);
  });

  it("halts on fake-time timeout and treats cancellation as halt", () => {
    const runner = createCanaryRunner(
      canaryPlan({ budget: { maxAssignments: 8, maxWallClockMs: 500 } })
    );
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", "prompt", 10);
    state = runner.assign(state, "ep-b", "prompt", 500);
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /timeout/);
    assert.equal(state.assignments.length, 1);
    const cancelled = runner.cancel(runner.start(0), 1);
    assert.equal(cancelled.halted, true);
    assert.match(cancelled.haltReason ?? "", /cancelled/);
  });

  it("follows the predeclared missing-outcome and user-intervention policy", () => {
    const excluded = createCanaryRunner(canaryPlan({ missingOutcomePolicy: "exclude" }));
    let state = excluded.start(0);
    state = excluded.assign(state, "ep-a", "prompt", 1);
    state = excluded.recordOutcome(state, outcome("ep-a", { missing: true, guardrailBreached: true }), 2);
    assert.equal(state.halted, false);
    assert.equal(state.guardrailBreaches, 0);

    const aborting = createCanaryRunner(canaryPlan({ missingOutcomePolicy: "abort" }));
    let abortState = aborting.start(0);
    abortState = aborting.assign(abortState, "ep-a", "prompt", 1);
    abortState = aborting.recordOutcome(abortState, outcome("ep-a", { missing: true }), 2);
    assert.equal(abortState.halted, true);
    assert.match(abortState.haltReason ?? "", /missing-outcome/);

    const intervened = createCanaryRunner(canaryPlan());
    let userState = intervened.start(0);
    userState = intervened.assign(userState, "ep-a", "prompt", 1);
    userState = intervened.recordOutcome(userState, outcome("ep-a", { userIntervention: true }), 2);
    assert.equal(userState.halted, true);
    assert.match(userState.haltReason ?? "", /user-intervention/);
  });

  it("resumes identically after a JSON crash round-trip", () => {
    const runner = createCanaryRunner(canaryPlan());
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", "prompt", 1);
    const restored = runner.restore(roundTrip(state));
    const continued = runner.assign(restored, "ep-b", "rubric", 2);
    const control = runner.assign(state, "ep-b", "rubric", 2);
    assert.deepEqual(continued.assignments, control.assignments);
    assert.equal(continued.exposureCount, control.exposureCount);
  });

  it("rejects a shadow plan and overlapping isolation roots", () => {
    const shadow: ExperimentPlan = {
      ...canaryPlan(),
      mode: "shadow",
      canary: undefined,
    };
    assert.throws(() => createCanaryRunner(shadow), /canary/);
    assert.throws(
      () =>
        createCanaryRunner(canaryPlan(), {
          outputRoot: "/replay/out",
          readOnlyRoots: ["/replay/out"],
        }),
      /overlap/
    );
  });
});
