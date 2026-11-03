import assert from "node:assert/strict";
import { test } from "node:test";
import { authorTaskSpecFromWorkItem, type WorkItemTaskSpecInput } from "../../../src/development/work-item-task-spec.js";
import { createWorkQueue } from "../../../src/development/work-items.js";

function input(): WorkItemTaskSpecInput {
  return { item: { id: "repair-value", goal: "Repair [[file:src/value.ts]]", dependencies: ["prepare"], priority: 90,
    allowedScope: ["src", "test"], acceptance: [
      { id: "regression", command: "node", args: ["checks/regression.cjs", "literal arg"], verifierVersion: "v2",
        protectedPaths: ["checks", "config.json"], timeoutMs: 3000, maxStdoutBytes: 1024, maxStderrBytes: 512 },
      { id: "types", command: "node", args: ["checks/types.cjs"], verifierVersion: "v1", protectedPaths: ["checks"] }
    ] }, context: ["test/value.test.ts"], prepare: [], requiredWrites: ["test/value.test.ts"],
    checkExpectations: { types: { expect: { baseline: "pass" }, visibleToWorker: false },
      regression: { expect: { baseline: "fail", failureAssertion: "value-regression" } } },
    budget: { totalSeconds: 40, prepareSeconds: 5, checkSeconds: 8, workerSeconds: 8, usd: 1 },
    worker: { model: "inherit", maxAttempts: 2 } };
}

test("work-item authoring preserves identity, scope, every recipe and explicit host bindings", () => {
  const source = input(), result = authorTaskSpecFromWorkItem(source);
  assert.equal(result.workItemId, source.item.id);
  assert.equal(result.spec.objective, source.item.goal);
  assert.deepEqual(result.spec.write, { allow: source.item.allowedScope, protect: ["checks", "config.json"], require: source.requiredWrites });
  assert.deepEqual(result.spec.context, ["test/value.test.ts", "src/value.ts"]);
  assert.deepEqual(result.spec.budget, source.budget);
  assert.deepEqual(result.spec.worker, source.worker);
  assert.deepEqual(result.spec.prepare, []);
  assert.deepEqual(result.spec.checks.map(({ expect: _expect, visibleToWorker: _visible, ...recipe }) => recipe), source.item.acceptance);
  assert.deepEqual(result.spec.checks.map(check => check.id), ["regression", "types"]);
  assert.deepEqual(result.spec.checks.map(check => check.expect), [source.checkExpectations.regression!.expect, { baseline: "pass" }]);
  assert.equal(result.spec.checks[1]!.visibleToWorker, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.spec.checks[0]!.args), true);
});

test("work-item authoring preserves literal scope semantics instead of adopting TaskSpec globs", () => {
  const source = input();
  for (const prefix of ["src/**", "src/*.ts"]) {
    const item = { ...source.item, dependencies: [], allowedScope: [prefix] };
    assert.throws(() => createWorkQueue({ id: "literal-scope", authorityRef: "host:synthetic", items: [item] }), /literal/);
    assert.throws(() => authorTaskSpecFromWorkItem({ ...source, item, requiredWrites: [] }), /literal/);
  }
});

test("work-item authoring never omits a check or invents a missing baseline", () => {
  const source = input();
  for (const bindings of [{}, { regression: source.checkExpectations.regression },
    { ...source.checkExpectations, extra: { expect: { baseline: "pass" } } },
    { ...source.checkExpectations, types: {} }]) {
    assert.throws(() => authorTaskSpecFromWorkItem({ ...source, checkExpectations: bindings } as WorkItemTaskSpecInput));
  }
  const duplicate = { ...source.item, acceptance: [source.item.acceptance[0]!, source.item.acceptance[0]!] };
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, item: duplicate }), /duplicate/);
});

test("host bindings cannot replace queue scope, objective, checker argv or inherit authority", () => {
  const source = input();
  for (const override of [{ write: { allow: ["outside"] } }, { objective: "replacement" }, { authorityRef: "host:grant" }, { checks: [] }]) {
    assert.throws(() => authorTaskSpecFromWorkItem({ ...source, ...override } as WorkItemTaskSpecInput), /unsupported field/);
  }
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, checkExpectations: { ...source.checkExpectations,
    regression: { ...source.checkExpectations.regression, command: "other", args: [] } } } as WorkItemTaskSpecInput), /unsupported field/);
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, requiredWrites: ["outside.txt"] }), /required.*writ/);
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, requiredWrites: ["checks/regression.cjs"] }), /protected|writ/);
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, budget: undefined } as unknown as WorkItemTaskSpecInput));
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, prepare: undefined } as unknown as WorkItemTaskSpecInput));
  assert.throws(() => authorTaskSpecFromWorkItem({ ...source, context: undefined } as unknown as WorkItemTaskSpecInput));
});

test("authoring detaches the draft without freezing or mutating caller-owned definitions", () => {
  const source = input(), before = JSON.stringify(source), result = authorTaskSpecFromWorkItem(source);
  assert.equal(JSON.stringify(source), before);
  assert.equal(Object.isFrozen(source.item), false);
  (source.item.allowedScope as string[]).push("other");
  (source.item.acceptance[0]!.args as string[])[0] = "other.cjs";
  (source.context as string[]).push("other.txt");
  assert.deepEqual(result.spec.write.allow, ["src", "test"]);
  assert.equal(result.spec.checks[0]!.args[0], "checks/regression.cjs");
  assert.deepEqual(result.spec.context, ["test/value.test.ts", "src/value.ts"]);
  assert.equal("dependencies" in result.spec, false);
  assert.equal("authorityRef" in result, false);
});

test("work-item authoring rejects accessors and proxies without invoking caller code", () => {
  let invoked = 0;
  const getter = () => { invoked++; return []; };
  const proxy = () => new Proxy([], { get() { invoked++; return []; }, ownKeys() { invoked++; return []; }, getPrototypeOf() { invoked++; return Array.prototype; } });
  const source = input();
  const acceptance = [...source.item.acceptance];
  Object.defineProperty(acceptance, 0, { get: getter });
  const args = [] as string[];
  Object.defineProperty(args, 0, { get: getter });
  const scopes = [] as string[];
  Object.defineProperty(scopes, 0, { get: getter });
  const bindings = { ...source.checkExpectations };
  Object.defineProperty(bindings, "types", { get: getter });
  const cases = [Object.defineProperty({ ...source }, "item", { get: getter }),
    { ...source, item: Object.defineProperty({ ...source.item }, "goal", { get: getter }) },
    { ...source, item: { ...source.item, acceptance } },
    { ...source, item: { ...source.item, acceptance: proxy() } },
    { ...source, item: { ...source.item, acceptance: [{ ...source.item.acceptance[0], args }] } },
    { ...source, item: { ...source.item, acceptance: [{ ...source.item.acceptance[0], args: proxy() }] } },
    { ...source, item: { ...source.item, allowedScope: scopes } },
    { ...source, item: { ...source.item, allowedScope: proxy() } },
    { ...source, checkExpectations: bindings },
    { ...source, context: proxy() }];
  for (const value of cases) assert.throws(() => authorTaskSpecFromWorkItem(value as WorkItemTaskSpecInput));
  assert.equal(invoked, 0);
});
