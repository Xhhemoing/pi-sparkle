import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareNativeReferenceUsdBudget } from "../../../src/native/write-cost-budget.js";

test("Native reference allowance validates finite positive own data before host spreading", () => {
  for (const value of [1, 0.4, 1e-7, Number.MIN_VALUE]) assert.equal(prepareNativeReferenceUsdBudget({ referenceUsdBudget: value }), value);
  assert.equal(prepareNativeReferenceUsdBudget({}), undefined);
  for (const value of [0, -1, Infinity, NaN, "1", null]) assert.throws(() => prepareNativeReferenceUsdBudget({ referenceUsdBudget: value }));
  let reads = 0;
  const getter = Object.defineProperty({}, "referenceUsdBudget", { get() { reads++; return 1; } });
  assert.throws(() => prepareNativeReferenceUsdBudget(getter)); assert.equal(reads, 0);
  assert.throws(() => prepareNativeReferenceUsdBudget(Object.create({ referenceUsdBudget: 1 }) as object));
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw Error("proxy trap"); }, has() { reads++; throw Error("proxy trap"); } });
  assert.throws(() => prepareNativeReferenceUsdBudget(proxy)); assert.equal(reads, 0);
});
