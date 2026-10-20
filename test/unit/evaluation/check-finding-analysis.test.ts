import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { createRunId } from "../../../src/domain/ids.js";
import type { BoundCheckFinding } from "../../../src/evaluation/check-findings.js";
import { CheckFindingAnalysisOwner, snapshotCheckFindingAnalysis } from "../../../src/evaluation/check-finding-analysis.js";
import type { NativeWriteFeedback } from "../../../src/native/write-loop.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const finding: BoundCheckFinding = Object.freeze({ id: "cause-1", criterionId: "host-check", severity: "major",
  message: "failed", runId: createRunId(), revision: "revision-1", generation: "generation-1", evidenceRef: "check-1" });
const feedback: NativeWriteFeedback = Object.freeze({ runId: finding.runId, artifactId: "artifact-1", exitCode: 7,
  stdoutText: "bounded stdout", stderrText: "bounded stderr", stdoutByteLength: 14, stderrByteLength: 14 });
const signal = new AbortController().signal;

test("100 identical pending and completed observations share one immutable analysis", async () => {
  const pending = deferred<unknown>();
  let calls = 0;
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ analyze: () => { calls++; return pending.promise; } })!);
  owner.setCurrent(finding);
  const requests = Array.from({ length: 100 }, () => owner.analyze(finding, feedback, signal));
  await Promise.resolve();
  assert.equal(calls, 1);
  const aliased = { summary: "advisory only" };
  pending.resolve(aliased);
  const rows = await Promise.all(requests);
  aliased.summary = "mutated";
  assert.equal(rows[0]?.state, "available");
  assert.equal(rows[0]?.summary, "advisory only");
  assert.ok(rows.every((row) => row === rows[0] && Object.isFrozen(row)));
  for (let i = 0; i < 100; i++) assert.equal(await owner.analyze(finding, feedback, signal), rows[0]);
  assert.equal(calls, 1);
  assert.equal(owner.project().current.length, 1);
  assert.ok(Object.isFrozen(owner.project().current));
});

test("exact tuple keeps different causes and evidence distinct and refuses at fixed capacity without eviction", async () => {
  let calls = 0;
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ capacity: 7, analyze: () => { calls++; return { summary: "analysis" }; } })!);
  const variants = [finding, { ...finding, id: "cause-2" }, { ...finding, criterionId: "criterion-2" },
    { ...finding, evidenceRef: "check-2" }, { ...finding, runId: createRunId() },
    { ...finding, revision: "revision-2" }, { ...finding, generation: "generation-2" }];
  for (const row of variants) assert.equal((await owner.analyze(row, feedback, signal)).state, "available");
  const refused = await owner.analyze({ ...finding, id: "capacity-overflow" }, feedback, signal);
  assert.equal(refused.state, "unavailable");
  assert.equal(refused.reason, "capacity");
  assert.equal(refused.finding.id, "capacity-overflow");
  assert.equal((await owner.analyze(finding, feedback, signal)).state, "available");
  assert.equal(calls, 7);
});

test("advancing before the next writer keeps late old-generation results historical", async () => {
  const pending = deferred<unknown>();
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ analyze: () => pending.promise })!);
  owner.setCurrent(finding);
  const result = owner.analyze(finding, feedback, signal);
  owner.setCurrent(undefined);
  assert.deepEqual(owner.project().current, []);
  owner.setCurrent({ ...finding, generation: "generation-2" });
  pending.resolve({ summary: "old result" });
  await result;
  assert.deepEqual(owner.project().current, []);
  assert.equal(owner.project().stale[0]?.finding.generation, "generation-1");
});

test("timeout aborts waiting but retains raw settlement and identical-flight history including late rejection", async () => {
  const pending = deferred<unknown>();
  const raw = new Set<Promise<void>>();
  let callbackSignal: AbortSignal | undefined;
  let calls = 0;
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ timeoutMs: 15,
    analyze: (input) => { calls++; callbackSignal = input.signal; return pending.promise; } })!, (flight) => {
    raw.add(flight); void flight.then(() => raw.delete(flight));
  });
  const result = await owner.analyze(finding, feedback, signal);
  assert.equal(result.reason, "timeout");
  assert.equal(callbackSignal?.aborted, true);
  assert.equal(raw.size, 1);
  assert.equal(await owner.analyze(finding, feedback, signal), result);
  assert.equal(calls, 1);
  pending.reject(new Error("private late exception"));
  await Promise.all(raw);
  assert.equal(raw.size, 0);
  assert.equal(result.state, "unavailable");
});

test("cancellation ends waiting and aborts callback without admitting a restart", async () => {
  const pending = deferred<unknown>();
  const controller = new AbortController();
  let callbackSignal: AbortSignal | undefined;
  let calls = 0;
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ analyze: (input) => {
    calls++; callbackSignal = input.signal; return pending.promise;
  } })!);
  const request = owner.analyze(finding, feedback, controller.signal);
  await Promise.resolve();
  controller.abort();
  const row = await request;
  assert.equal(row.reason, "cancelled");
  assert.equal(callbackSignal?.aborted, true);
  assert.equal(await owner.analyze(finding, feedback, controller.signal), row);
  assert.equal(calls, 1);
  pending.resolve({ summary: "too late" });
});

test("invalid or throwing analyzer output is unavailable without reading accessors or copying exceptions", async () => {
  let getterCalls = 0;
  const badGetter = { get summary() { getterCalls++; return "secret"; } };
  for (const output of [undefined, null, "summary", {}, { summary: 2 }, { summary: "" }, { summary: "x".repeat(65) },
    badGetter, Object.create({ summary: "inherited" })]) {
    const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ maxSummaryChars: 64, analyze: () => output })!);
    const row = await owner.analyze(finding, feedback, signal);
    assert.equal(row.state, "unavailable");
    assert.equal(JSON.stringify(row).includes("secret"), false);
  }
  assert.equal(getterCalls, 0);
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ analyze: () => { throw new Error("private exception"); } })!);
  assert.equal((await owner.analyze(finding, feedback, signal)).reason, "callback-failed");
});

test("configuration is own-data validated and snapshotted before asynchronous work", () => {
  let getters = 0;
  for (const config of [null, {}, { analyze: 2 }, Object.create({ analyze: () => ({ summary: "bad" }) }),
    { get analyze() { getters++; return () => ({ summary: "bad" }); } },
    { analyze: () => ({}), timeoutMs: NaN }, { analyze: () => ({}), timeoutMs: 0 },
    { analyze: () => ({}), timeoutMs: Infinity }, { analyze: () => ({}), capacity: 1.2 },
    { analyze: () => ({}), capacity: 0 }, { analyze: () => ({}), maxSummaryChars: 0 },
    { analyze: () => ({}), get capacity() { getters++; return 2; } }]) {
    assert.throws(() => snapshotCheckFindingAnalysis(config as never));
  }
  assert.equal(getters, 0);
  const original = { analyze: () => ({ summary: "original" }), timeoutMs: 25 };
  const snapshot = snapshotCheckFindingAnalysis(original)!;
  original.analyze = () => ({ summary: "changed" }); original.timeoutMs = 500;
  assert.equal(snapshot.timeoutMs, 25);
  assert.deepEqual(snapshot.analyze({ finding, feedback, signal }), { summary: "original" });
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshotCheckFindingAnalysis(undefined), undefined);
});

test("synchronous output is snapshotted before a queued alias mutation", async () => {
  const output = { summary: "original return value" };
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ analyze: () => {
    queueMicrotask(() => { output.summary = "later mutation"; });
    return output;
  } })!);
  const result = await owner.analyze(finding, feedback, signal);
  assert.equal(output.summary, "later mutation");
  assert.equal(result.summary, "original return value");
});

test("ordinary output with then accessor is rejected without Promise assimilation or getter execution", async () => {
  let getters = 0;
  const output = { summary: "advisory", get then() { getters++; return undefined; } };
  const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ analyze: () => output })!);
  assert.equal((await owner.analyze(finding, feedback, signal)).state, "unavailable");
  assert.equal(getters, 0);
});

test("owner snapshots mutable resolved configuration rather than retaining a structural alias", async () => {
  const config = { analyze: () => ({ summary: "original callback" }), timeoutMs: 25, capacity: 1, maxSummaryChars: 100 };
  const owner = new CheckFindingAnalysisOwner(config);
  config.analyze = () => ({ summary: "mutated callback" });
  config.timeoutMs = 0; config.capacity = 0; config.maxSummaryChars = 1;
  const row = await owner.analyze(finding, feedback, signal);
  assert.equal(row.state, "available"); assert.equal(row.summary, "original callback");
  assert.throws(() => new CheckFindingAnalysisOwner({ ...config, timeoutMs: NaN }), /analysis/);
});

test("cross-realm native Promise timeout retains actual settlement and consumes late resolution or rejection", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const context = createContext({});
    const output: unknown = runInContext("new Promise((resolve, reject) => { globalThis.release = resolve; globalThis.fail = reject; })", context);
    assert.equal(output instanceof Promise, false, "fixture must use a genuine foreign-realm Promise");
    const raw = new Set<Promise<void>>(); let calls = 0; let callbackSignal: AbortSignal | undefined;
    const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ timeoutMs: 15, analyze: (input) => {
      calls++; callbackSignal = input.signal; return output;
    } })!, (flight) => { raw.add(flight); void flight.then(() => raw.delete(flight)); });
    try {
      const result = await owner.analyze(finding, feedback, signal);
      assert.equal(result.reason, "timeout"); assert.equal(raw.size, 1); assert.equal(callbackSignal?.aborted, true);
      assert.equal(await owner.analyze(finding, feedback, signal), result); assert.equal(calls, 1);
      runInContext(outcome === "resolve" ? "release({summary:'late summary'})" : "fail(new Error('private late error'))", context);
      await Promise.all(raw);
      assert.equal(raw.size, 0); assert.equal(result.reason, "timeout"); assert.equal(result.summary, undefined);
    } finally { runInContext("release({summary:'cleanup'})", context); await Promise.all(raw); }
  }
});

for (const scenario of ["own constructor getter", "inherited constructor accessor", "ordinary subclass", "custom data species"] as const) {
  test(`unsupported Promise ${scenario} is refused without invoking metadata getters and remains host-owned`, async () => {
    let reject!: (reason: unknown) => void;
    class HostPromise<T> extends Promise<T> {}
    const PromiseType = scenario === "ordinary subclass" ? HostPromise : Promise;
    const output = new PromiseType<unknown>((_resolve, no) => { reject = no; });
    // Attach the host's rejection consumer before decorating its own Promise.
    // Unsupported returns remain host-owned; the library must not claim drain.
    const hostSettled = Promise.prototype.then.call(output, () => undefined, () => undefined) as Promise<void>;
    let getters = 0;
    if (scenario === "own constructor getter") {
      Object.defineProperty(output, "constructor", { get() { getters++; throw new Error("private constructor getter"); } });
    } else if (scenario === "inherited constructor accessor") {
      Object.setPrototypeOf(output, Object.create(Promise.prototype, {
        constructor: { get() { getters++; throw new Error("private inherited constructor getter"); } }
      }));
    } else if (scenario === "custom data species") {
      const constructor = function HostConstructor() {};
      Object.defineProperty(constructor, Symbol.species, { value: Promise });
      Object.setPrototypeOf(output, Object.create(Promise.prototype, { constructor: { value: constructor } }));
    }
    const raw = new Set<Promise<void>>();
    const owner = new CheckFindingAnalysisOwner(snapshotCheckFindingAnalysis({ timeoutMs: 15, analyze: () => output })!,
      (flight) => { raw.add(flight); void flight.then(() => raw.delete(flight)); });
    try {
      const row = await owner.analyze(finding, feedback, signal);
      assert.equal(row.state, "unavailable"); assert.equal(row.reason, "invalid-output");
      assert.equal(getters, 0); assert.equal(raw.size, 0, "unsupported async return is not advertised as shutdown-owned");
    } finally { reject(new Error("host-owned cleanup rejection")); await hostSettled; }
    assert.equal(getters, 0);
  });
}
