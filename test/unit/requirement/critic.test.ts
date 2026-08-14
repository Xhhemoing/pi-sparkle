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
