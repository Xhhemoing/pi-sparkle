import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
function input() { return { version: 1, objective: "Repair value", context: ["value.txt"],
  write: { allow: ["src/plan.rs"], protect: ["checks"] }, checks: [{ id: "policy", command: "node", args: ["checks/policy.cjs"],
    verifierVersion: "v1", protectedPaths: ["checks"], expect: { baseline: "pass" } }],
  budget: { totalSeconds: 30, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 } }; }
test("explicit objective file references become the same required context with stable normalization", () => {
  const source = { ...input(), objective: "Use [[file:docs/design.md]] and [[file:value.txt]]; example `future/out.rs` stays prose" };
  const spec = snapshotDevelopmentTaskSpec(source);
  assert.deepEqual(spec.context, ["value.txt", "docs/design.md"]);
  assert.equal(spec.objective, source.objective);
  assert.deepEqual(snapshotDevelopmentTaskSpec(spec), spec);
});
test("explicit objective file references reject malformed unsafe or over-capacity declarations", () => {
  for (const objective of ["[[file:]]", "[[file:../other]]", "[[file:/absolute]]", "[[file:*.rs]]", "[[file:unclosed", "[[file:line\nbreak]]"]) {
    assert.throws(() => snapshotDevelopmentTaskSpec({ ...input(), objective }), { name: "DomainValidationError" }, objective);
  }
  assert.throws(() => snapshotDevelopmentTaskSpec({ ...input(), context: Array.from({ length: 32 }, (_, i) => `file${i}.txt`), objective: "[[file:extra.txt]]" }), /32|context/);
  assert.deepEqual(snapshotDevelopmentTaskSpec({ ...input(), objective: "Read `docs/unselected.md` and future/foo.rs" }).context, ["value.txt"]);
});
test("required writable outputs may be future files but must remain inside allow and outside protect", () => {
  const source = { ...input(), write: { ...input().write, allow: ["src/**", "tests/*.rs"], require: ["tests/plan_fixture.rs"] } };
  assert.deepEqual(snapshotDevelopmentTaskSpec(source).write, source.write);
  for (const write of [
    { ...input().write, require: ["tests/plan_fixture.rs"] },
    { allow: ["tests/**"], protect: ["tests/no_write_api.rs"], require: ["tests/no_write_api.rs"] },
    { allow: ["tests/**"], protect: ["tests/private/**"], require: ["tests/private/fixture.rs"] }
  ]) assert.throws(() => snapshotDevelopmentTaskSpec({ ...input(), write }), /required.*writ|protected/);
  assert.deepEqual(snapshotDevelopmentTaskSpec(input()).write, input().write, "omitted requirement preserves old shape");
});
test("required writable paths retain ordinary-data and literal-array validation", () => {
  const hole = ["src/plan.rs", "src/plan.rs"]; delete hole[0];
  for (const require of [["tests/*.rs"], ["../outside"], ["src/plan.rs", "src/plan.rs"], Array.from({ length: 33 }, (_, i) => `src/file${i}.rs`), hole]) {
    assert.throws(() => snapshotDevelopmentTaskSpec({ ...input(), write: { ...input().write, require } }));
  }
  let traps = 0;
  const proxy = new Proxy([], { getPrototypeOf() { traps++; throw Error("proxy evaluated"); }, ownKeys() { traps++; throw Error("proxy evaluated"); }, get() { traps++; throw Error("proxy evaluated"); } });
  assert.throws(() => snapshotDevelopmentTaskSpec({ ...input(), write: { ...input().write, require: proxy } }));
  const accessor = Object.defineProperty(input().write, "require", { get() { traps++; return ["src/plan.rs"]; } });
  assert.throws(() => snapshotDevelopmentTaskSpec({ ...input(), write: accessor })); assert.equal(traps, 0);
});
