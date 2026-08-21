import assert from "node:assert/strict";
import { test } from "node:test";
import { critiqueContract } from "../../../src/requirement/critic.js";
import type { RequirementContract } from "../../../src/domain/contract.js";

test("critiqueContract flags contradictions and untestable criteria", () => {
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "test",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "a1", description: "must be fast", observableCheck: "latency < 10ms" },
      { id: "a2", description: "must be slow", observableCheck: "latency > 1000ms" }
    ],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
  const result = critiqueContract(contract);
  assert.ok(result.contradictions.length > 0 || result.untestable.length > 0);
  assert.ok(result.score <= 100);
});

test("critiqueContract lists every unsourced deliverable, constraint, and criterion in missingSources", () => {
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "test",
    deliverables: [
      { id: "d-sourced", description: "sourced", artifactKind: "diff", sourceRefs: [{ kind: "message", ref: "user-turn-1" }] },
      { id: "d-unsourced", description: "unsourced", artifactKind: "diff" }
    ],
    constraints: [{ id: "c-unsourced", description: "unsourced", enforceable: true }],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "ac-sourced", description: "sourced", observableCheck: "tests pass", assumptionIds: ["a-1"] },
      { id: "ac-unsourced", description: "unsourced", observableCheck: "tests pass" }
    ],
    assumptions: [{ id: "a-1", statement: "assumed", source: "heuristic" }],
    questions: [],
    authority: [],
    sourceRefs: [{ kind: "message", ref: "user-turn-1" }]
  };
  const result = critiqueContract(contract);
  assert.deepEqual(result.missingSources.sort(), ["constraint:c-unsourced", "criterion:ac-unsourced", "deliverable:d-unsourced"]);
});

test("critiqueContract does not mutate the accepted contract", () => {
  const contract: RequirementContract = Object.freeze({
    schemaVersion: 1,
    objective: "frozen contract",
    deliverables: Object.freeze([
      Object.freeze({ id: "d1", description: "change", artifactKind: "diff" })
    ]),
    constraints: Object.freeze([
      Object.freeze({ id: "c1", description: "smallest change", enforceable: false })
    ]),
    nonGoals: Object.freeze([]),
    acceptanceCriteria: Object.freeze([
      Object.freeze({ id: "ac1", description: "done", observableCheck: "tests pass" })
    ]),
    assumptions: Object.freeze([]),
    questions: Object.freeze([]),
    authority: Object.freeze([]),
    sourceRefs: Object.freeze([])
  });
  // ESM is strict mode: any mutation attempt on the frozen contract throws.
  const result = critiqueContract(contract);
  assert.ok(result.score <= 100);
  assert.deepEqual(result.missingSources.sort(), ["constraint:c1", "criterion:ac1", "deliverable:d1", "no-sources"]);
});
