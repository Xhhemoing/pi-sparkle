import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCandidateId, createResourceVersionId } from "../../../src/domain/ids.js";
import { createShadowRunner } from "../../../src/experiments/shadow.js";
import type { ExperimentOutcome, ShadowState } from "../../../src/experiments/shadow.js";
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
    population: ["ep-a", "ep-b", "ep-c", "ep-d", "ep-e", "ep-f", "ep-g", "ep-h"],
    metrics: ["utility", "cost"],
    thresholds: { maxGuardrailBreaches: 1, maxCostUsd: 10 },
    budget: { maxAssignments: 8, maxWallClockMs: 10_000 },
    randomization: { seed: 42 },
    stopPolicy: { onGuardrail: "halt", onBudgetExhausted: "halt" },
    missingOutcomePolicy: "exclude",
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

function roundTrip(state: ShadowState): ShadowState {
  return JSON.parse(JSON.stringify(state)) as ShadowState;
}

describe("M6-T3: candidate shadow runner", () => {
  it("never changes the selected live action, even when the shadow decision is candidate", () => {
    const population = Array.from({ length: 16 }, (_, index) => `ep-${index}`);
    const plan = shadowPlan({
      population,
      budget: { maxAssignments: 16, maxWallClockMs: 10_000 },
    });
    const runner = createShadowRunner(plan);
    let state = runner.start(0);
    for (const hash of population) {
      state = runner.assign(state, hash, state.elapsedMs + 1);
    }
    assert.ok(state.assignments.length > 0);
    assert.ok(state.assignments.every((assignment) => assignment.liveAction === "baseline"));
    assert.ok(state.assignments.every((assignment) => assignment.changedLiveAction === false));
    assert.ok(
      state.assignments.some((assignment) => assignment.shadowDecision === "candidate"),
      "seeded shadow must hypothetically select the candidate at least once"
    );
  });

  it("is deterministic for the same seed and assign order", () => {
    const plan = shadowPlan({ randomization: { seed: 7 } });
    const first = createShadowRunner(plan);
    const second = createShadowRunner(plan);
    let a = first.start(0);
    let b = second.start(0);
    for (const hash of plan.population) {
      a = first.assign(a, hash, a.elapsedMs + 1);
      b = second.assign(b, hash, b.elapsedMs + 1);
    }
    assert.deepEqual(
      a.assignments.map((assignment) => assignment.shadowDecision),
      b.assignments.map((assignment) => assignment.shadowDecision)
    );
  });

  it("rejects episodes outside the frozen population and duplicate assignments", () => {
    const runner = createShadowRunner(shadowPlan());
    const state = runner.start(0);
    assert.throws(() => runner.assign(state, "ep-unknown", 1), /population/);
    const assigned = runner.assign(state, "ep-a", 1);
    assert.throws(() => runner.assign(assigned, "ep-a", 2), /duplicate/);
  });

  it("halts new assignments after the assignment budget is exhausted", () => {
    const runner = createShadowRunner(shadowPlan({ budget: { maxAssignments: 2, maxWallClockMs: 10_000 } }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.assign(state, "ep-b", 2);
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /budget-exhausted/);
    const halted = runner.assign(state, "ep-c", 3);
    assert.equal(halted.assignments.length, 2);
    assert.equal(halted.halted, true);
  });

  it("halts on fake-time wall-clock timeout without allocating further", () => {
    const runner = createShadowRunner(shadowPlan({ budget: { maxAssignments: 8, maxWallClockMs: 1000 } }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 10);
    assert.equal(state.halted, false);
    state = runner.assign(state, "ep-b", 1000);
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /timeout/);
    assert.equal(state.assignments.length, 1);
  });

  it("stops new assignments on a guardrail breach and records rollback evidence", () => {
    const runner = createShadowRunner(
      shadowPlan({ thresholds: { maxGuardrailBreaches: 0, maxCostUsd: 10 } })
    );
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.recordOutcome(state, outcome("ep-a", { guardrailBreached: true }), 2);
    assert.equal(state.halted, true);
    assert.equal(state.guardrailBreaches, 1);
    assert.match(state.haltReason ?? "", /guardrail/);
    assert.match(state.haltReason ?? "", /ep-a/);
    const halted = runner.assign(state, "ep-b", 3);
    assert.equal(halted.assignments.length, 1);
  });

  it("excludes missing outcomes under the exclude analysis policy", () => {
    const runner = createShadowRunner(shadowPlan({ missingOutcomePolicy: "exclude" }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.recordOutcome(state, outcome("ep-a", { missing: true, guardrailBreached: true }), 2);
    assert.equal(state.halted, false);
    assert.equal(state.guardrailBreaches, 0);
    state = runner.assign(state, "ep-b", 3);
    assert.equal(state.assignments.length, 2);
  });

  it("treats missing outcomes as failure when that policy is declared", () => {
    const runner = createShadowRunner(shadowPlan({ missingOutcomePolicy: "treat-as-failure" }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.recordOutcome(state, outcome("ep-a", { missing: true, utility: 0.9, costUsd: 4 }), 2);
    const recorded = state.outcomes[0];
    assert.equal(recorded?.utility, 0);
    assert.equal(recorded?.costUsd, 0);
    assert.equal(state.halted, false);
  });

  it("aborts on a missing outcome when that policy is declared", () => {
    const runner = createShadowRunner(shadowPlan({ missingOutcomePolicy: "abort" }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.recordOutcome(state, outcome("ep-a", { missing: true }), 2);
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /missing-outcome/);
    const halted = runner.assign(state, "ep-b", 3);
    assert.equal(halted.assignments.length, 1);
  });

  it("treats user intervention as abort under the conservative analysis policy", () => {
    const runner = createShadowRunner(shadowPlan({ missingOutcomePolicy: "exclude" }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.recordOutcome(state, outcome("ep-a", { userIntervention: true }), 2);
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /user-intervention/);
    const halted = runner.assign(state, "ep-b", 3);
    assert.equal(halted.assignments.length, 1);
  });

  it("cancels as a halt and resumes identically after a JSON crash round-trip", () => {
    const runner = createShadowRunner(shadowPlan({ randomization: { seed: 11 } }));
    let state = runner.start(0);
    state = runner.assign(state, "ep-a", 1);
    state = runner.assign(state, "ep-b", 2);
    const restored = runner.restore(roundTrip(state));
    const continued = runner.assign(restored, "ep-c", 3);
    const control = runner.assign(state, "ep-c", 3);
    assert.deepEqual(continued.assignments, control.assignments);
    const cancelled = runner.cancel(continued, 4);
    assert.equal(cancelled.halted, true);
    assert.match(cancelled.haltReason ?? "", /cancelled/);
    const afterCancel = runner.assign(cancelled, "ep-d", 5);
    assert.equal(afterCancel.assignments.length, continued.assignments.length);
  });

  it("rejects a canary plan and overlapping isolation roots", () => {
    const canary: ExperimentPlan = {
      ...shadowPlan(),
      mode: "canary",
      canary: { maxExposure: 1, reversibleScopes: ["prompt"] },
    };
    assert.throws(() => createShadowRunner(canary), /shadow/);
    assert.throws(
      () =>
        createShadowRunner(shadowPlan(), {
          outputRoot: "/replay/out",
          readOnlyRoots: ["/replay/out"],
        }),
      /overlap/
    );
  });
});
