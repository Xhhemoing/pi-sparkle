import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCoverageMatrix } from "../../../src/domain/contract.js";

test("validateCoverageMatrix accepts valid matrix", () => {
  const matrix = {
    contractVersion: 1,
    requirementToTasks: {},
    taskToChecks: {},
    orphanRequirements: []
  };
  const result = validateCoverageMatrix(matrix);
  assert.equal(result.contractVersion, 1);
});
