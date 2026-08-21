import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequirementContract } from "../../../src/domain/contract.js";
import { applyPrecedence, detectConflicts } from "../../../src/requirement/precedence.js";

function latencyConflict(): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "serve the API",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "acc-fast", description: "feel snappy", observableCheck: "p95 < 10ms" },
      { id: "acc-cover", description: "cover the happy path", observableCheck: "tests pass" },
      { id: "acc-slow", description: "batch jobs may be slow", observableCheck: "batch > 1000ms allowed" }
    ],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
}

test("detectConflicts only names the contradictory latency criteria", () => {
  const conflicts = detectConflicts(latencyConflict());
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.ids, ["acc-fast", "acc-slow"]);
});

test("applyPrecedence user-first keeps the earlier criterion and records losers as assumptions", () => {
  const resolved = applyPrecedence(latencyConflict(), "user-first");
  assert.deepEqual(
    resolved.acceptanceCriteria.map((criterion) => criterion.id),
    ["acc-fast", "acc-cover"]
  );
  assert.ok(resolved.assumptions.some((assumption) => assumption.id === "a-superseded-acc-slow"));
});

test("applyPrecedence spec-first and latest-first keep the later conflicting criterion", () => {
  const spec = applyPrecedence(latencyConflict(), "spec-first");
  const latest = applyPrecedence(latencyConflict(), "latest-first");
  assert.deepEqual(
    spec.acceptanceCriteria.map((criterion) => criterion.id),
    ["acc-cover", "acc-slow"]
  );
  assert.deepEqual(
    latest.acceptanceCriteria.map((criterion) => criterion.id),
    spec.acceptanceCriteria.map((criterion) => criterion.id)
  );
});

test("applyPrecedence is a no-op when there is no conflict", () => {
  const clean: RequirementContract = {
    ...latencyConflict(),
    acceptanceCriteria: [{ id: "acc-cover", description: "cover the happy path", observableCheck: "tests pass" }]
  };
  assert.equal(applyPrecedence(clean, "user-first"), clean);
});
