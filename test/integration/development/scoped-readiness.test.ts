import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue, type WorkItemDefinition } from "../../../src/development/work-items.js";

const BASE = "a".repeat(40);
function item(id: string, dependencies: readonly string[] = [], scope = `src/${id}`, priority = 10): WorkItemDefinition {
  return { id, dependencies, allowedScope: [scope], goal: `Complete ${id}`, priority,
    acceptance: [{ id: "check", command: "node", args: ["--test"], verifierVersion: "v1" }] };
}
async function fixture(body: (path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-scoped-readiness-"));
  try { await body(join(root, "queue.json")); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function accepted(path: string, rest: readonly WorkItemDefinition[]): Promise<void> {
  const store = new WorkItemStore(path, { verifyEvidence: async () => true });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a", [], "src/a", 100), ...rest] }));
  const claim = (await store.claimNext({ owner: "setup", baseRevision: BASE }))!;
  await store.markReady("a", claim.token, BASE, [{ source: "host-command", workItemId: "a", baseRevision: BASE,
    recipeId: "check", verifierVersion: "v1", command: "node", args: ["--test"], artifactRef: "artifact_1", checkId: "check_1", exitCode: 0 }]);
  await store.accept("a", claim.token, BASE);
}

test("independent work never rechecks an unrelated accepted row", async () => fixture(async (path) => {
  await accepted(path, [item("b")]);
  let checks = 0;
  const store = new WorkItemStore(path, { verifyEvidence: async () => { checks++; throw Error("unrelated checker must stay idle"); } });
  assert.equal((await store.next())?.id, "b");
  assert.equal((await store.claimNext({ owner: "host", baseRevision: BASE }))?.item.id, "b");
  assert.equal(checks, 0);
}));

for (const related of [item("dependent", ["a"], "src/dependent", 50), item("overlap", [], "src/a/child", 50)]) {
  test(`${related.id} remains fenced while explicit checker uncertainty permits independent work`, async () => fixture(async (path) => {
    await accepted(path, [related, item("b")]);
    const uncertainty = Error("host checker action requires reconciliation");
    let checks = 0;
    const store = new WorkItemStore(path, {
      verifyEvidence: async () => { checks++; throw uncertainty; },
      isVerificationBlocked: (error) => error === uncertainty
    });
    assert.equal((await store.next())?.id, "b");
    assert.equal((await store.claimNext({ owner: "host", baseRevision: BASE }))?.item.id, "b");
    const queue = await store.load();
    assert.equal(queue.items.find((record) => record.definition.id === related.id)!.status, "planned");
    assert.equal(queue.items.find((record) => record.definition.id === "a")!.status, "accepted");
    assert.equal(checks, 2);
    await assert.rejects(store.next(), (error: unknown) => error === uncertainty);
  }));
}

test("invalid evidence and cancellation are never skipped as availability conflicts", async () => fixture(async (path) => {
  await accepted(path, [item("dependent", ["a"], "src/dependent", 50), item("b")]);
  const invalid = new WorkItemStore(path, { verifyEvidence: async () => false, isVerificationBlocked: () => false });
  await assert.rejects(invalid.next(), /verification refused/);
  const abort = new AbortController();
  const cancelled = new WorkItemStore(path, { verifyEvidence: async () => { abort.abort(); throw Error("late conflict"); }, isVerificationBlocked: () => true });
  await assert.rejects(cancelled.claimNext({ owner: "host", baseRevision: BASE, signal: abort.signal }), /cancel/);
  assert.equal((await invalid.load()).items.find((record) => record.definition.id === "b")!.status, "planned");
}));

test("an entirely accepted queue dispatches no new freshness checks", async () => fixture(async (path) => {
  await accepted(path, []);
  const store = new WorkItemStore(path, { verifyEvidence: async () => { throw Error("no work needs checking"); } });
  assert.equal(await store.next(), undefined);
  assert.equal(await store.claimNext({ owner: "host", baseRevision: BASE }), undefined);
}));

for (const asynchronous of [false, true]) test(`host eligibility ${asynchronous ? "asynchronously" : "synchronously"} skips scoped blockers in advisory and atomic selection`, async () => fixture(async (path) => {
  const blocked = Error("uncertain A");
  const store = new WorkItemStore(path, {
    verifyEligibility: (candidate, signal) => {
      assert.ok(signal instanceof AbortSignal);
      assert.equal(Object.isFrozen(candidate.allowedScope), true);
      if (asynchronous) return Promise.resolve().then(() => { if (candidate.id !== "b") throw blocked; });
      if (candidate.id !== "b") throw blocked;
      return undefined;
    }, isVerificationBlocked: (error) => error === blocked
  });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a", [], "src/a", 100), item("a2", [], "src/a", 90), item("b")] }));
  const before = await readFile(path, "utf8");
  assert.equal((await store.next())?.id, "b");
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal((await store.claimNext({ owner: "host", baseRevision: BASE }))?.item.id, "b");
  const claimed = await store.load();
  await assert.rejects(store.next(), (error: unknown) => error === blocked);
  await assert.rejects(store.claimNext({ owner: "host", baseRevision: BASE }), (error: unknown) => error === blocked);
  assert.deepEqual(await store.load(), claimed);
}));

test("eligibility skips an unavailable candidate before checking its accepted dependency", async () => fixture(async (path) => {
  await accepted(path, [item("dependent", ["a"], "src/dependent", 50), item("b")]);
  const blocked = Error("dependent has unresolved effects");
  const store = new WorkItemStore(path, {
    verifyEligibility: (candidate) => { if (candidate.id === "dependent") throw blocked; },
    isVerificationBlocked: (error) => error === blocked,
    verifyEvidence: async () => { throw Error("ineligible dependency checker must not run"); }
  });
  assert.equal((await store.next())?.id, "b");
  assert.equal((await store.claimNext({ owner: "host", baseRevision: BASE }))?.item.id, "b");
}));

for (const operation of ["next", "claimNext"] as const) {
  for (const outcome of ["unexpected", "cancel-resolve", "cancel-reject"] as const) test(`${operation} eligibility ${outcome} preserves the queue and never falls through`, async () => fixture(async (path) => {
    const abort = new AbortController(), unexpected = Error("host read unavailable"), conflict = Error("late conflict");
    const store = new WorkItemStore(path, { verifyEligibility: async () => {
      await Promise.resolve();
      if (outcome === "unexpected") throw unexpected;
      abort.abort();
      if (outcome === "cancel-reject") throw conflict;
    }, isVerificationBlocked: (error) => error === conflict });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a"), item("b")] }));
    const before = await readFile(path, "utf8");
    const result = operation === "next" ? store.next({ signal: abort.signal })
      : store.claimNext({ owner: "host", baseRevision: BASE, signal: abort.signal });
    if (outcome === "unexpected") await assert.rejects(result, (error: unknown) => error === unexpected);
    else await assert.rejects(result, /cancelled/);
    assert.equal(await readFile(path, "utf8"), before);
  }));
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function queued(id: string, scope: string, priority: number): WorkItemDefinition {
  return { ...item(id, [], scope, priority), acceptance: [{ id: "check", command: process.execPath,
    args: ["-e", id === "b" ? "if(require('node:fs').readFileSync('b.txt','utf8')!=='after')process.exit(1)" : "process.exit(0)"], verifierVersion: "v1" }] };
}
interface ControllerFixture { root: string; sourceRepo: string; queuePath: string; stateRoot: string; }
async function controllerFixture(body: (value: ControllerFixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-scoped-controller-")), sourceRepo = join(root, "source");
  try {
    await mkdir(sourceRepo);
    git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Scoped fixture"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    for (const file of ["a.txt", "b.txt"]) await writeFile(join(sourceRepo, file), "before", "utf8");
    git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const queuePath = join(root, "queue.json"), stateRoot = join(root, "state");
    await new WorkItemStore(queuePath).create(createWorkQueue({ id: "queue", authorityRef: "host:test",
      items: [queued("a", "a.txt", 100), queued("a2", "a.txt", 90), queued("b", "b.txt", 10)] }));
    await body({ root, sourceRepo, queuePath, stateRoot });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
}
function writer(value: ControllerFixture): DevelopmentController {
  return new DevelopmentController({ ...value, owner: "host", executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write-b", { path: "b.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
}
async function uncertain(controller: DevelopmentController, input: unknown = { itemId: "a", definition: queued("a", "a.txt", 100) }) {
  const action = await controller.ledger.prepare({ idempotencyKey: "host:uncertain", kind: "candidate-write", input });
  const claim = await controller.ledger.claim(action.actionId, action.version);
  return controller.ledger.markUncertain(claim, { evidence: { summary: "Host has not established effect settlement", references: ["host:pending"] } });
}
async function assertB(controller: DevelopmentController, value: ControllerFixture): Promise<void> {
  const result = await controller.runNext();
  assert.equal(result.status, "ready-for-review", JSON.stringify(result));
  assert.equal(result.itemId, "b");
  assert.equal(await readFile(join(result.candidatePath!, "b.txt"), "utf8"), "after");
  assert.equal(await readFile(join(value.sourceRepo, "b.txt"), "utf8"), "before");
  assert.equal(git(value.sourceRepo, ["status", "--porcelain"]), "");
}

test("planned uncertain A and overlap A2 allow an actual disjoint B candidate write", async () => controllerFixture(async (value) => {
  const controller = writer(value);
  const claim = (await controller.store.claimNext({ owner: "old-owner", baseRevision: git(value.sourceRepo, ["rev-parse", "HEAD"]) }))!;
  const pending = await uncertain(controller);
  await controller.store.release("a", claim.token);
  const before = await controller.store.load();
  await assertB(controller, value);
  const after = await controller.store.load();
  assert.deepEqual(after.items.slice(0, 2), before.items.slice(0, 2));
  assert.deepEqual(await controller.ledger.get(pending.actionId), pending);
}));

for (const race of ["new-effect", "competing-claim"] as const) test(`atomic eligibility rechecks ${race} after advisory selection and executes B`, async () => controllerFixture(async (value) => {
  const controller = writer(value), claimNext = controller.store.claimNext.bind(controller.store);
  let pending: Awaited<ReturnType<typeof uncertain>> | undefined;
  controller.store.claimNext = async (input) => {
    if (race === "new-effect") pending = await uncertain(controller);
    else await new WorkItemStore(value.queuePath).claimNext({ owner: "competitor", baseRevision: input.baseRevision });
    return claimNext(input);
  };
  await assertB(controller, value);
  const queue = await controller.store.load();
  assert.equal(queue.items[0]!.status, race === "new-effect" ? "planned" : "running");
  assert.equal(queue.items[1]!.status, "planned");
  if (pending !== undefined) assert.deepEqual(await controller.ledger.get(pending.actionId), pending);
}));

for (const stage of ["advisory", "claim"] as const) test(`all blocked at ${stage} selection preserves original reconciliation identities and queue bytes`, async () => controllerFixture(async (value) => {
  const controller = writer(value);
  const malformed = { itemId: "legacy", definition: { allowedScope: ["src/*"] } };
  let pending: Awaited<ReturnType<typeof uncertain>>;
  if (stage === "advisory") pending = await uncertain(controller, malformed);
  else {
    const claimNext = controller.store.claimNext.bind(controller.store);
    controller.store.claimNext = async (input) => { pending = await uncertain(controller, malformed); return claimNext(input); };
  }
  const before = await readFile(value.queuePath, "utf8");
  const result = await controller.runNext();
  assert.equal(result.status, "needs-reconciliation");
  assert.equal(result.itemId, "a");
  assert.equal(result.actionId, pending!.actionId);
  assert.equal(await readFile(value.queuePath, "utf8"), before);
  assert.deepEqual(await controller.ledger.list(), [pending!]);
}));

for (const stage of ["post-claim", "final-admission"] as const) test(`a new effect at ${stage} still fences actual worker dispatch`, async () => controllerFixture(async (value) => {
  const controller = writer(value);
  let pending: Awaited<ReturnType<typeof uncertain>> | undefined;
  if (stage === "post-claim") {
    const claimNext = controller.store.claimNext.bind(controller.store);
    controller.store.claimNext = async (input) => {
      const claimed = await claimNext(input);
      pending = await uncertain(controller);
      return claimed;
    };
  } else {
    const admit = controller.ledger.admit.bind(controller.ledger);
    controller.ledger.admit = async (...args) => { pending = await uncertain(controller); return admit(...args); };
  }
  const result = await controller.runNext();
  assert.equal(result.status, "blocked", JSON.stringify(result));
  assert.equal(result.itemId, "a");
  assert.equal(result.candidatePath, undefined);
  assert.match(result.reason!, /reconciliation|overlap/);
  assert.deepEqual(await controller.ledger.list(), [pending!]);
  assert.equal((await controller.store.load()).items[0]!.status, "blocked");
  assert.equal(git(value.sourceRepo, ["status", "--porcelain"]), "");
}));

test("eligibility retains the first distinct blocker and exhausted queues invoke no host callback", async () => fixture(async (path) => {
  const first = Error("first"), second = Error("second");
  const store = new WorkItemStore(path, { verifyEligibility: (candidate) => { throw candidate.id === "a" ? first : second; },
    isVerificationBlocked: () => true });
  await store.create(createWorkQueue({ id: "queue", authorityRef: "host:test", items: [item("a", [], "src/a", 100), item("b")] }));
  await assert.rejects(store.next(), (error: unknown) => error === first);
  await assert.rejects(store.claimNext({ owner: "host", baseRevision: BASE }), (error: unknown) => error === first);
  const exhaustedPath = `${path}.exhausted`, setup = new WorkItemStore(exhaustedPath);
  await setup.create(createWorkQueue({ id: "exhausted", authorityRef: "host:test", items: [item("running")] }));
  await setup.claimNext({ owner: "existing", baseRevision: BASE });
  const empty = new WorkItemStore(exhaustedPath, { verifyEligibility: () => { throw Error("exhausted queue must stay idle"); } });
  assert.equal(await empty.next(), undefined);
  assert.equal(await empty.claimNext({ owner: "host", baseRevision: BASE }), undefined);
}));
