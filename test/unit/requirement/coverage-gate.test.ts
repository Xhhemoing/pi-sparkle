import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCoverageAllowsStart,
  checkCoverageGate,
  coverageMatrixFromTasks
} from "../../../src/requirement/coverage.js";
import type { RequirementContract, CoverageMatrix } from "../../../src/domain/contract.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import { DomainValidationError } from "../../../src/domain/errors.js";

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

const coveredContract: RequirementContract = {
  schemaVersion: 1,
  objective: "ship",
  deliverables: [],
  constraints: [],
  nonGoals: [],
  acceptanceCriteria: [{ id: "acc-1", description: "must pass", observableCheck: "test passes" }],
  assumptions: [],
  questions: [{ id: "q1", question: "choose?", options: ["a", "b"], default: "a" }],
  authority: [],
  sourceRefs: []
};

test("coverageMatrixFromTasks maps task acceptance ids onto contract criteria", () => {
  const taskId = parseTaskId("tsk_impl");
  const matrix = coverageMatrixFromTasks(coveredContract, [
    { id: taskId, acceptanceCriteria: [{ id: "acc-1" }] }
  ]);
  assert.deepEqual(matrix.requirementToTasks["acc-1"], [taskId]);
  const result = checkCoverageGate(coveredContract, matrix);
  assert.equal(result.ok, true);
});

test("assertCoverageAllowsStart throws when a supplied contract is uncovered", () => {
  const taskId = parseTaskId("tsk_impl");
  assert.throws(
    () =>
      assertCoverageAllowsStart(coveredContract, [
        { id: taskId, acceptanceCriteria: [{ id: "other" }] }
      ]),
    (error: unknown) =>
      error instanceof DomainValidationError && /coverage gate blocked start/i.test(error.message)
  );
});

test("assertCoverageAllowsStart skips synthesized skip-contracts", () => {
  const skip: RequirementContract = {
    ...coveredContract,
    assumptions: [{ id: "skip-contract", statement: "Caller did not supply a versioned contract", source: "cli" }]
  };
  assertCoverageAllowsStart(skip, [{ id: parseTaskId("tsk_impl"), acceptanceCriteria: [] }]);
});

test("assertCoverageAllowsStart treats resolved questions as non-blocking", () => {
  const open: RequirementContract = {
    ...coveredContract,
    questions: [{ id: "q1", question: "choose?", options: ["a", "b"] }]
  };
  const taskId = parseTaskId("tsk_impl");
  const tasks = [{ id: taskId, acceptanceCriteria: [{ id: "acc-1" }] }];
  assert.throws(() => assertCoverageAllowsStart(open, tasks), DomainValidationError);
  assertCoverageAllowsStart(open, tasks, { resolvedQuestionIds: ["q1"] });
});
