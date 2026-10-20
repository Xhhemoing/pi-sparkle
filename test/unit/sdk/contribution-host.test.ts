import assert from "node:assert/strict";
import { test } from "node:test";
import { createContributionHost, type ContributionDefinition, type ContributionPlugin, type ContributionRequest } from "../../../src/sdk/host.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const request = (): ContributionRequest => ({ generationId: "g1", revision: "r1", objective: "Inspect task", selectedFiles: [{ path: "a.ts" }] });
function plugin(load: ContributionPlugin["load"], overrides: Partial<ContributionPlugin> = {}): ContributionPlugin {
  return { id: "plugin", enabled: true, apiVersion: 1, requiredCapabilities: ["files"], contributions: [{ kind: "context", id: "context" }], load, ...overrides };
}
const context = (text = "context"): ContributionDefinition => ({ kind: "context", id: "context", provide: async () => ({ items: [{ text }] }) });
const host = (plugins: readonly ContributionPlugin[], core: readonly ContributionDefinition[] = []) => createContributionHost({ generationId: "g1", capabilities: ["files"], plugins, core });

test("supported SDK entry supplies read-only context and diagnostic observations", async () => {
  const h = host([plugin(async () => [context(), { kind: "diagnostic", id: "diagnostic", diagnose: async () => ({ findings: [{ severity: "warning", message: "Inspect manually" }] }) }], { contributions: [{ kind: "context", id: "context" }, { kind: "diagnostic", id: "diagnostic" }] })]);
  assert.deepEqual(await h.context("context", request()), { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "context" }] } });
  assert.deepEqual(await h.diagnose("diagnostic", request()), { status: "available", generationId: "g1", revision: "r1", value: { findings: [{ severity: "warning", message: "Inspect manually" }] } });
  assert.equal((await h.diagnose("missing", request())).status, "unavailable");
  await h.close();
});

test("disabled, incompatible API and missing capabilities never activate", async () => {
  for (const overrides of [{ enabled: false }, { apiVersion: 2 }, { requiredCapabilities: ["unavailable"] }]) {
    let loads = 0;
    const h = host([plugin(async () => { loads++; return [context()]; }, overrides)]);
    assert.equal((await h.context("context", request())).status, "unavailable");
    assert.equal(loads, 0);
    await h.close();
  }
});

test("concurrent first uses share one activation and snapshot host configuration", async () => {
  const loaded = deferred<readonly ContributionDefinition[]>();
  let loads = 0;
  const capabilities = ["files"];
  const manifest = plugin(async (environment) => { loads++; assert.deepEqual(environment.capabilities, ["files"]); return loaded.promise; });
  const h = createContributionHost({ generationId: "g1", capabilities, plugins: [manifest] });
  capabilities.push("later");
  const first = h.context("context", request());
  const second = h.context("context", request());
  loaded.resolve([context()]);
  assert.equal((await first).status, "available");
  assert.equal((await second).status, "available");
  assert.equal(loads, 1);
  assert.deepEqual(h.capabilities, ["files"]);
  assert.ok(Object.isFrozen(h));
  await h.close();
});

test("duplicate declarations including core fail before loading", () => {
  let loads = 0;
  const p = plugin(async () => { loads++; return [context()]; });
  assert.throws(() => host([p, { ...p, id: "other", enabled: false }]), /duplicate/i);
  assert.throws(() => host([p], [context()]), /duplicate/i);
  assert.equal(loads, 0);
});

test("mismatched, duplicate, malformed or throwing activations publish no callbacks", async () => {
  const badDefinitions = [
    [context(), { kind: "context", id: "unexpected", provide: async () => ({ items: [] }) }],
    [context(), context()],
    [{ kind: "diagnostic", id: "context", diagnose: async () => ({ findings: [] }) }],
    [{ kind: "context", id: "context", provide: "invalid" }],
  ];
  for (const definitions of badDefinitions) {
    const h = host([plugin(async () => definitions as readonly ContributionDefinition[])]);
    assert.equal((await h.context("context", request())).status, "unavailable");
    assert.equal((await h.context("context", request())).status, "unavailable");
    await h.close();
  }
  let loads = 0;
  const h = host([plugin(async () => { loads++; throw new Error("load failed"); })]);
  assert.equal((await h.context("context", request())).status, "unavailable");
  assert.equal((await h.context("context", request())).status, "unavailable");
  assert.equal(loads, 1);
  await h.close();
});

test("request and response data are bounded copied snapshots without extra fields", async () => {
  const entered = deferred<void>();
  const finish = deferred<void>();
  const output = { items: [{ text: "original", secret: "not projected" }], secret: "not projected" };
  const h = host([], [{ kind: "context", id: "context", provide: async (input) => {
    entered.resolve(); await finish.promise;
    assert.equal(input.objective, "Inspect task");
    assert.deepEqual(input.selectedFiles, [{ path: "a.ts" }]);
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.selectedFiles[0]));
    assert.equal("secret" in input, false);
    return output;
  } }]);
  const input = { ...request(), selectedFiles: [{ path: "a.ts" }], secret: "not projected" };
  const pending = h.context("context", input);
  await entered.promise;
  input.objective = "mutated"; input.selectedFiles[0]!.path = "other.ts";
  finish.resolve();
  const result = await pending;
  output.items[0]!.text = "mutated output";
  assert.deepEqual(result, { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "original" }] } });
  if (result.status === "available") assert.ok(Object.isFrozen(result.value.items[0]));
  assert.equal((await h.context("context", { ...request(), objective: "x".repeat(16_385) })).status, "unavailable");
  assert.equal((await h.context("context", { ...request(), generationId: "old" })).status, "unavailable");
  await h.close();
  const oversized = host([], [{ kind: "context", id: "context", provide: async () => ({ items: [{ text: "x".repeat(32_769) }] }) }]);
  assert.equal((await oversized.context("context", request())).status, "unavailable");
  await oversized.close();
});

test("one caller aborts promptly without poisoning shared activation or invoking its callback", async () => {
  const loaded = deferred<readonly ContributionDefinition[]>();
  let loads = 0, calls = 0;
  const h = host([plugin(async () => { loads++; return loaded.promise; })]);
  const caller = new AbortController();
  const first = h.context("context", request(), caller.signal);
  const second = h.context("context", request());
  caller.abort();
  assert.deepEqual(await first, { status: "unavailable", reason: "aborted" });
  loaded.resolve([{ kind: "context", id: "context", provide: async () => { calls++; return { items: [] }; } }]);
  assert.equal((await second).status, "available");
  assert.equal(loads, 1); assert.equal(calls, 1);
  await h.close();
});

test("close stops admission, aborts lifetime, waits for cooperative calls and suppresses late results", async () => {
  const entered = deferred<void>(), settle = deferred<void>();
  let sawAbort = false;
  const h = host([], [{ kind: "context", id: "context", provide: async (_input, signal) => {
    signal.addEventListener("abort", () => { sawAbort = true; }, { once: true });
    entered.resolve(); await settle.promise;
    return { items: [{ text: "too late" }] };
  } }]);
  const pending = h.context("context", request());
  await entered.promise;
  let drained = false;
  const closing = h.close().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(sawAbort, true); assert.equal(drained, false);
  assert.deepEqual(await h.context("context", request()), { status: "unavailable", reason: "closed" });
  settle.resolve(); await closing;
  assert.deepEqual(await pending, { status: "unavailable", reason: "closed" });
  assert.equal(drained, true);
});

test("close waits for activation and never publishes definitions from retired generation", async () => {
  const entered = deferred<void>(), loaded = deferred<readonly ContributionDefinition[]>();
  let calls = 0;
  const h = host([plugin(async ({ signal }) => { entered.resolve(); await loaded.promise; assert.equal(signal.aborted, true); return [{ kind: "context", id: "context", provide: async () => { calls++; return { items: [] }; } }]; })]);
  const pending = h.context("context", request());
  await entered.promise;
  let drained = false;
  const closing = h.close().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  loaded.resolve([]); await closing;
  assert.deepEqual(await pending, { status: "unavailable", reason: "closed" });
  assert.equal(calls, 0);
});

test("wrong contribution kind and pre-aborted or invalid requests do not load", async () => {
  let loads = 0;
  const h = host([plugin(async () => { loads++; return [context()]; })]);
  assert.deepEqual(await h.diagnose("context", request()), { status: "unavailable", reason: "missing" });
  const aborted = new AbortController(); aborted.abort();
  assert.deepEqual(await h.context("context", request(), aborted.signal), { status: "unavailable", reason: "aborted" });
  assert.deepEqual(await h.context("context", { ...request(), revision: "" }), { status: "unavailable", reason: "invalid-request" });
  assert.equal(loads, 0);
  await h.close();
});

test("diagnostic callback failure or invalid output is unavailable without a passing observation", async () => {
  for (const diagnose of [async () => { throw new Error("no observation"); }, async () => ({ findings: [{ severity: "pass", message: "not a diagnostic" }] }), async () => ({ findings: Array.from({ length: 65 }, () => ({ severity: "info", message: "too many" })) })]) {
    const h = host([], [{ kind: "diagnostic", id: "diagnostic", diagnose: diagnose as () => Promise<{ findings: [] }> }]);
    assert.deepEqual(await h.diagnose("diagnostic", request()), { status: "unavailable", reason: "failed" });
    await h.close();
  }
});

test("closing during response snapshot prevents late context and diagnostic publication", async () => {
  for (const kind of ["context", "diagnostic"] as const) {
    let closing: Promise<void> | undefined;
    const h = host([], kind === "context" ? [{ kind, id: "context", provide: async () => ({
      get items() { closing = h.close(); return [{ text: "too late" }]; },
    }) }] : [{ kind, id: "diagnostic", diagnose: async () => ({
      get findings() { closing = h.close(); return [{ severity: "warning" as const, message: "too late" }]; },
    }) }]);
    const result = kind === "context" ? await h.context("context", request()) : await h.diagnose("diagnostic", request());
    assert.deepEqual(result, { status: "unavailable", reason: "closed" });
    assert.ok(closing);
    await closing;
  }
});

test("caller abort after callback entry remains tracked until actual settlement at close", async () => {
  const entered = deferred<void>(), settle = deferred<void>();
  let callbackSignal: AbortSignal | undefined;
  const h = host([], [{ kind: "context", id: "context", provide: async (_request, signal) => {
    callbackSignal = signal; entered.resolve(); await settle.promise;
    return { items: [{ text: "late" }] };
  } }]);
  const caller = new AbortController();
  const result = h.context("context", request(), caller.signal);
  await entered.promise;
  caller.abort();
  assert.deepEqual(await result, { status: "unavailable", reason: "aborted" });
  assert.equal(callbackSignal?.aborted, true);
  let drained = false;
  const closing = h.close().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  settle.resolve(); await closing;
  assert.equal(drained, true);
});

test("manifest and declaration mutations after construction cannot change activation or routing", async () => {
  let loads = 0;
  const requiredCapabilities = ["files"];
  const declarations: { kind: "context"; id: string }[] = [{ kind: "context", id: "context" }];
  const manifest = { ...plugin(async () => { loads++; return [context("original loader")]; }), requiredCapabilities, contributions: declarations };
  const plugins = [manifest];
  const h = host(plugins);
  manifest.enabled = false; manifest.apiVersion = 2;
  manifest.load = async () => { throw new Error("replacement loader"); };
  requiredCapabilities.push("absent"); declarations[0]!.id = "changed"; declarations.push({ kind: "context", id: "extra" }); plugins.length = 0;
  assert.deepEqual(await h.context("context", request()), { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "original loader" }] } });
  assert.equal((await h.context("changed", request())).status, "unavailable");
  assert.equal(loads, 1);
  await h.close();
});

test("diagnostic output is deeply frozen, copied and excludes undeclared fields", async () => {
  const output = { findings: [{ severity: "warning" as const, message: "original", path: "a.ts", secret: "excluded" }], secret: "excluded" };
  const h = host([], [{ kind: "diagnostic", id: "diagnostic", diagnose: async () => output }]);
  const first = await h.diagnose("diagnostic", request());
  output.findings[0]!.message = "changed";
  assert.deepEqual(first, { status: "available", generationId: "g1", revision: "r1", value: { findings: [{ severity: "warning", message: "original", path: "a.ts" }] } });
  if (first.status === "available") assert.ok(Object.isFrozen(first) && Object.isFrozen(first.value) && Object.isFrozen(first.value.findings) && Object.isFrozen(first.value.findings[0]));
  const second = await h.diagnose("diagnostic", request());
  if (second.status !== "available") assert.fail("second diagnostic must be available");
  assert.equal(second.value.findings[0]?.message, "changed");
  await h.close();
});

test("combined response bound includes context sources and diagnostic paths", async () => {
  const text = "x".repeat(32_768);
  const contextOutput: { items: { text: string; source?: string }[] } = { items: [{ text }, { text }] };
  const diagnosticOutput: { findings: { severity: "info"; message: string; path?: string }[] } = { findings: [{ severity: "info", message: text }, { severity: "info", message: text }] };
  const h = host([], [
    { kind: "context", id: "context", provide: async () => contextOutput },
    { kind: "diagnostic", id: "diagnostic", diagnose: async () => diagnosticOutput },
  ]);
  assert.equal((await h.context("context", request())).status, "available");
  assert.equal((await h.diagnose("diagnostic", request())).status, "available");
  contextOutput.items[0]!.source = "a"; diagnosticOutput.findings[0]!.path = "a";
  assert.deepEqual(await h.context("context", request()), { status: "unavailable", reason: "failed" });
  assert.deepEqual(await h.diagnose("diagnostic", request()), { status: "unavailable", reason: "failed" });
  await h.close();
});

test("diagnostic severity is validated and published from one getter read", async () => {
  let reads = 0;
  const h = host([], [{ kind: "diagnostic", id: "diagnostic", diagnose: async () => ({ findings: [{
    get severity() { return (++reads === 1 ? "warning" : "pass") as "warning"; }, message: "observed",
  }] }) }]);
  assert.deepEqual(await h.diagnose("diagnostic", request()), { status: "available", generationId: "g1", revision: "r1", value: { findings: [{ severity: "warning", message: "observed" }] } });
  assert.equal(reads, 1);
  await h.close();
});

test("activation publishes the exact callback validated on its first getter read", async () => {
  let reads = 0;
  const h = host([plugin(async () => [context("good sibling"), { kind: "context", id: "flaky", get provide() {
    return (++reads === 1 ? async () => ({ items: [{ text: "captured callback" }] }) : undefined) as Extract<ContributionDefinition, { kind: "context" }>["provide"];
  } }], { contributions: [{ kind: "context", id: "context" }, { kind: "context", id: "flaky" }] })]);
  assert.equal((await h.context("context", request())).status, "available");
  assert.deepEqual(await h.context("flaky", request()), { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "captured callback" }] } });
  assert.equal(reads, 1);
  await h.close();
});

test("manifest and declaration getter values are captured once before validation", async () => {
  const reads = { enabled: 0, apiVersion: 0, load: 0, kind: 0, id: 0 };
  const load: ContributionPlugin["load"] = async () => [context("captured manifest")];
  const h = host([{
    ...plugin(load),
    get enabled() { return ++reads.enabled === 1; },
    get apiVersion() { return ++reads.apiVersion === 1 ? 1 : 2; },
    get load() { return (++reads.load === 1 ? load : undefined) as ContributionPlugin["load"]; },
    contributions: [{ get kind() { return (++reads.kind === 1 ? "context" : "diagnostic") as "context"; }, get id() { reads.id++; return "context"; } }],
  }]);
  assert.deepEqual(await h.context("context", request()), { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "captured manifest" }] } });
  assert.deepEqual(reads, { enabled: 1, apiVersion: 1, load: 1, kind: 1, id: 1 });
  await h.close();
});

test("definition kind is captured once alongside its callback", async () => {
  let reads = 0;
  const h = host([plugin(async () => [{ get kind() { return (++reads === 1 ? "context" : "diagnostic") as "context"; }, id: "context", provide: async () => ({ items: [{ text: "captured kind" }] }) }])]);
  assert.deepEqual(await h.context("context", request()), { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "captured kind" }] } });
  assert.equal(reads, 1);
  await h.close();
});

test("optional request revision and response source or path are copied from one read", async () => {
  const reads = { revision: 0, source: 0, path: 0 };
  const h = host([], [
    { kind: "context", id: "context", provide: async (input) => {
      assert.deepEqual(input.selectedFiles, [{ path: "a.ts", revision: "file-r1" }]);
      return { items: [{ text: "context", get source() { return (++reads.source === 1 ? "a.ts" : undefined) as string; } }] };
    } },
    { kind: "diagnostic", id: "diagnostic", diagnose: async () => ({ findings: [{ severity: "warning", message: "diagnostic", get path() { return (++reads.path === 1 ? "a.ts" : undefined) as string; } }] }) },
  ]);
  const input = { ...request(), selectedFiles: [{ path: "a.ts", get revision() { return (++reads.revision === 1 ? "file-r1" : undefined) as string; } }] };
  assert.deepEqual(await h.context("context", input), { status: "available", generationId: "g1", revision: "r1", value: { items: [{ text: "context", source: "a.ts" }] } });
  assert.deepEqual(await h.diagnose("diagnostic", request()), { status: "available", generationId: "g1", revision: "r1", value: { findings: [{ severity: "warning", message: "diagnostic", path: "a.ts" }] } });
  assert.deepEqual(reads, { revision: 1, source: 1, path: 1 });
  await h.close();
});
