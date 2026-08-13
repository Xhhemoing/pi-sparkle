import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidenceId, createTaskId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import {
  DeterministicJudge,
  isJudgeDecision,
  JUDGE_VERDICTS,
  validateJudgeDecision,
  type JudgeDecision,
  type JudgeInput
} from "../../../src/graph/judge.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const taskId = createTaskId(UUID);
const evidenceId = createEvidenceId(UUID);

function input(overrides: Partial<JudgeInput> = {}): JudgeInput {
  return {
    taskId,
    verification: { kind: "PASSED", evidenceIds: [evidenceId] },
    evidenceIds: [evidenceId],
    ...overrides
  };
}

test("judge decisions validate and round-trip", () => {
  const decision: JudgeDecision = {
    taskId,
    verdict: "APPROVED",
    evidenceIds: [evidenceId]
  };
  assert.deepEqual(validateJudgeDecision(decision), decision);
  assert.equal(isJudgeDecision(decision), true);
});

test("malformed judge decisions are rejected", () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /object/],
    [{ taskId: "nope", verdict: "APPROVED", evidenceIds: [] }, /taskId/],
    [{ taskId, verdict: "MAYBE", evidenceIds: [] }, /verdict/],
    [{ taskId, verdict: "APPROVED", evidenceIds: ["nope"] }, /evidenceIds/]
  ];
  for (const [value, pattern] of cases) {
    assert.throws(() => validateJudgeDecision(value), pattern);
    assert.equal(isJudgeDecision(value), false);
  }
});

test("every verdict is a declared route and no unknown verdicts exist", () => {
  assert.deepEqual(JUDGE_VERDICTS, ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"]);
});

test("the deterministic judge approves PASSED verification with evidence", () => {
  const judge = new DeterministicJudge();
  const decision = judge.decide(input());
  assert.equal(decision.verdict, "APPROVED");
  assert.deepEqual(decision.evidenceIds, [evidenceId]);
});

test("the deterministic judge rejects FAILED verification", () => {
  const judge = new DeterministicJudge();
  const decision = judge.decide(
    input({ verification: { kind: "FAILED", evidenceIds: [] }, evidenceIds: [] })
  );
  assert.equal(decision.verdict, "REJECTED");
});

test("the deterministic judge needs a user decision for UNOBSERVED verification", () => {
  const judge = new DeterministicJudge();
  const decision = judge.decide(
    input({ verification: { kind: "UNOBSERVED", evidenceIds: [] }, evidenceIds: [] })
  );
  assert.equal(decision.verdict, "NEEDS_USER_DECISION");
});

test("a judge decision cannot invent evidence it was not given", () => {
  const judge = new DeterministicJudge();
  const decision = judge.decide(input({ verification: { kind: "PASSED", evidenceIds: [] }, evidenceIds: [] }));
  assert.equal(decision.verdict, "APPROVED");
  assert.deepEqual(decision.evidenceIds, [], "only declared evidence may be referenced");
});

test("a task with acceptance criteria but no verification stays open", () => {
  const taskNode: TaskNode = {
    id: taskId,
    title: "t",
    objective: "o",
    role: "worker",
    dependencies: [],
    acceptanceCriteria: [{ id: "ac-1", description: "works" }],
    status: "RUNNING",
    attempt: 0,
    maxAttempts: 2,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
  const judge = new DeterministicJudge();
  const decision = judge.decide({
    taskId,
    task: taskNode,
    verification: { kind: "UNOBSERVED", evidenceIds: [] },
    evidenceIds: []
  });
  assert.equal(decision.verdict, "NEEDS_USER_DECISION");
});
