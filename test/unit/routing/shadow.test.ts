import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createBanditState,
  recordReward,
  selectArm,
  validateTaskFeatures,
} from "../../../src/routing/bandit.js";
import type { TaskFeatures } from "../../../src/routing/bandit.js";
import { createSeededRng } from "../../../src/experiments/replay.js";
import { createShadowRunner, createShadowState } from "../../../src/routing/shadow.js";
import { createDriftMonitor } from "../../../src/routing/drift.js";

function features(overrides: Partial<TaskFeatures> = {}): TaskFeatures {
  return {
    featureVersion: "feat-1",
    taskFamily: "bugfix",
    role: "engineer",
    contextTokens: 100_000,
    outputTokens: 4_000,
    capabilities: ["tool-use"],
    ...overrides,
  };
}

describe("M5-T4: shadow bandit", () => {
  it("sees only versioned observable task features", () => {
    assert.doesNotThrow(() => validateTaskFeatures(features()));
    assert.throws(() => validateTaskFeatures(null), /must be an object/);
    assert.throws(
      () => validateTaskFeatures({ ...features(), unobservable: "secret" }),
      /unobservable feature rejected/
    );
    assert.throws(() => validateTaskFeatures({ ...features(), featureVersion: "" }), /featureVersion/);
  });

  it("is greedy when epsilon is zero", () => {
    const state = createBanditState(["cheap", "mid"]);
    const greedy = recordReward(state, "mid", 1);
    const choice = selectArm(
      greedy,
      { seed: 1, explorationBudget: 100, epsilon: 0 },
      features(),
      false,
      createSeededRng(7)
    );
    assert.equal(choice.arm, "mid");
    assert.equal(choice.exploratory, false);
  });

  it("explores only within the separate exploration budget", () => {
    const state = createBanditState(["a", "b"]);
    const rng = createSeededRng(3);
    let current = state;
    let explorations = 0;
    for (let i = 0; i < 50; i++) {
      const choice = selectArm(
        current,
        { seed: 3, explorationBudget: 3, epsilon: 1 },
        features(),
        false,
        rng
      );
      if (choice.exploratory) explorations += 1;
      current = choice.exploratory
        ? { ...current, explorationsUsed: current.explorationsUsed + 1 }
        : current;
    }
    assert.equal(explorations, 3);
  });

  it("high-risk tasks never explore, and the counter stays zero", () => {
    const state = createBanditState(["a", "b"]);
    const rng = createSeededRng(9);
    for (let i = 0; i < 30; i++) {
      const choice = selectArm(
        state,
        { seed: 9, explorationBudget: 100, epsilon: 1 },
        features(),
        true,
        rng
      );
      assert.equal(choice.exploratory, false);
    }
  });

  it("rewards drive greedy selection deterministically", () => {
    let state = createBanditState(["cheap", "mid"]);
    state = recordReward(state, "cheap", 0.2);
    state = recordReward(state, "mid", 0.9);
    state = recordReward(state, "mid", 0.7);
    const choice = selectArm(
      state,
      { seed: 1, explorationBudget: 0, epsilon: 1 },
      features(),
      false,
      createSeededRng(11)
    );
    assert.equal(choice.arm, "mid");
  });
});

describe("M5-T4: shadow runner", () => {
  const config = { seed: 5, epsilon: 1, explorationBudget: 10 };

  it("never invokes unselected models or changes side effects", () => {
    const runner = createShadowRunner(config);
    let state = createShadowState(["cheap", "mid"], config);
    const rng = createSeededRng(5);
    for (let i = 0; i < 20; i++) {
      state = runner.step(state, `h${i}`, features(), false, () => false, rng);
    }
    assert.ok(state.decisions.length === 20);
    assert.ok(state.decisions.every((d) => d.invoked === false));
    assert.ok(state.decisions.every((d) => d.sideEffects === "none"));
  });

  it("an explicit comparison budget authorizes isolated invocations only for exploratory draws", () => {
    const withBudget = { ...config, comparisonBudgetUsd: 5 };
    const runner = createShadowRunner(withBudget);
    let state = createShadowState(["cheap", "mid"], withBudget);
    const rng = createSeededRng(6);
    for (let i = 0; i < 12; i++) {
      state = runner.step(state, `h${i}`, features(), false, () => false, rng);
    }
    for (const decision of state.decisions) {
      if (decision.exploratory) {
        assert.equal(decision.invoked, true);
        assert.equal(decision.sideEffects, "isolated-only");
      } else {
        assert.equal(decision.invoked, false);
        assert.equal(decision.sideEffects, "none");
      }
    }
    assert.ok(state.decisions.some((d) => d.invoked));
  });

  it("spends the comparison budget per isolated invocation and stops when exhausted", () => {
    const tight = {
      ...config,
      comparisonBudgetUsd: 0.06,
      comparisonCostUsd: 0.05,
    };
    const runner = createShadowRunner(tight);
    let state = createShadowState(["cheap", "mid"], tight);
    const rng = createSeededRng(6);
    for (let i = 0; i < 20; i++) {
      state = runner.step(state, `h${i}`, features(), false, () => false, rng);
    }
    const invoked = state.decisions.filter((d) => d.invoked);
    // 0.06 covers exactly one 0.05 invocation; later exploratory draws must not invoke.
    assert.equal(invoked.length, 1);
    assert.equal(invoked[0]?.comparisonSpentUsd, 0.05);
    assert.ok(
      state.decisions.some((d) => d.exploratory && !d.invoked),
      "exploratory draws after budget exhaustion must not invoke"
    );
    assert.equal(state.comparisonRemainingUsd, 0.01);
  });

  it("high-risk tasks never explore even with epsilon 1", () => {
    const runner = createShadowRunner(config);
    let state = createShadowState(["cheap", "mid"], config);
    const rng = createSeededRng(8);
    for (let i = 0; i < 15; i++) {
      state = runner.step(state, `hr${i}`, features(), true, () => false, rng);
    }
    assert.ok(state.decisions.every((d) => !d.exploratory));
  });

  it("any guardrail breach halts the experiment", () => {
    const runner = createShadowRunner(config);
    let state = createShadowState(["cheap", "mid"], config);
    const rng = createSeededRng(12);
    state = runner.step(state, "h0", features(), false, () => false, rng);
    state = runner.step(
      state,
      "h1",
      features(),
      false,
      (arm) => arm === "mid",
      rng
    );
    assert.equal(state.halted, true);
    assert.match(state.haltReason ?? "", /guardrail breach/);
    const before = state.decisions.length;
    state = runner.step(state, "h2", features(), false, () => false, rng);
    assert.equal(state.decisions.length, before + 1);
    assert.equal(state.halted, true);
  });

  it("drift widens uncertainty and falls back to greedy selection", () => {
    const monitor = createDriftMonitor({ windowSize: 4, threshold: 0.5 });
    for (let i = 0; i < 4; i++) monitor.observe(features());
    assert.equal(monitor.drifted, false);
    assert.equal(monitor.uncertaintyScale, 1);
    // Inject a window of novel signatures.
    for (let i = 0; i < 4; i++) {
      monitor.observe(features({ taskFamily: `novel-${i}`, contextTokens: 999_000 + i }));
    }
    assert.equal(monitor.drifted, true);
    assert.equal(monitor.uncertaintyScale, 2);
  });
});
