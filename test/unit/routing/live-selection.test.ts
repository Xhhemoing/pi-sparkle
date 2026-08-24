import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogModel, type CatalogModel } from "../../../src/routing/catalog-model.js";
import {
  compareLiveCandidates,
  liveRefusalMessage,
  selectLiveModel
} from "../../../src/routing/live-selection.js";

function model(id: string, cost: number): CatalogModel {
  return catalogModel({
    id,
    version: `${id}-v1`,
    roles: ["actor"],
    maxComplexity: "HIGH",
    estimatedCostUsd: cost,
    estimatedDurationMs: 1_000
  });
}

/** The pre-refactor golden selection: stable sort by the live order, take first. */
function sortBased(eligible: readonly CatalogModel[], preferredModel: string | undefined): CatalogModel {
  return [...eligible].sort((left, right) => compareLiveCandidates(left, right, preferredModel))[0]!;
}

test("selectLiveModel matches sort-then-take-first for every preferred choice", () => {
  const catalogs: CatalogModel[][] = [
    [model("b", 0.5), model("a", 0.5)],
    [model("mid", 0.3), model("cheap", 0.1), model("dear", 0.9)],
    [model("only", 1)],
    [model("x", 0.2), model("y", 0.2), model("z", 0.1)]
  ];
  for (const eligible of catalogs) {
    for (const preferred of [undefined, ...eligible.map((entry) => entry.id)]) {
      assert.equal(selectLiveModel(eligible, preferred).id, sortBased(eligible, preferred).id);
    }
  }
});

test("live ranking is preferred constraint, then cheapest cost, then id order", () => {
  const cheap = model("cheap", 0.1);
  const dear = model("dear", 0.9);
  const alsoCheap = model("also-cheap", 0.1);
  assert.equal(selectLiveModel([dear, cheap], undefined).id, "cheap");
  assert.equal(selectLiveModel([dear, cheap], "dear").id, "dear");
  assert.equal(selectLiveModel([cheap, alsoCheap], undefined).id, "also-cheap");
});

test("refusal message precedence is high-risk, then budget/deadline, then role/complexity", () => {
  const base = { role: "actor" as const, complexity: "LOW" as const };
  const highRiskRefusal = { modelId: "m", constraint: "high-risk-approval", detail: "d" };
  const budgetRefusal = { modelId: "m", constraint: "budget", detail: "d" };
  const roleRefusal = { modelId: "m", constraint: "role", detail: "d" };
  assert.equal(
    liveRefusalMessage({ ...base, highRisk: true }, [roleRefusal, budgetRefusal, highRiskRefusal]),
    "No allowed model is approved for high-risk tasks"
  );
  assert.equal(
    liveRefusalMessage({ ...base, highRisk: false }, [roleRefusal, budgetRefusal, highRiskRefusal]),
    "No allowed model fits the remaining cost and time limits"
  );
  assert.equal(
    liveRefusalMessage({ ...base, highRisk: true }, [roleRefusal]),
    "No allowed model satisfies role actor and complexity LOW"
  );
});
