import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cheapFirstTiers,
  decideLiveCascade,
  evidenceFromTaskResult
} from "../../../src/routing/live-cascade.js";

const TIERS = [
  { modelId: "cheap", version: "cheap-v1" },
  { modelId: "premium", version: "premium-v1" }
];

test("cheapFirstTiers sorts by estimated cost then id", () => {
  const tiers = cheapFirstTiers(["premium", "cheap"], [
    { id: "premium", version: "premium-v1", estimatedCostUsd: 0.5 },
    { id: "cheap", version: "cheap-v1", estimatedCostUsd: 0.1 }
  ]);
  assert.deepEqual(
    tiers.map((row) => row.modelId),
    ["cheap", "premium"]
  );
});

test("deterministic cheap FAIL escalates to the next cheaper-first tier", () => {
  const result = decideLiveCascade({
    plan: { highRisk: false, tiers: TIERS },
    previousModelId: "cheap",
    evidence: { source: "deterministic-check", kind: "FAIL" },
    failureClass: "model"
  });
  assert.equal(result.action, "escalate");
  assert.equal(result.nextModelId, "premium");
  assert.equal(result.nextVersion, "premium-v1");
});

test("cheap deterministic PASS is retained", () => {
  const result = decideLiveCascade({
    plan: { highRisk: false, tiers: TIERS },
    previousModelId: "cheap",
    evidence: { source: "deterministic-check", kind: "PASS" }
  });
  assert.equal(result.action, "retain");
  assert.equal(result.nextModelId, "cheap");
});

test("no check ABSTAINs without exploring", () => {
  const result = decideLiveCascade({
    plan: { highRisk: false, tiers: TIERS },
    previousModelId: "cheap",
    evidence: { source: "none", kind: "ABSTAIN" }
  });
  assert.equal(result.action, "abstain");
  assert.equal(result.nextModelId, "cheap");
});

test("high-risk forbids cascade exploration", () => {
  const result = decideLiveCascade({
    plan: { highRisk: true, tiers: TIERS },
    previousModelId: "premium",
    evidence: { source: "deterministic-check", kind: "FAIL" },
    failureClass: "model"
  });
  assert.equal(result.action, "retain");
  assert.match(result.reason, /cascade exploration forbidden/);
});

test("tool and contract FAILs do not escalate", () => {
  const tool = decideLiveCascade({
    plan: { highRisk: false, tiers: TIERS },
    previousModelId: "cheap",
    evidence: { source: "deterministic-check", kind: "FAIL" },
    failureClass: "tool"
  });
  assert.equal(tool.action, "abstain");
  const contract = decideLiveCascade({
    plan: { highRisk: false, tiers: TIERS },
    previousModelId: "cheap",
    evidence: { source: "deterministic-check", kind: "FAIL" },
    failureClass: "contract"
  });
  assert.equal(contract.action, "abstain");
});

test("UNOBSERVED verification is none/ABSTAIN", () => {
  assert.deepEqual(evidenceFromTaskResult({ verification: { kind: "UNOBSERVED" } }), {
    source: "none",
    kind: "ABSTAIN"
  });
});
