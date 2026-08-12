import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultRunLimits, isRunLimits, validateRunLimits } from "../../../src/domain/limits.js";

const valid = {
  maxTasks: 8,
  maxConcurrentTasks: 2,
  maxAttemptsPerTask: 3,
  maxRounds: 20,
  maxConsecutiveStalls: 3,
  maxWallTimeMs: 3_600_000
};

test("defaultRunLimits are valid and internally consistent", () => {
  const defaults = defaultRunLimits();
  assert.deepEqual(validateRunLimits(defaults), defaults);
  assert.ok(defaults.maxTasks >= 1);
  assert.ok(defaults.maxConcurrentTasks >= 1);
  assert.ok(defaults.maxConcurrentTasks <= defaults.maxTasks);
});

test("valid limits, with and without an optional cost cap, validate", () => {
  assert.deepEqual(validateRunLimits(valid), valid);
  const withCost = { ...valid, maxCostUsd: 0.5 };
  assert.deepEqual(validateRunLimits(withCost), withCost);
  assert.equal(isRunLimits(valid), true);
});

test("non-positive and inconsistent limits are rejected", () => {
  assert.throws(() => validateRunLimits({ ...valid, maxTasks: 0 }), /maxTasks/);
  assert.throws(() => validateRunLimits({ ...valid, maxTasks: 1.5 }), /integer/);
  assert.throws(() => validateRunLimits({ ...valid, maxConcurrentTasks: 0 }), /maxConcurrentTasks/);
  assert.throws(() => validateRunLimits({ ...valid, maxConcurrentTasks: 9 }), /maxConcurrentTasks/);
  assert.throws(() => validateRunLimits({ ...valid, maxAttemptsPerTask: 0 }), /maxAttemptsPerTask/);
  assert.throws(() => validateRunLimits({ ...valid, maxRounds: 0 }), /maxRounds/);
  assert.throws(() => validateRunLimits({ ...valid, maxConsecutiveStalls: -1 }), /maxConsecutiveStalls/);
  assert.throws(() => validateRunLimits({ ...valid, maxWallTimeMs: 0 }), /maxWallTimeMs/);
  assert.throws(() => validateRunLimits({ ...valid, maxCostUsd: 0 }), /maxCostUsd/);
  assert.throws(() => validateRunLimits({ ...valid, maxCostUsd: -1 }), /maxCostUsd/);
  assert.throws(() => validateRunLimits(null), /RunLimits/);
  assert.throws(() => validateRunLimits("limits"), /RunLimits/);
  assert.equal(isRunLimits({ ...valid, maxTasks: 0 }), false);
});
