import assert from "node:assert/strict";
import fsPromises, { mkdtemp, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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

for (const operation of ["load", "next"] as const) for (const replacementStat of [1, 2]) {
  test(`${operation} survives atomic publication before snapshot stat ${replacementStat}`, async (t) => {
    await fixture(async (path) => {
      const writer = new WorkItemStore(path);
      const reader = new WorkItemStore(path);
      await writer.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a"), item("b")] }));
      const originalOpen = fsPromises.open;
      let intercepted = false;
      let published = false;
      let snapshotUnlinked = false;
      let snapshotChanged = false;
      let restoreStat: (() => void) | undefined;
      const opens = t.mock.method(fsPromises, "open", async (...args: Parameters<typeof originalOpen>) => {
        const handle = await originalOpen(...args);
        if (args[0] === path && !intercepted) {
          intercepted = true;
          const originalStat = handle.stat;
          let calls = 0;
          let previousCtime: number | undefined;
          const stats = t.mock.method(handle, "stat", (async (...params: unknown[]) => {
            calls++;
            if (calls === replacementStat) {
              assert.equal((await writer.claimNext({ owner: "worker", baseRevision: BASE }))?.item.id, "a");
              published = true;
            }
            const result = await Reflect.apply(originalStat, handle, params);
            snapshotUnlinked ||= result.nlink === 0;
            snapshotChanged ||= previousCtime !== undefined && previousCtime !== result.ctimeMs;
            previousCtime = result.ctimeMs;
            return result;
          }) as FileHandle["stat"]);
          restoreStat = () => stats.mock.restore();
        }
        return handle;
      });
      syncBuiltinESMExports();
      try {
        const result = await reader[operation]();
        assert.equal(published, true);
        // Some Windows filesystems retain old-handle metadata after replacement.
        // Such an intact old snapshot remains advisory, never claim authority.
        const mustRefresh = replacementStat === 1 ? snapshotUnlinked : snapshotChanged;
        if (operation === "load") {
          assert.ok(result && "revision" in result);
          assert.ok(result.revision === 1 || (!mustRefresh && result.revision === 0));
        } else {
          assert.ok(result && "id" in result);
          assert.ok(result.id === "b" || (!mustRefresh && result.id === "a"));
        }
        assert.equal((await reader.load()).revision, 1);
      } finally {
        opens.mock.restore();
        restoreStat?.();
        syncBuiltinESMExports();
      }
    });
  });
}

test("next releases its snapshot lock before read-only eligibility verification", async () => {
  await fixture(async (path) => {
    const observer = new WorkItemStore(path, { lock: { timeoutMs: 20, retryMs: 1 } });
    const store = new WorkItemStore(path, { verifyEligibility: async () => {
      assert.equal((await observer.load()).revision, 0);
    } });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] }));
    assert.equal((await store.next())?.id, "a");
  });
});

test("locked eligibility and evidence verifiers can inspect their queue without reacquiring its lock", async () => {
  await fixture(async (path) => {
    const observer = new WorkItemStore(path, { lock: { timeoutMs: 20, retryMs: 1 } });
    const observed: string[] = [];
    const store = new WorkItemStore(path, {
      verifyEligibility: async () => { observed.push((await observer.load()).items[0]!.status); },
      verifyEvidence: async () => { observed.push((await observer.load()).items[0]!.status); return true; }
    });
    await store.create(createWorkQueue({ id: "queue", authorityRef: "tasks/plan.md", items: [item("a")] }));
    const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
    await store.markReady("a", claim.token, BASE, evidence());
    await store.accept("a", claim.token, BASE);
    assert.deepEqual(observed, ["planned", "running", "ready-for-review"]);
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
