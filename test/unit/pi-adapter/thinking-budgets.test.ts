import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import { captureNativeHostContext } from "../../../src/pi-adapter/native-host-context.js";

function capture(thinkingBudgets: unknown) {
  const model = fauxProvider().getModel()!;
  return captureNativeHostContext({ effectiveSystemPrompt: "local", thinkingLevel: "high", defaultModel: model, models: [model],
    streamSimple: () => { throw Error("transport must not run"); }, ...{ thinkingBudgets } } as unknown as Parameters<typeof captureNativeHostContext>[0]) as unknown as { thinkingBudgets?: object };
}
test("host thinking budgets copy exactly four finite numeric fields without freezing the caller", () => {
  const original = { minimal: 0, low: -1, medium: 1.5, high: Number.MAX_VALUE };
  const actual = capture(original).thinkingBudgets;
  assert.deepEqual(actual, original); assert.notEqual(actual, original); assert.equal(Object.isFrozen(actual), true);
  assert.equal(Object.isFrozen(original), false); original.high = 42; assert.equal((actual as { high: number }).high, Number.MAX_VALUE);
  assert.deepEqual(capture({}).thinkingBudgets, {}); assert.equal(capture(undefined).thinkingBudgets, undefined);
});
test("host thinking budgets reject unknown values and accessors before touching them", () => {
  for (const invalid of [null, [], 1, "high", { high: Infinity }, { high: NaN }, { high: "1" }, { high: undefined }, { max: 100 },
    Object.assign(Object.create({ high: 1 }) as object, { low: 2 })]) assert.throws(() => capture(invalid));
  let reads = 0;
  const getter = Object.defineProperty({}, "high", { get() { reads++; return 1234; } });
  assert.throws(() => capture(getter)); assert.equal(reads, 0);
  const proxy = new Proxy({}, { ownKeys() { reads++; throw Error("proxy trap"); } });
  assert.throws(() => capture(proxy)); assert.equal(reads, 0);
});

test("host thinking-budget property must be own data without invoking outer getters", () => {
  const model = fauxProvider().getModel()!;
  const input = { effectiveSystemPrompt: "local", thinkingLevel: "high" as const, defaultModel: model, models: [model],
    streamSimple: () => { throw Error("transport must not run"); } };
  let reads = 0;
  const getter = Object.defineProperty({ ...input }, "thinkingBudgets", { get() { reads++; return { high: 1234 }; } });
  assert.throws(() => captureNativeHostContext(getter)); assert.equal(reads, 0);
  assert.throws(() => captureNativeHostContext(Object.assign(Object.create({ thinkingBudgets: { high: 1 } }) as object, input)));
  assert.deepEqual(capture(Object.assign(Object.create(null) as object, { high: 0 })).thinkingBudgets, { high: 0 });
});
