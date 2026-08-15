import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertTransitionRun,
  assertTransitionTask,
  canTransitionRun,
  canTransitionTask,
  expandTaskTransition,
  RUN_TRANSITIONS,
  TASK_TRANSITIONS
} from "../../../src/domain/state.js";

test("run transitions follow the declared table", () => {
  assert.equal(canTransitionRun("PLANNING", "RUNNING"), true);
  assert.equal(canTransitionRun("RUNNING", "WAITING_FOR_USER"), true);
  assert.equal(canTransitionRun("RUNNING", "BLOCKED"), true);
  assert.equal(canTransitionRun("RUNNING", "COMPLETED"), true);
  assert.equal(canTransitionRun("RUNNING", "FAILED"), true);
  assert.equal(canTransitionRun("RUNNING", "CANCELLED"), true);
  assert.equal(canTransitionRun("RUNNING", "PAUSED"), true);
  assert.equal(canTransitionRun("WAITING_FOR_USER", "RUNNING"), true);
  assert.equal(canTransitionRun("WAITING_FOR_USER", "BLOCKED"), true);
  assert.equal(canTransitionRun("WAITING_FOR_USER", "CANCELLED"), true);
  assert.equal(canTransitionRun("WAITING_FOR_USER", "PAUSED"), true);
  assert.equal(canTransitionRun("PAUSED", "RUNNING"), true);
  assert.equal(canTransitionRun("PAUSED", "WAITING_FOR_USER"), true);
  assert.equal(canTransitionRun("PAUSED", "CANCELLED"), true);
  assert.equal(canTransitionRun("PAUSED", "COMPLETED"), false);
  assert.equal(canTransitionRun("BLOCKED", "RUNNING"), true);
  assert.equal(canTransitionRun("BLOCKED", "CANCELLED"), true);
  assert.equal(canTransitionRun("BLOCKED", "PAUSED"), false);
  assert.equal(canTransitionRun("COMPLETED", "RUNNING"), false);
  assert.equal(canTransitionRun("FAILED", "COMPLETED"), false);
  assert.equal(canTransitionRun("CANCELLED", "RUNNING"), false);
  assert.equal(canTransitionRun("PLANNING", "COMPLETED"), false);
});

test("task transitions follow the declared table", () => {
  assert.equal(canTransitionTask("PENDING", "READY"), true);
  assert.equal(canTransitionTask("PENDING", "CANCELLED"), true);
  assert.equal(canTransitionTask("READY", "RUNNING"), true);
  assert.equal(canTransitionTask("READY", "CANCELLED"), true);
  assert.equal(canTransitionTask("RUNNING", "COMPLETED"), true);
  assert.equal(canTransitionTask("RUNNING", "SKIPPED"), true);
  assert.equal(canTransitionTask("RUNNING", "BLOCKED"), true);
  assert.equal(canTransitionTask("RUNNING", "CANCELLED"), true);
  assert.equal(canTransitionTask("BLOCKED", "READY"), true);
  assert.equal(canTransitionTask("BLOCKED", "FAILED"), true);
  assert.equal(canTransitionTask("BLOCKED", "CANCELLED"), true);
  assert.equal(canTransitionTask("COMPLETED", "READY"), false);
  assert.equal(canTransitionTask("FAILED", "READY"), false);
  assert.equal(canTransitionTask("SKIPPED", "RUNNING"), false);
  assert.equal(canTransitionTask("PENDING", "RUNNING"), false);
  assert.equal(canTransitionTask("READY", "COMPLETED"), false);
});

test("transition tables are closed over their status unions", () => {
  const runStatuses = Object.keys(RUN_TRANSITIONS).sort();
  const taskStatuses = Object.keys(TASK_TRANSITIONS).sort();
  assert.deepEqual(runStatuses, [
    "BLOCKED",
    "CANCELLED",
    "COMPLETED",
    "FAILED",
    "PAUSED",
    "PLANNING",
    "RUNNING",
    "WAITING_FOR_USER"
  ]);
  assert.deepEqual(taskStatuses, [
    "BLOCKED",
    "CANCELLED",
    "COMPLETED",
    "FAILED",
    "PENDING",
    "READY",
    "RUNNING",
    "SKIPPED"
  ]);
});

test("assertTransitionRun throws a descriptive error on illegal transitions", () => {
  assert.throws(() => assertTransitionRun("COMPLETED", "RUNNING"), /COMPLETED.*RUNNING/);
  assert.throws(() => assertTransitionTask("FAILED", "READY"), /FAILED.*READY/);
});

test("expandTaskTransition inserts legal intermediate statuses", () => {
  assert.deepEqual(expandTaskTransition("PENDING", "READY"), ["READY"]);
  assert.deepEqual(expandTaskTransition("PENDING", "RUNNING"), ["READY", "RUNNING"]);
  assert.deepEqual(expandTaskTransition("RUNNING", "FAILED"), ["BLOCKED", "FAILED"]);
  assert.deepEqual(expandTaskTransition("RUNNING", "READY"), ["BLOCKED", "READY"]);
  assert.deepEqual(expandTaskTransition("RUNNING", "COMPLETED"), ["COMPLETED"]);
  assert.deepEqual(expandTaskTransition("PENDING", "PENDING"), []);
  assert.throws(() => expandTaskTransition("COMPLETED", "RUNNING"), /COMPLETED.*RUNNING/);
});
