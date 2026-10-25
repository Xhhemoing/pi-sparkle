import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeWriteTimeBudget, prepareNativePhaseTimeLimits } from "../../../src/native/write-time-budget.js";

test("phase limits refuse root Proxy before any reflection trap", () => {
  let traps = 0;
  const input = new Proxy({ phaseTimeLimits: { workerTotalMs: 100 } }, {
    getOwnPropertyDescriptor(target, key) { traps++; return Reflect.getOwnPropertyDescriptor(target, key); },
    has(target, key) { traps++; return Reflect.has(target, key); }
  });
  assert.throws(() => prepareNativePhaseTimeLimits(input));
  assert.equal(traps, 0);
});

test("phase limits snapshot ordinary data and reject accessors without executing them", () => {
  const limits = { workerTotalMs: 400, checkTotalMs: 600 };
  const fixed = prepareNativePhaseTimeLimits({ phaseTimeLimits: limits });
  limits.workerTotalMs = 900;
  assert.deepEqual(fixed, { workerTotalMs: 400, checkTotalMs: 600 });
  assert.ok(Object.isFrozen(fixed));
  let reads = 0;
  const input = Object.defineProperty({}, "phaseTimeLimits", { get() { reads++; return limits; } });
  assert.throws(() => prepareNativePhaseTimeLimits(input));
  const nested = Object.defineProperty({}, "workerTotalMs", { get() { reads++; return 400; } });
  assert.throws(() => prepareNativePhaseTimeLimits({ phaseTimeLimits: nested }));
  assert.equal(reads, 0);
  assert.throws(() => prepareNativePhaseTimeLimits(Object.create({ phaseTimeLimits: limits })));
});

test("phase limits reject invalid numbers and Proxy traps without allocating authority", () => {
  for (const value of [-1, 0, 0.1, NaN, Infinity, 1_800_001, undefined]) {
    assert.throws(() => prepareNativePhaseTimeLimits({ phaseTimeLimits: { workerTotalMs: value } }));
  }
  let traps = 0;
  const proxy = new Proxy({}, { ownKeys() { traps++; return []; } });
  assert.throws(() => prepareNativePhaseTimeLimits({ phaseTimeLimits: proxy }));
  assert.equal(traps, 0);
});

test("base check accounting cannot refund, double charge or survive the first factory", () => {
  const budget = new NativeWriteTimeBudget({ checkTotalMs: 500, workerTotalMs: 300 });
  const base = budget.baseCheckBudget()!;
  assert.ok(Object.isFrozen(base));
  for (const value of [-1, NaN, Infinity]) assert.throws(() => base.recordElapsedMs(value));
  assert.equal(budget.remaining("check"), 500);
  base.recordElapsedMs(200.25);
  assert.equal(budget.remaining("check"), 299);
  assert.throws(() => base.recordElapsedMs(0));
  assert.equal(budget.remaining("check"), 299);
  budget.closeBaseCheckBudget();
  assert.throws(() => base.recordElapsedMs(1));
  assert.equal(budget.baseCheckBudget(), undefined);
  budget.charge("worker", 301.5);
  assert.equal(budget.exhausted(), "worker");
  assert.equal(budget.remaining("worker"), -2);
});

test("zero actual base duration is legal and unused callbacks expire after factory", () => {
  const budget = new NativeWriteTimeBudget({ checkTotalMs: 100 });
  budget.baseCheckBudget()!.recordElapsedMs(0);
  assert.equal(budget.remaining("check"), 100);
  const other = new NativeWriteTimeBudget({ checkTotalMs: 100 });
  const stale = other.baseCheckBudget()!;
  other.closeBaseCheckBudget();
  assert.throws(() => stale.recordElapsedMs(10));
  assert.equal(other.remaining("check"), 100);
  const legacy = new NativeWriteTimeBudget(undefined);
  assert.equal(legacy.remaining("worker"), Infinity);
  assert.equal(legacy.baseCheckBudget(), undefined);
});
