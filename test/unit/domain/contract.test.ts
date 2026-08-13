import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRequirementContract, validateCoverageMatrix } from "../../../src/domain/contract.js";
import { createTaskId } from "../../../src/domain/ids.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

test("valid RequirementContract passes validation", () => {
  const contract = {
    schemaVersion: 1,
    objective: "Build episode system",
    deliverables: [{ id: "d1", description: "Episode store", artifactKind: "code" }],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [{ id: "a1", description: "Tests pass", observableCheck: "pnpm test" }],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
  const validated = validateRequirementContract(contract);
  assert.equal(validated.objective, "Build episode system");
});

test("invalid schemaVersion is rejected", () => {
  assert.throws(() => validateRequirementContract({ schemaVersion: 2, objective: "x" }), /schemaVersion/);
});

test("CoverageMatrix validates and reports orphans", () => {
  const matrix = {
    contractVersion: 1,
    requirementToTasks: { "acc-1": [createTaskId(UUID)] },
    taskToChecks: {},
    orphanRequirements: ["acc-2"]
  };
  const v = validateCoverageMatrix(matrix);
  assert.equal(v.orphanRequirements.length, 1);
});
