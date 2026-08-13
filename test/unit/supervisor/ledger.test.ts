import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidenceId, createTaskId, type TaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  advanceLedgerRound,
  classifyRoundProgress,
  createLedger,
  type LedgerRoundEvent,
  type RunLedger
} from "../../../src/supervisor/ledger.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const taskId: TaskId = createTaskId(UUID);
const evidenceId = createEvidenceId(UUID);

function roundEvent(partial: Partial<LedgerRoundEvent>): LedgerRoundEvent {
  return {
    taskId,
    completedTasks: [],
    newEvidenceIds: [],
    newFacts: [],
    resolvedBlockers: [],
    userDecision: false,
    ...partial
  };
}

test("a fresh ledger starts at revision 0 with zero stalls", () => {
  const ledger = createLedger("Ship the parser");
  assert.equal(ledger.revision, 0);
  assert.equal(ledger.objective, "Ship the parser");
  assert.equal(ledger.round, 0);
  assert.equal(ledger.consecutiveStalls, 0);
  assert.deepEqual(ledger.facts, []);
  assert.deepEqual(ledger.progress, []);
  assert.deepEqual(ledger.blockers, []);
});

test("a round with a completed task or new evidence counts as progress", () => {
  assert.equal(
    classifyRoundProgress(roundEvent({ completedTasks: [taskId] })),
    true,
    "a completed task is progress"
  );
  assert.equal(
    classifyRoundProgress(roundEvent({ newEvidenceIds: [evidenceId] })),
    true,
    "new evidence is progress"
  );
  assert.equal(
    classifyRoundProgress(roundEvent({ newFacts: [{ key: "lang", value: "ts", confidence: "HIGH" }] })),
    true,
    "a new non-duplicate fact is progress"
  );
  assert.equal(
    classifyRoundProgress(roundEvent({ resolvedBlockers: [{ kind: "NEEDS_INFO", description: "x" }] })),
    true,
    "a resolved blocker is progress"
  );
  assert.equal(
    classifyRoundProgress(roundEvent({ userDecision: true })),
    true,
    "a user-decision boundary is progress"
  );
});

test("a round with only retries or repeated plans is a stall", () => {
  assert.equal(classifyRoundProgress(roundEvent({})), false, "an empty round is a stall");
  assert.equal(
    classifyRoundProgress(roundEvent({ newFacts: [{ key: "lang", value: "ts", confidence: "HIGH" }] })),
    true
  );
  // Same fact again in a later round is a duplicate, hence no progress.
  const ledger = advanceLedgerRound(createLedger("x"), true, 3);
  const duplicate = roundEvent({ newFacts: [{ key: "lang", value: "ts", confidence: "HIGH" }] });
  assert.equal(classifyRoundProgress(duplicate, ledger), true, "ledger facts start empty");
});

test("advanceLedgerRound increments the round and tracks consecutive stalls", () => {
  let ledger: RunLedger = createLedger("x");
  ledger = advanceLedgerRound(ledger, true, 3);
  assert.equal(ledger.round, 1);
  assert.equal(ledger.consecutiveStalls, 0);
  assert.equal(ledger.revision, 1);

  ledger = advanceLedgerRound(ledger, false, 3);
  assert.equal(ledger.round, 2);
  assert.equal(ledger.consecutiveStalls, 1);
  assert.equal(ledger.revision, 2);

  ledger = advanceLedgerRound(ledger, false, 3);
  assert.equal(ledger.round, 3);
  assert.equal(ledger.consecutiveStalls, 2);
  assert.equal(ledger.revision, 3);

  ledger = advanceLedgerRound(ledger, true, 3);
  assert.equal(ledger.consecutiveStalls, 0, "progress resets the stall counter");
  assert.equal(ledger.revision, 4);
});

test("the stall limit blocks the run with the required evidence summary", () => {
  let ledger: RunLedger = createLedger("x");
  const limit = 3;
  for (let i = 0; i < limit; i += 1) {
    ledger = advanceLedgerRound(ledger, false, limit);
  }
  assert.equal(ledger.consecutiveStalls, limit);
  assert.equal(ledger.isBlocked, true, "consecutive stalls reaching the limit block the run");
  assert.ok(ledger.requiredEvidence.length > 0);
});

test("progress entries and blockers are recorded on the ledger", () => {
  const event: LedgerRoundEvent = roundEvent({
    completedTasks: [taskId],
    newFacts: [{ key: "lang", value: "ts", confidence: "HIGH" }],
    resolvedBlockers: [{ kind: "DEPENDENCY", description: "waiting on b" }]
  });
  const ledger = advanceLedgerRound(createLedger("x"), classifyRoundProgress(event), 3, {
    event,
    timestamp: parseIsoTimestamp("2026-08-12T09:00:00.000Z")
  });
  assert.equal(ledger.progress.length, 3, "task + fact + blocker are recorded");
  assert.ok(ledger.facts.some((fact) => fact.key === "lang"));
});

test("a TaskNode round event helper composes from task ids", () => {
  const event: LedgerRoundEvent = roundEvent({ completedTasks: [createTaskId(UUID)] });
  assert.deepEqual(event.completedTasks, [taskId]);
});
