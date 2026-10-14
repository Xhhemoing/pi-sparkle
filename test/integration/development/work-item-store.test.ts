import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWorkQueue, type WorkItemDefinition, type WorkItemEvidence } from "../../../src/development/work-items.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";

const BASE = "a".repeat(40);
function item(id: string, dependencies: string[] = [], scope = `src/${id}`): WorkItemDefinition {
  return { id, goal: `Complete ${id}`, dependencies, allowedScope: [scope], priority: 10,
    acceptance: [{ id: "tests", command: "node", args: ["--test"], verifierVersion: "v1" }] };
}
function evidence(id = "a"): WorkItemEvidence[] {
  return [{ source: "host-command", workItemId: id, baseRevision: BASE, recipeId: "tests", verifierVersion: "v1",
    command: "node", args: ["--test"], artifactRef: "artifact_1", checkId: "check_1", exitCode: 0 }];
}
async function fixture(run: (path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-work-items-"));
  try { await run(join(root, "queue.json")); } finally { await rm(root, { recursive: true, force: true }); }
}

test("concurrent claims cannot double-own one item and stale tokens cannot write after release", async () => {
  await fixture(async (path) => {
    const a = new WorkItemStore(path);
    const b = new WorkItemStore(path);
    await a.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] }));
    const claims = await Promise.all([a.claimNext({ owner: "one", baseRevision: BASE }), b.claimNext({ owner: "two", baseRevision: BASE })]);
    assert.equal(claims.filter(Boolean).length, 1);
    const old = claims.find(Boolean)!;
    await a.release("a", old.token);
    const fresh = (await b.claimNext({ owner: "two", baseRevision: BASE }))!;
    assert.notEqual(fresh.token, old.token);
    await assert.rejects(a.block("a", old.token, "late writer"), /claim|token/i);
    assert.equal((await a.load()).items[0]!.claim!.token, fresh.token);
  });
});

test("child success, mismatched evidence and an absent verifier never advance the queue", async () => {
  await fixture(async (path) => {
    const store = new WorkItemStore(path);
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a"), item("b", ["a"])] }));
    const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
    await assert.rejects(store.markReady("a", claim.token, BASE, [{ success: true }] as unknown as WorkItemEvidence[]));
    await assert.rejects(store.markReady("a", claim.token, BASE, evidence()), /verif/i);
    assert.equal((await store.load()).items[0]!.status, "running");
    assert.equal(await store.next(), undefined);
  });
});

test("ready and explicit acceptance reverify actual evidence; only accepted dependencies unlock work", async () => {
  await fixture(async (path) => {
    let valid = true;
    let checks = 0;
    const store = new WorkItemStore(path, { verifyEvidence: async (_evidence, context) => {
      checks += 1;
      assert.equal(Object.isFrozen(context.item.acceptance), true);
      return valid;
    } });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a"), item("b", ["a"])] }));
    const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
    await store.markReady("a", claim.token, BASE, evidence());
    assert.equal((await store.load()).items[0]!.status, "ready-for-review");
    assert.equal(await store.next(), undefined);
    valid = false;
    await assert.rejects(store.accept("a", claim.token, BASE), /verif/i);
    valid = true;
    await store.accept("a", claim.token, BASE);
    assert.equal((await store.next())?.id, "b");
    valid = false;
    await assert.rejects(store.claimNext({ owner: "next", baseRevision: BASE }), /verif/i);
    assert.ok(checks >= 4);
    assert.equal((await store.load()).items[1]!.status, "planned");
  });
});

test("evidence binds current base, item, recipe version, command and args before resolver invocation", async () => {
  await fixture(async (path) => {
    let checks = 0;
    const store = new WorkItemStore(path, { verifyEvidence: async () => { checks += 1; return true; } });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] }));
    const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
    for (const delta of [ { workItemId: "other" }, { baseRevision: "b".repeat(40) }, { verifierVersion: "v2" },
      { recipeId: "other" }, { command: "true" }, { args: [] }, { exitCode: 1 } ]) {
      await assert.rejects(store.markReady("a", claim.token, BASE, [{ ...evidence()[0]!, ...delta }]));
    }
    await assert.rejects(store.markReady("a", claim.token, "c".repeat(40), evidence()));
    assert.equal(checks, 0);
    assert.equal((await store.load()).items[0]!.status, "running");
  });
});

test("throwing and timed-out host verification preserves running state", async () => {
  await fixture(async (path) => {
    const store = new WorkItemStore(path, { verificationTimeoutMs: 20, verifyEvidence: async () => { throw Error("missing artifact"); } });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] }));
    const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
    await assert.rejects(store.markReady("a", claim.token, BASE, evidence()), /missing artifact|verif/i);
    const timeout = new WorkItemStore(path, { verificationTimeoutMs: 20, verifyEvidence: async (_evidence, _context, signal) =>
      new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })) });
    await assert.rejects(timeout.markReady("a", claim.token, BASE, evidence()), /verif|timed out/i);
    assert.equal((await store.load()).items[0]!.status, "running");
  });
});

test("overlapping active scopes are excluded while disjoint work remains selectable", async () => {
  await fixture(async (path) => {
    const store = new WorkItemStore(path);
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a", [], "src"), item("b", [], "src/file.ts"), item("c", [], "docs")] }));
    const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
    assert.equal(claim.item.id, "a");
    assert.equal((await store.next())?.id, "c");
    await store.block("a", claim.token, "waiting for host");
    assert.equal((await store.next())?.id, "c");
  });
});

test("corrupt and oversized state fails closed and existing locks are never stolen", async () => {
  await fixture(async (path) => {
    const store = new WorkItemStore(path, { lock: { timeoutMs: 15, retryMs: 1 } });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] }));
    const original = await readFile(path, "utf8");
    await writeFile(`${path}.lock`, "abandoned owner");
    await assert.rejects(store.claimNext({ owner: "worker", baseRevision: BASE }), /lock/i);
    assert.equal(await readFile(`${path}.lock`, "utf8"), "abandoned owner");
    assert.equal(await readFile(path, "utf8"), original);
    await rm(`${path}.lock`);
    await writeFile(path, "{");
    await assert.rejects(store.load());
    await writeFile(path, "x".repeat(1_048_577));
    await assert.rejects(store.load(), /size|large|limit|MiB/i);
  });
});
