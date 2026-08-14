import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCoverageGate } from "../../../src/requirement/coverage.js";
import type { RequirementContract, CoverageMatrix } from "../../../src/domain/contract.js";

test("checkCoverageGate blocks on uncovered criteria and blocking decisions", () => {
  const contract: RequirementContract = {
    schemaVersion: 1,
    objective: "test",
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [{ id: "acc-1", description: "must pass", observableCheck: "test passes" }],
    assumptions: [],
    questions: [{ id: "q1", question: "choose?", options: ["a", "b"] }], // no default => blocking
    authority: [],
    sourceRefs: []
  };
  const matrix: CoverageMatrix = {
    contractVersion: 1,
    requirementToTasks: {},
    taskToChecks: {},
    orphanRequirements: []
  };
  const result = checkCoverageGate(contract, matrix);
  assert.equal(result.ok, false);
  assert.ok(result.uncoveredCriteria.length > 0 || result.blockingDecisions.length > 0);
});
