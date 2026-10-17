import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn, setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue, type WorkItemDefinition, type WorkItemEvidence, type WorkQueue } from "../../../src/development/work-items.js";

const BASE = "a".repeat(40);
function item(id: string): WorkItemDefinition {
  return { id, goal: `Complete ${id}`, dependencies: [], allowedScope: [`src/${id}`], priority: 10,
    acceptance: [{ id: "tests", command: "node", args: ["--test"], verifierVersion: "v1" }] };
}
function evidence(id: string): WorkItemEvidence[] {
  return [{ source: "host-command", workItemId: id, baseRevision: BASE, recipeId: "tests", verifierVersion: "v1",
    command: "node", args: ["--test"], artifactRef: "artifact_1", checkId: "check_1", exitCode: 0 }];
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error(`test barrier timed out: ${label}`)), 2000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function fixture(body: (path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-work-item-cancellation-"));
  try { await body(join(root, "queue.json")); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function acceptedFixture(path: string): Promise<void> {
  const store = new WorkItemStore(path, { verifyEvidence: async () => true });
  // A's evidence is relevant to selection only when the next task depends on it.
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a"), { ...item("b"), dependencies: ["a"] }] }));
  const claim = (await store.claimNext({ owner: "setup", baseRevision: BASE }))!;
  await store.markReady("a", claim.token, BASE, evidence("a"));
  await store.accept("a", claim.token, BASE);
}

test("pre-aborted selection and claim do not change persisted work", async () => fixture(async (path) => {
  const store = new WorkItemStore(path);
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const before = await readFile(path, "utf8");
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(store.next({ signal: abort.signal }), /cancelled/);
  await assert.rejects(store.claimNext({ owner: "worker", baseRevision: BASE, signal: abort.signal }), /cancelled/);
  assert.equal(await readFile(path, "utf8"), before);
}));

test("selection forwards caller cancellation and retains the original option signal", async () => fixture(async (path) => {
  await acceptedFixture(path);
  const abort = new AbortController();
  const input = { signal: abort.signal };
  let observed: AbortSignal | undefined;
  const store = new WorkItemStore(path, { verifyEvidence: async (_evidence, _context, signal) => {
    observed = signal;
    input.signal = new AbortController().signal;
    abort.abort();
    assert.equal(signal.aborted, true, "the active resolver must observe caller cancellation");
    return true;
  } });
  const before = await readFile(path, "utf8");
  await assert.rejects(store.next(input), /cancelled/);
  assert.equal(observed?.aborted, true);
  assert.equal(await readFile(path, "utf8"), before);
}));

test("claim cancellation during locked evidence verification leaves the next task planned", async () => fixture(async (path) => {
  await acceptedFixture(path);
  const abort = new AbortController();
  let observed: AbortSignal | undefined;
  const store = new WorkItemStore(path, { verifyEvidence: async (_evidence, _context, signal) => {
    observed = signal;
    abort.abort();
    assert.equal(signal.aborted, true, "the locked resolver must observe caller cancellation");
    return true;
  } });
  const before = await readFile(path, "utf8");
  await assert.rejects(store.claimNext({ owner: "worker", baseRevision: BASE, signal: abort.signal }), /cancelled/);
  assert.equal(observed?.aborted, true);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal((await store.load()).items[1]!.status, "planned");
}));

test("cancellation while waiting for a queue lock cannot publish a late claim", async () => fixture(async (path) => {
  const store = new WorkItemStore(path, { lock: { timeoutMs: 2000, retryMs: 1 } });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const before = await readFile(path, "utf8");
  const entered = deferred(), release = deferred();
  const holder = withExclusiveFileLock(`${path}.lock`, async () => { entered.resolve(); await release.promise; });
  await within(entered.promise, "queue lock holder");
  const parentReady = deferred();
  const seam = store as unknown as { checkParent(create?: boolean): Promise<void> };
  const checkParent = seam.checkParent.bind(store);
  seam.checkParent = async (create) => { await checkParent(create); parentReady.resolve(); };
  const abort = new AbortController();
  const result = store.claimNext({ owner: "worker", baseRevision: BASE, signal: abort.signal })
    .then((claim) => ({ claim }), (error: unknown) => ({ error }));
  try {
    await within(parentReady.promise, "contender parent check");
    // The operation's continuation reaches lock acquisition before this next
    // event-loop turn; the real holder still owns the lock throughout.
    await nextTurn();
    abort.abort();
  } finally { release.resolve(); await holder; }
  const settled = await result;
  assert.ok("error" in settled && settled.error instanceof Error);
  assert.match(settled.error.message, /cancelled/);
  assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(readFile(`${path}.lock`), { code: "ENOENT" });
}));

test("markReady cancellation after a successful resolver preserves the running claim", async () => fixture(async (path) => {
  const abort = new AbortController();
  let observed: AbortSignal | undefined;
  const store = new WorkItemStore(path, { verifyEvidence: async (_evidence, _context, signal) => {
    observed = signal;
    abort.abort();
    assert.equal(signal.aborted, true, "the publication resolver must observe caller cancellation");
    return true;
  } });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
  const before = await readFile(path, "utf8");
  await assert.rejects(store.markReady("a", claim.token, BASE, evidence("a"), abort.signal), /cancelled/);
  assert.equal(observed?.aborted, true);
  assert.equal(await readFile(path, "utf8"), before);
}));

test("caller cancellation waits for the active resolver to settle before returning", async () => fixture(async (path) => {
  const entered = deferred(), release = deferred();
  let resolverSettled = false;
  const store = new WorkItemStore(path, { verifyEvidence: async () => {
    entered.resolve();
    await release.promise;
    resolverSettled = true;
    return true;
  } });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
  const abort = new AbortController();
  let operationSettled = false;
  const operation = store.markReady("a", claim.token, BASE, evidence("a"), abort.signal)
    .then((record) => { operationSettled = true; return { record }; }, (error: unknown) => { operationSettled = true; return { error }; });
  try {
    await within(entered.promise, "active resolver");
    abort.abort();
    await nextTurn();
    assert.equal(operationSettled, false);
    assert.equal(resolverSettled, false);
  } finally { release.resolve(); await operation; }
  const settled = await operation;
  assert.ok("error" in settled && settled.error instanceof Error);
  assert.match(settled.error.message, /cancelled/);
  assert.equal(resolverSettled, true);
  assert.equal((await store.load()).items[0]!.status, "running");
}));

for (const callerSignal of [false, true]) test(`verifier timeout ${callerSignal ? "with a caller signal waits for" : "without a caller signal preserves legacy early return before"} resolver settlement`, async () => fixture(async (path) => {
  const aborted = deferred(), release = deferred(), resolverSettled = deferred();
  const store = new WorkItemStore(path, { verificationTimeoutMs: 10, verifyEvidence: async (_evidence, _context, signal) => {
    signal.addEventListener("abort", aborted.resolve, { once: true });
    await release.promise;
    resolverSettled.resolve();
    return true;
  } });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
  let operationSettled = false;
  const operation = store.markReady("a", claim.token, BASE, evidence("a"), callerSignal ? new AbortController().signal : undefined)
    .then((record) => { operationSettled = true; return { record }; }, (error: unknown) => { operationSettled = true; return { error }; });
  try {
    await within(aborted.promise, "verifier timeout signal");
    if (callerSignal) {
      // Let normal I/O/unlock completion occur; the caller-signal path must
      // remain pending specifically because this resolver has not settled.
      await pause(40);
      assert.equal(operationSettled, false);
    } else {
      const settled = await within(operation, "legacy early timeout settlement");
      assert.ok("error" in settled && settled.error instanceof Error);
      assert.match(settled.error.message, /timed out/);
    }
  } finally { release.resolve(); await within(resolverSettled.promise, "resolver tail cleanup"); await operation; }
  const settled = await operation;
  assert.ok("error" in settled && settled.error instanceof Error);
  assert.match(settled.error.message, /timed out/);
  assert.equal((await store.load()).items[0]!.status, "running");
}));

test("invalid signals and accessor inputs are refused without running a resolver", async () => fixture(async (path) => {
  await acceptedFixture(path);
  let calls = 0;
  const store = new WorkItemStore(path, { verifyEvidence: async () => { calls++; return true; } });
  const before = await readFile(path, "utf8");
  await assert.rejects(store.next({ signal: {} as AbortSignal }), /signal/);
  await assert.rejects(store.claimNext({ owner: "worker", baseRevision: BASE, signal: {} as AbortSignal }), /signal/);
  await assert.rejects(async () => store.markReady("a", "invalid", BASE, evidence("a"), {} as AbortSignal), /signal/);
  await assert.rejects(store.next(Object.defineProperty({}, "signal", { get: () => { throw Error("getter ran"); }, enumerable: true })), /accessor|input|options/);
  await assert.rejects(store.claimNext(Object.defineProperty({ owner: "worker", baseRevision: BASE }, "signal", { get: () => { throw Error("getter ran"); }, enumerable: true })), /accessor|input|options/);
  assert.equal(calls, 0);
  assert.equal(await readFile(path, "utf8"), before);
}));

for (const method of ["next", "claimNext"] as const) test(`${method} refuses inherited cancellation inputs without invoking inherited accessors`, async () => fixture(async (path) => {
  const store = new WorkItemStore(path);
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const before = await readFile(path, "utf8");
  const abort = new AbortController();
  abort.abort();
  let getters = 0;
  for (const prototype of [{ signal: abort.signal }, Object.defineProperty({}, "signal", {
    get: () => { getters++; throw Error("inherited getter ran"); }
  })]) {
    const input = Object.assign(Object.create(prototype) as object, { owner: "worker", baseRevision: BASE });
    if (method === "next") {
      await assert.rejects(store.next(Object.create(prototype) as { signal: AbortSignal }), /ordinary|prototype|input/);
    } else await assert.rejects(store.claimNext(input), /ordinary|prototype|input/);
    assert.equal(getters, 0);
    assert.equal(await readFile(path, "utf8"), before);
  }
}));

// Abort at the persistence boundary after the real atomic write has returned.
// This is a test seam, not a replacement writer: committed bytes are inspected.
function abortAfterWrite(store: WorkItemStore, abort: AbortController): void {
  const seam = store as unknown as { write(queue: WorkQueue): Promise<void> };
  const write = seam.write.bind(store);
  seam.write = async (queue) => { await write(queue); abort.abort(); };
}

test("a committed claim returns its token even if cancellation arrives before the call resolves", async () => fixture(async (path) => {
  const store = new WorkItemStore(path);
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const abort = new AbortController();
  abortAfterWrite(store, abort);
  const claim = await store.claimNext({ owner: "worker", baseRevision: BASE, signal: abort.signal });
  assert.ok(claim);
  assert.equal(abort.signal.aborted, true);
  assert.equal((await store.load()).items[0]!.claim!.token, claim.token);
  await store.block("a", claim.token, "controller stopped before dispatch");
  assert.equal((await store.load()).items[0]!.status, "blocked");
}));

test("a committed ready publication returns its record despite late cancellation", async () => fixture(async (path) => {
  const store = new WorkItemStore(path, { verifyEvidence: async () => true });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a")] }));
  const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
  const abort = new AbortController();
  abortAfterWrite(store, abort);
  const ready = await store.markReady("a", claim.token, BASE, evidence("a"), abort.signal);
  assert.equal(abort.signal.aborted, true);
  assert.equal(ready.status, "ready-for-review");
  assert.equal((await store.load()).items[0]!.status, "ready-for-review");
}));
