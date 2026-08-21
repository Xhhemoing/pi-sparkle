import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnsourcedItems } from "../../../src/requirement/provenance.js";
import type { RequirementContract } from "../../../src/domain/contract.js";

function baseContract(overrides: Partial<RequirementContract> = {}): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "ship the parser change",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: [],
    ...overrides
  };
}

test("an item with a source reference is sourced", () => {
  const contract = baseContract({
    deliverables: [
      {
        id: "d1",
        description: "parser change",
        artifactKind: "diff",
        sourceRefs: [{ kind: "message", ref: "user-turn-1" }]
      }
    ]
  });
  const result = findUnsourcedItems(contract);
  assert.equal(result.ok, true);
  assert.deepEqual(result.deliverables, []);
});

test("an item linked to a resolvable assumption is sourced", () => {
  const contract = baseContract({
    constraints: [{ id: "c1", description: "smallest change", enforceable: false, assumptionIds: ["a-defaults"] }],
    assumptions: [{ id: "a-defaults", statement: "heuristic default", source: "heuristic" }]
  });
  const result = findUnsourcedItems(contract);
  assert.equal(result.ok, true);
  assert.deepEqual(result.constraints, []);
});

test("an item with neither a source nor an assumption is unsourced", () => {
  const contract = baseContract({
    deliverables: [{ id: "d1", description: "mystery", artifactKind: "diff" }],
    constraints: [{ id: "c1", description: "mystery rule", enforceable: true }],
    acceptanceCriteria: [{ id: "ac1", description: "works", observableCheck: "tests pass" }]
  });
  const result = findUnsourcedItems(contract);
  assert.equal(result.ok, false);
  assert.deepEqual(result.deliverables, ["d1"]);
  assert.deepEqual(result.constraints, ["c1"]);
  assert.deepEqual(result.acceptanceCriteria, ["ac1"]);
});

test("an assumption link that does not resolve does not count as sourced", () => {
  const contract = baseContract({
    acceptanceCriteria: [
      { id: "ac1", description: "works", observableCheck: "tests pass", assumptionIds: ["a-ghost"] }
    ]
  });
  const result = findUnsourcedItems(contract);
  assert.equal(result.ok, false);
  assert.deepEqual(result.acceptanceCriteria, ["ac1"]);
});
