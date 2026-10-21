import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareNativeWriteCriteria } from "../../../src/native/write-criteria.js";

const criterion = { id: "value-correct", description: "Return the expected value", observableCheck: "Host test checks the output value" };

test("host criteria are copied, normalized, deeply frozen and optional", () => {
  assert.equal(prepareNativeWriteCriteria(undefined), undefined);
  const input = [{ ...criterion, description: " Return the expected value " }];
  const result = prepareNativeWriteCriteria(input)!;
  input[0]!.id = "changed";
  assert.deepEqual(result, [criterion]); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result[0]), true);
  assert.throws(() => { (result[0] as { id: string }).id = "injected"; }, TypeError);
});

test("malformed criteria refuse unknown authority fields, duplicate ids and invalid values", () => {
  const invalid = [null, "command", [], new Array(1), ["criterion"], [null],
    [{ ...criterion, approve: true }], [{ ...criterion, id: "bad id" }], [{ ...criterion, id: "x".repeat(65) }],
    [{ ...criterion, description: " " }], [{ ...criterion, observableCheck: "x".repeat(513) }], [{ ...criterion, observableCheck: "a\0b" }],
    [criterion, criterion], Array.from({ length: 9 }, (_, index) => ({ ...criterion, id: `id-${index}` })),
    [Object.create(criterion) as unknown]];
  for (const value of invalid) assert.throws(() => prepareNativeWriteCriteria(value), /acceptance criteria/i);
});

test("accessor and symbolic criterion fields are refused without invoking the accessor", () => {
  let invoked = false;
  const item = { ...criterion, get description() { invoked = true; return "malicious"; } };
  assert.throws(() => prepareNativeWriteCriteria([item]), /acceptance criteria/i);
  assert.equal(invoked, false);
  assert.throws(() => prepareNativeWriteCriteria([{ ...criterion, [Symbol("policy")]: true }]), /acceptance criteria/i);
});
