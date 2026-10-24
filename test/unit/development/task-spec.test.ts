import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { parseDevelopmentTaskSpec, snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";

function valid() {
  return { version: 1, objective: "Repair the literal scoped value", context: ["src/value.ts"],
    write: { allow: ["src"], protect: ["checks"] },
    prepare: [{ id: "deps", command: "node", args: ["--flag", "literal quoted arg", "$(literal)", "你好"] }],
    checks: [{ id: "regression", command: "node", args: ["check.mjs", "--literal"], verifierVersion: "v1",
      protectedPaths: ["checks"], visibleToWorker: false,
      expect: { baseline: "fail", failureAssertion: "value-is-correct" } }],
    budget: { totalSeconds: 30, prepareSeconds: 60, checkSeconds: 40, workerSeconds: 120 }, worker: { model: "inherit" } };
}
function invalid(mutate: (value: ReturnType<typeof valid>) => unknown): void {
  const value = valid();
  assert.throws(() => snapshotDevelopmentTaskSpec(mutate(value)), DomainValidationError);
}

test("TaskSpec preserves optional repair and cumulative time limits without changing phase limits", () => {
  const original = valid();
  const actual = snapshotDevelopmentTaskSpec({ ...original, worker: { model: "inherit", maxAttempts: 3 },
    budget: { ...original.budget, workerTotalSeconds: 0.401, checkTotalSeconds: 80 } });
  assert.equal(actual.worker.maxAttempts, 3);
  assert.equal(actual.budget.workerTotalSeconds, 0.401);
  assert.equal(actual.budget.checkTotalSeconds, 80);
  assert.equal(actual.budget.checkSeconds, original.budget.checkSeconds);
});

test("TaskSpec validates optional cumulative durations and repair count as ordinary data", () => {
  for (const count of [0, 6, 1.1, NaN, Infinity]) {
    assert.throws(() => snapshotDevelopmentTaskSpec({ ...valid(), worker: { model: "inherit", maxAttempts: count } }));
  }
  for (const field of ["workerTotalSeconds", "checkTotalSeconds"] as const) {
    for (const value of [0, -1, NaN, Infinity, 1800.001, 0.0001]) {
      assert.throws(() => snapshotDevelopmentTaskSpec({ ...valid(), budget: { ...valid().budget, [field]: value } }));
    }
    let reads = 0;
    const budget = Object.defineProperty(valid().budget, field, { get() { reads++; return 3; } });
    assert.throws(() => snapshotDevelopmentTaskSpec({ ...valid(), budget }));
    assert.equal(reads, 0);
  }
});

test("valid TaskSpec preserves literal commands, expectation and nonrenewing budget values", () => {
  const value = valid();
  const actual = snapshotDevelopmentTaskSpec(value);
  assert.equal(actual.version, 1); assert.equal(actual.objective, value.objective);
  assert.deepEqual(actual.context, value.context); assert.deepEqual(actual.write, value.write);
  assert.deepEqual(actual.prepare, value.prepare); assert.deepEqual(actual.checks[0]!.args, value.checks[0]!.args);
  assert.deepEqual(actual.checks[0]!.expect, { baseline: "fail", failureAssertion: "value-is-correct" });
  assert.equal(actual.checks[0]!.visibleToWorker, false);
  assert.deepEqual(actual.budget, value.budget, "a smaller total may stop before individual phase limits");
  assert.deepEqual(actual.worker, { model: "inherit" });
});

test("optional context, preparation and worker receive explicit safe defaults", () => {
  const { context: _context, prepare: _prepare, worker: _worker, ...value } = valid();
  value.checks[0]!.expect = { baseline: "pass" } as typeof value.checks[0]["expect"];
  const actual = snapshotDevelopmentTaskSpec(value);
  assert.deepEqual(actual.context, []); assert.deepEqual(actual.prepare, []);
  assert.deepEqual(actual.worker, { model: "inherit" });
  assert.deepEqual(actual.checks[0]!.expect, { baseline: "pass" });
});

test("snapshot detaches every nested input and deeply freezes normalized values", () => {
  const value = valid(); const actual = snapshotDevelopmentTaskSpec(value);
  value.context.push("other.txt"); value.write.allow.push("outside"); value.prepare[0]!.args[0] = "changed";
  value.checks[0]!.args.push("changed"); value.checks[0]!.expect.failureAssertion = "changed"; value.budget.totalSeconds = 1;
  assert.deepEqual(actual.context, ["src/value.ts"]); assert.deepEqual(actual.write.allow, ["src"]);
  assert.equal(actual.prepare[0]!.args[0], "--flag"); assert.deepEqual(actual.checks[0]!.args, ["check.mjs", "--literal"]);
  assert.deepEqual(actual.checks[0]!.expect, { baseline: "fail", failureAssertion: "value-is-correct" });
  assert.equal(actual.budget.totalSeconds, 30);
  const frozen = (entry: unknown): void => {
    if (entry !== null && typeof entry === "object") {
      assert.ok(Object.isFrozen(entry)); for (const item of Object.values(entry)) frozen(item);
    }
  };
  frozen(actual);
});

test("JSON parsing admits the 64 KiB UTF8 boundary and rejects malformed or oversized text", () => {
  const encoded = JSON.stringify(valid());
  const boundary = " ".repeat(65536 - Buffer.byteLength(encoded)) + encoded;
  assert.equal(Buffer.byteLength(boundary), 65536);
  assert.equal(parseDevelopmentTaskSpec(boundary).checks[0]!.id, "regression");
  assert.throws(() => parseDevelopmentTaskSpec("{broken"), DomainValidationError);
  const multi = JSON.stringify({ ...valid(), objective: "你".repeat(4096) });
  const oversized = " ".repeat(55000) + multi;
  assert.ok(oversized.length < 65536 && Buffer.byteLength(oversized) > 65536);
  assert.throws(() => parseDevelopmentTaskSpec(oversized), DomainValidationError);
});

for (const field of ["objective", "budget", "check expectation", "array element"] as const) {
  test(`TaskSpec rejects ${field} accessors without calling them`, () => {
    const value = valid(); let reads = 0;
    const target = field === "objective" ? value : field === "budget" ? value.budget :
      field === "check expectation" ? value.checks[0]!.expect : value.prepare[0]!.args;
    const key = field === "objective" ? "objective" : field === "budget" ? "totalSeconds" : field === "check expectation" ? "failureAssertion" : "0";
    Object.defineProperty(target, key, { enumerable: true, get() { reads++; return "getter output"; } });
    assert.throws(() => snapshotDevelopmentTaskSpec(value), DomainValidationError);
    assert.equal(reads, 0);
  });
}

for (const [name, mutate] of [
  ["unknown root field", (v) => ({ ...v, unsupported: true })],
  ["unsupported version", (v) => ({ ...v, version: 2 })],
  ["empty objective", (v) => ({ ...v, objective: " " })],
  ["oversized objective", (v) => ({ ...v, objective: "x".repeat(4097) })],
  ["missing failure assertion", (v) => ({ ...v, checks: [{ ...v.checks[0], expect: { baseline: "fail" } }] })],
  ["empty failure assertion", (v) => ({ ...v, checks: [{ ...v.checks[0], expect: { baseline: "fail", failureAssertion: "" } }] })],
  ["assertion on passing baseline", (v) => ({ ...v, checks: [{ ...v.checks[0], expect: { baseline: "pass", failureAssertion: "invalid" } }] })],
  ["arbitrary baseline", (v) => ({ ...v, checks: [{ ...v.checks[0], expect: { baseline: "unknown" } }] })],
  ["missing checks", (v) => ({ ...v, checks: [] })],
  ["duplicate checks", (v) => ({ ...v, checks: [v.checks[0], v.checks[0]] })],
  ["duplicate preparation", (v) => ({ ...v, prepare: [v.prepare[0], v.prepare[0]] })],
  ["prepare NUL argv", (v) => ({ ...v, prepare: [{ ...v.prepare[0], args: ["bad\0arg"] }] })],
  ["free shell run", (v) => ({ ...v, prepare: [{ id: "deps", run: "node check.mjs && echo success" }] })],
  ["worker model override", (v) => ({ ...v, worker: { model: "different-model" } })],
  ["USD budget", (v) => ({ ...v, budget: { ...v.budget, maxUsd: 1 } })],
  ["unknown nested budget", (v) => ({ ...v, budget: { ...v.budget, timeout: 1 } })],
  ["empty writable scope", (v) => ({ ...v, write: { ...v.write, allow: [] } })],
  ["unsupported glob syntax", (v) => ({ ...v, write: { ...v.write, allow: ["src/**/*.{js,ts}"] } })],
  ["context glob", (v) => ({ ...v, context: ["src/*.ts"] })],
  ["context escape", (v) => ({ ...v, context: ["../outside"] })],
  ["absolute context", (v) => ({ ...v, context: ["C:/outside"] })],
  ["context Git metadata", (v) => ({ ...v, context: [".git/config"] })],
  ["too many context paths", (v) => ({ ...v, context: Array.from({ length: 33 }, (_, i) => `file${i}`) })],
  ["custom root prototype", (v) => Object.assign(Object.create({ inherited: true }) as object, v)],
  ["custom nested prototype", (v) => ({ ...v, budget: Object.assign(Object.create({ inherited: true }) as object, v.budget) })],
  ["array hole", (v) => ({ ...v, context: new Array(1) })],
  ["decorated array", (v) => ({ ...v, context: Object.assign(["src"], { extra: true }) })],
  ["inherited array values", (v) => ({ ...v, context: Object.setPrototypeOf(["src"], Object.create(Array.prototype)) })],
  ["checker timeout beyond existing limit", (v) => ({ ...v, checks: [{ ...v.checks[0], timeoutMs: 40001 }] })]
] satisfies readonly [string, (value: ReturnType<typeof valid>) => unknown][]) {
  test(`TaskSpec refuses ${name}`, () => invalid(mutate));
}

for (const value of [0, -1, Infinity, NaN, 1800.001, 0.0001]) {
  test(`TaskSpec refuses non-executable phase duration ${String(value)}`, () => {
    invalid((v) => ({ ...v, budget: { ...v.budget, prepareSeconds: value } }));
  });
}

test("TaskSpec preserves legal millisecond precision at both duration bounds", () => {
  const actual = snapshotDevelopmentTaskSpec({ ...valid(), budget: { totalSeconds: 0.001, prepareSeconds: 1800, checkSeconds: 1.001, workerSeconds: 0.123 } });
  assert.equal(actual.budget.totalSeconds, 0.001); assert.equal(actual.budget.prepareSeconds, 1800);
  assert.equal(actual.budget.checkSeconds, 1.001); assert.equal(actual.budget.workerSeconds, 0.123);
});

test("TaskSpec refuses Proxy inputs without invoking reflection traps", () => {
  let traps = 0;
  const proxied = new Proxy(valid(), {
    getPrototypeOf(target) { traps++; return Object.getPrototypeOf(target); },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    get(target, key, receiver) { traps++; return Reflect.get(target, key, receiver); }
  });
  assert.throws(() => snapshotDevelopmentTaskSpec(proxied), DomainValidationError);
  assert.equal(traps, 0);
});

test("TaskSpec refuses unsupported fields inside baseline expectations", () => {
  invalid((value) => ({ ...value, checks: [{ ...value.checks[0], expect: {
    baseline: "fail", failureAssertion: "value-is-correct", run: "shell command"
  } }] }));
});
