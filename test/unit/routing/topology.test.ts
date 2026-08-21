import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REFLECTION_ATTEMPTS,
  decideAfterFailedReflection,
  decideTopology,
} from "../../../src/routing/topology.js";
import type { TopologyRequest } from "../../../src/routing/topology.js";
import { evaluateExpectedValue } from "../../../src/routing/expected-value.js";
import { planTaskTopology } from "../../../src/run/supervisor.js";

function request(overrides: Partial<TopologyRequest> = {}): TopologyRequest {
  return {
    taskFamily: "bugfix",
    deterministicOnly: false,
    highRisk: false,
    ambiguousIntent: false,
    deterministicFailure: false,
    openEnded: false,
    budget: { remainingBudgetUsd: 10, remainingTimeMs: 3_600_000 },
    valuePerUtilityPointUsd: 1,
    ...overrides,
  };
}

describe("M5-T5: topology scenario table", () => {
  it("low-risk mechanical work routes to a single agent", () => {
    const decision = decideTopology(request({ deterministicOnly: true }));
    assert.equal(decision.topology, "single");
    assert.equal(decision.extraCostUsd, 0);
    assert.equal(decision.aggregationRecorded, true);
  });

  it("architecture work uses specialists only with positive expected value", () => {
    const generous = decideTopology(request({ taskFamily: "architecture" }));
    assert.equal(generous.topology, "specialists");
    assert.ok(generous.expectedValueUsd > 0);
    assert.ok(generous.extraCostUsd > 0);

    const broke = decideTopology(
      request({ taskFamily: "architecture", budget: { remainingBudgetUsd: 0.05, remainingTimeMs: 3_600_000 } })
    );
    assert.equal(broke.topology, "single");
    assert.match(broke.reason, /budget insufficient/);
  });

  it("security work prefers a critic when affordable", () => {
    const decision = decideTopology(request({ taskFamily: "security" }));
    assert.equal(decision.topology, "critic");
  });

  it("ambiguous product intent always reaches a human boundary", () => {
    const decision = decideTopology(
      request({ ambiguousIntent: true, taskFamily: "architecture" })
    );
    assert.equal(decision.topology, "human-boundary");
    assert.match(decision.reason, /human boundary/);
  });

  it("open-ended search uses candidates only with positive expected value", () => {
    const decision = decideTopology(request({ openEnded: true }));
    assert.equal(decision.topology, "candidates");
    const broke = decideTopology(
      request({ openEnded: true, budget: { remainingBudgetUsd: 0.1, remainingTimeMs: 1000 } })
    );
    assert.equal(broke.topology, "single");
  });

  it("majority opinion cannot override a deterministic failure", () => {
    const decision = decideTopology(
      request({ deterministicFailure: true, taskFamily: "architecture", openEnded: true })
    );
    assert.equal(decision.topology, "single");
    assert.match(decision.reason, /cannot be overridden by majority/);
    assert.notEqual(decision.topology, "debate");
    assert.notEqual(decision.topology, "candidates");
  });

  it("failed reflection escalates topology once, then stops instead of looping", () => {
    const base = request({ taskFamily: "bugfix" });
    const first = decideAfterFailedReflection({
      currentTopology: "single",
      failedReflectionCount: 1,
      request: base,
    });
    assert.equal(first.topology, "refine");
    assert.equal(first.halt, false);
    assert.match(first.reason, /escalating topology/);

    const broke = decideAfterFailedReflection({
      currentTopology: "single",
      failedReflectionCount: 1,
      request: request({
        taskFamily: "bugfix",
        budget: { remainingBudgetUsd: 0.01, remainingTimeMs: 3_600_000 },
        valuePerUtilityPointUsd: 0.01,
      }),
    });
    assert.equal(broke.halt, true);
    assert.equal(broke.topology, "single");
    assert.match(broke.reason, /not approved/);

    const stopped = decideAfterFailedReflection({
      currentTopology: "refine",
      failedReflectionCount: MAX_REFLECTION_ATTEMPTS,
      request: base,
    });
    assert.equal(stopped.halt, true);
    assert.match(stopped.reason, /stopping instead of looping/);

    const ceiling = decideAfterFailedReflection({
      currentTopology: "debate",
      failedReflectionCount: 1,
      request: base,
    });
    assert.equal(ceiling.halt, true);
  });

  it("records the aggregation cost on every decision", () => {
    for (const decision of [
      decideTopology(request()),
      decideTopology(request({ taskFamily: "architecture" })),
      decideTopology(request({ ambiguousIntent: true })),
    ]) {
      assert.equal(decision.aggregationRecorded, true);
      assert.ok(decision.extraCostUsd >= 0);
      assert.ok(decision.extraTimeMs >= 0);
    }
  });
});

describe("M5-T5: expected value", () => {
  it("approves only positive, affordable expected value", () => {
    const budget = { remainingBudgetUsd: 1, remainingTimeMs: 600_000 };
    const cost = { extraCostUsd: 0.5, extraTimeMs: 100_000 };
    const positive = evaluateExpectedValue(budget, cost, 0.3, 2); // 0.6 - 0.5 = 0.1
    assert.ok(Math.abs(positive.evUsd - 0.1) < 1e-9);
    assert.equal(positive.approve, true);

    const negative = evaluateExpectedValue(budget, cost, 0.1, 2); // 0.2 - 0.5 = -0.3
    assert.equal(negative.positive, false);
    assert.equal(negative.approve, false);

    const unaffordable = evaluateExpectedValue(
      { remainingBudgetUsd: 0.4, remainingTimeMs: 600_000 },
      cost,
      0.9,
      2
    );
    assert.equal(unaffordable.affordable, false);
    assert.equal(unaffordable.approve, false);
  });
});

describe("M5-T5: supervisor integration", () => {
  it("planTaskTopology composes deterministic topology decisions", () => {
    const decision = planTaskTopology({
      taskFamily: "architecture",
      deterministicOnly: false,
      highRisk: false,
      ambiguousIntent: false,
      deterministicFailure: false,
      openEnded: false,
      remainingBudgetUsd: 10,
      remainingTimeMs: 3_600_000,
    });
    assert.equal(decision.topology, "specialists");
    assert.match(decision.reason, /uncalibrated/);
    assert.equal(decision.aggregationRecorded, true);
  });

  it("planTaskTopology preserves the human boundary for unresolved intent", () => {
    const decision = planTaskTopology({
      taskFamily: "bugfix",
      deterministicOnly: false,
      highRisk: false,
      ambiguousIntent: true,
      deterministicFailure: false,
      openEnded: false,
      remainingBudgetUsd: 10,
      remainingTimeMs: 3_600_000,
    });
    assert.equal(decision.topology, "human-boundary");
  });
});

describe("Checkpoint F-4: frozen-input reproduction", () => {
  it("decideTopology reproduces identical decisions across the full scenario table", () => {
    const scenarios: TopologyRequest[] = [
      request(),
      request({ deterministicOnly: true }),
      request({ taskFamily: "security" }),
      request({ taskFamily: "architecture" }),
      request({ openEnded: true }),
      request({ ambiguousIntent: true }),
      request({ deterministicFailure: true, taskFamily: "architecture", openEnded: true }),
      request({ taskFamily: "architecture", budget: { remainingBudgetUsd: 0.05, remainingTimeMs: 3_600_000 } }),
      request({ openEnded: true, budget: { remainingBudgetUsd: 0.1, remainingTimeMs: 1000 } }),
    ];
    for (const scenario of scenarios) {
      assert.deepEqual(decideTopology(scenario), decideTopology(scenario));
    }
  });

  it("decideAfterFailedReflection reproduces identical escalation decisions", () => {
    const base = request({ taskFamily: "bugfix" });
    for (const ctx of [
      { currentTopology: "single" as const, failedReflectionCount: 1, request: base },
      { currentTopology: "critic" as const, failedReflectionCount: 2, request: base },
      { currentTopology: "debate" as const, failedReflectionCount: 1, request: base },
      {
        currentTopology: "single" as const,
        failedReflectionCount: 1,
        request: request({ taskFamily: "bugfix", budget: { remainingBudgetUsd: 0.01, remainingTimeMs: 3_600_000 } }),
      },
    ]) {
      assert.deepEqual(decideAfterFailedReflection(ctx), decideAfterFailedReflection(ctx));
    }
  });

  it("planTaskTopology reproduces identical decisions for frozen supervisor inputs", () => {
    const inputs = [
      {
        taskFamily: "architecture",
        deterministicOnly: false,
        highRisk: false,
        ambiguousIntent: false,
        deterministicFailure: false,
        openEnded: false,
        remainingBudgetUsd: 10,
        remainingTimeMs: 3_600_000,
      },
      {
        taskFamily: "bugfix",
        deterministicOnly: false,
        highRisk: true,
        ambiguousIntent: false,
        deterministicFailure: false,
        openEnded: false,
        remainingBudgetUsd: 0.05,
        remainingTimeMs: 3_600_000,
        valuePerUtilityPointUsd: 0.5,
      },
    ];
    for (const input of inputs) {
      assert.deepEqual(planTaskTopology(input), planTaskTopology(input));
    }
  });

  it("planTaskTopology matches decideTopology given the same frozen request", () => {
    const input = {
      taskFamily: "security",
      deterministicOnly: false,
      highRisk: false,
      ambiguousIntent: false,
      deterministicFailure: false,
      openEnded: false,
      remainingBudgetUsd: 10,
      remainingTimeMs: 3_600_000,
      valuePerUtilityPointUsd: 1,
    };
    const viaSupervisor = planTaskTopology(input);
    const direct = decideTopology({
      taskFamily: input.taskFamily,
      deterministicOnly: input.deterministicOnly,
      highRisk: input.highRisk,
      ambiguousIntent: input.ambiguousIntent,
      deterministicFailure: input.deterministicFailure,
      openEnded: input.openEnded,
      budget: { remainingBudgetUsd: input.remainingBudgetUsd, remainingTimeMs: input.remainingTimeMs },
      valuePerUtilityPointUsd: input.valuePerUtilityPointUsd,
    });
    assert.deepEqual(viaSupervisor, direct);
  });
});
