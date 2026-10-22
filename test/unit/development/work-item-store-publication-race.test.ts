import assert from "node:assert/strict";
import { constants, type PathLike, type Stats } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue, type WorkItemEvidence } from "../../../src/development/work-items.js";
import { writeFileAtomic } from "../../../src/persist/atomic-file.js";

const BASE = "a".repeat(40);
async function fixture(body: (value: {
  path: string; store: WorkItemStore; publish: (revision: number) => Promise<void>;
}) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), "sparkle-queue-publication-"));
  const path = join(root, "queue.json");
  const queue = createWorkQueue({ id: "queue", authorityRef: "host:test", items: [{
    id: "a", goal: "Complete A", dependencies: [], allowedScope: ["a.txt"], priority: 10,
    acceptance: [{ id: "tests", command: "node", args: ["--test"], verifierVersion: "v1" }]
  }] });
  const store = new WorkItemStore(path);
  await store.create(queue);
  try {
    await body({ path, store, publish: (revision) => writeFileAtomic(path, JSON.stringify({ ...queue, revision })) });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function withOpen<T>(replacement: typeof fs.open, body: () => Promise<T>): Promise<T> {
  const original = fs.open;
  fs.open = replacement;
  syncBuiltinESMExports();
  try { return await body(); }
  finally { fs.open = original; syncBuiltinESMExports(); }
}
async function withLstat<T>(replacement: typeof fs.lstat, body: () => Promise<T>): Promise<T> {
  const original = fs.lstat;
  fs.lstat = replacement;
  syncBuiltinESMExports();
  try { return await body(); }
  finally { fs.lstat = original; syncBuiltinESMExports(); }
}

// Return real stats from the inode that an actual atomic rename detached.
// No fabricated Stats or replacement persistence implementation is used.
test("public load retries a detached inode observed by lstat", async () => fixture(async ({ path, store, publish }) => {
  const originalLstat = fs.lstat, originalOpen = fs.open;
  let replaced = false;
  await withLstat((async (target: PathLike) => {
    if (String(target) !== path || replaced) return originalLstat(target);
    replaced = true;
    const old = await originalOpen(path, constants.O_RDONLY);
    try {
      await publish(1);
      const detached = await old.stat();
      assert.equal(detached.nlink, 0, "the real replacement must detach the observed inode");
      return detached;
    } finally { await old.close(); }
  }) as typeof fs.lstat, async () => {
    assert.equal((await store.load()).revision, 1);
  });
  assert.equal(replaced, true);
}));

for (const window of ["before", "after"] as const) {
  test(`public load retries replacement ${window} the bounded handle read`, async () => fixture(async ({ path, store, publish }) => {
    const originalOpen = fs.open;
    let replaced = false;
    await withOpen((async (target, flags, mode) => {
      const handle = await originalOpen(target, flags, mode);
      if (String(target) !== path || replaced || flags !== (constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))) return handle;
      replaced = true;
      if (window === "before") {
        await publish(1);
        assert.equal((await handle.stat()).nlink, 0);
      } else {
        const stat = handle.stat.bind(handle);
        let calls = 0;
        handle.stat = (async () => {
          calls++;
          if (calls === 2) await publish(1);
          return stat();
        }) as typeof handle.stat;
      }
      return handle;
    }) as typeof fs.open, async () => {
      assert.equal((await store.load()).revision, 1);
    });
    assert.equal(replaced, true);
  }));
}

test("public next retries an open ENOENT during an atomic publication gap", async () => fixture(async ({ path, store, publish }) => {
  const originalOpen = fs.open;
  let missing = false;
  await withOpen((async (target, flags, mode) => {
    if (String(target) !== path || missing) return originalOpen(target, flags, mode);
    missing = true;
    const aside = `${path}.held`;
    await fs.rename(path, aside);
    try { return await originalOpen(target, flags, mode); }
    finally { await publish(1); await fs.rm(aside); }
  }) as typeof fs.open, async () => {
    assert.equal((await store.next())?.id, "a");
  });
  assert.equal(missing, true);
}));

test("continuously replaced queue fails after a bounded number of reads", async () => fixture(async ({ path, store, publish }) => {
  const originalOpen = fs.open;
  let replacements = 0;
  await withOpen((async (target, flags, mode) => {
    const handle = await originalOpen(target, flags, mode);
    if (String(target) === path && flags === (constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))) {
      await publish(++replacements);
    }
    return handle;
  }) as typeof fs.open, async () => {
    await assert.rejects(store.load(), /publication|replacement|changed/);
  });
  assert.ok(replacements >= 2 && replacements <= 3, `must retry transient publication only within the fixed bound, got ${replacements}`);
}));

test("next cancellation during replacement prevents another read", async () => fixture(async ({ path, store, publish }) => {
  const originalOpen = fs.open;
  const abort = new AbortController();
  let reads = 0;
  await withOpen((async (target, flags, mode) => {
    const handle = await originalOpen(target, flags, mode);
    if (String(target) === path && ++reads === 1) { await publish(1); abort.abort(); }
    return handle;
  }) as typeof fs.open, async () => {
    await assert.rejects(store.next({ signal: abort.signal }), /cancelled/);
  });
  assert.equal(reads, 1);
}));

test("public reads continue refusing hardlinked queues", async () => fixture(async ({ path, store }) => {
  await fs.link(path, `${path}.hardlink`);
  await assert.rejects(store.load(), /regular file/);
  await assert.rejects(store.next(), /regular file/);
}));

test("public reads continue refusing symbolic queues", async (context) => fixture(async ({ path, store }) => {
  const target = `${path}.target`;
  await fs.rename(path, target);
  try { await fs.symlink(target, path, "file"); }
  catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      context.skip("Windows account cannot create file symlinks"); return;
    }
    throw error;
  }
  await assert.rejects(store.load(), /regular file/);
  await assert.rejects(store.next(), /regular file/);
}));

test("corrupt content and same-inode edits are not publication retries", async () => fixture(async ({ path, store }) => {
  const originalOpen = fs.open;
  await fs.writeFile(path, "{");
  let reads = 0;
  await withOpen((async (target, flags, mode) => {
    if (String(target) === path) reads++;
    return originalOpen(target, flags, mode);
  }) as typeof fs.open, async () => { await assert.rejects(store.load(), SyntaxError); });
  assert.equal(reads, 1);
  await fs.writeFile(path, "{}");
  reads = 0;
  await withOpen((async (target, flags, mode) => {
    const handle = await originalOpen(target, flags, mode);
    if (String(target) === path) {
      reads++;
      const stat = handle.stat.bind(handle);
      let stats = 0;
      handle.stat = (async () => { if (++stats === 2) await fs.appendFile(path, " "); return stat(); }) as typeof handle.stat;
    }
    return handle;
  }) as typeof fs.open, async () => { await assert.rejects(store.load(), /queue changed while reading/); });
  assert.equal(reads, 1);
}));

test("eligibility and evidence callbacks can inspect the queue while the mutation lock is held", { timeout: 2000 }, async () => fixture(async ({ path }) => {
  let eligibility = 0, evidenceChecks = 0;
  const store = new WorkItemStore(path, {
    verifyEligibility: async () => { await store.load(); eligibility++; },
    verifyEvidence: async () => { await store.load(); evidenceChecks++; return true; }
  });
  const claim = (await store.claimNext({ owner: "worker", baseRevision: BASE }))!;
  const evidence: WorkItemEvidence[] = [{ source: "host-command", workItemId: "a", baseRevision: BASE,
    recipeId: "tests", verifierVersion: "v1", command: "node", args: ["--test"], artifactRef: "artifact_1", checkId: "check_1", exitCode: 0 }];
  await store.markReady("a", claim.token, BASE, evidence);
  assert.equal(eligibility, 1);
  assert.equal(evidenceChecks, 1);
}));

for (const mutation of ["append", "write"] as const) {
  test(`in-place ${mutation} followed by atomic replacement is rejected without retry`, async () => fixture(async ({ path, store, publish }) => {
    const originalOpen = fs.open;
    let reads = 0;
    await withOpen((async (target, flags, mode) => {
      const handle = await originalOpen(target, flags, mode);
      if (String(target) !== path) return handle;
      reads++;
      if (reads > 1) return handle;
      const stat = handle.stat.bind(handle);
      let stats = 0;
      let before: Stats | undefined;
      handle.stat = (async () => {
        if (++stats === 1) { before = await stat(); return before; }
        if (stats === 2) {
          if (mutation === "append") await fs.appendFile(path, " ");
          else {
            const writer = await originalOpen(path, "r+");
            try { await writer.write(Buffer.from(" "), 0, 1, 0); }
            finally { await writer.close(); }
            // Real filesystem timestamp change keeps the same-size case deterministic.
            await fs.utimes(path, new Date(), new Date(Number(before!.mtimeMs) + 2000));
          }
          await publish(1);
          const after = await stat();
          assert.equal(after.nlink, 0);
          assert.ok(after.size !== before!.size || after.mtimeMs !== before!.mtimeMs);
          return after;
        }
        return stat();
      }) as typeof handle.stat;
      return handle;
    }) as typeof fs.open, async () => {
      await assert.rejects(store.load(), /queue changed while reading/);
    });
    assert.equal(reads, 1, "observed content mutation must not be hidden by a later replacement");
  }));
}

test("move-aside publication with a retained old link retries only observed metadata change", async (context) => fixture(async ({ path, store, publish }) => {
  const originalOpen = fs.open;
  let moved = false, ctimeChanged = false;
  await withOpen((async (target, flags, mode) => {
    const handle = await originalOpen(target, flags, mode);
    if (String(target) !== path || moved) return handle;
    const stat = handle.stat.bind(handle);
    let calls = 0;
    let before: Stats | undefined;
    handle.stat = (async () => {
      if (++calls === 1) { before = await stat(); return before; }
      if (calls === 2) {
        moved = true;
        await fs.rename(path, `${path}.aside`);
        await publish(1);
        const after = await stat();
        assert.equal(after.nlink, 1, "aside keeps the old file linked");
        assert.equal(after.size, before!.size);
        assert.equal(after.mtimeMs, before!.mtimeMs);
        ctimeChanged = after.ctimeMs !== before!.ctimeMs;
        context.diagnostic(JSON.stringify({ platform: process.platform, nlink: after.nlink,
          beforeCtime: Number(before!.ctimeMs), afterCtime: Number(after.ctimeMs), ctimeChanged }));
        return after;
      }
      return stat();
    }) as typeof handle.stat;
    return handle;
  }) as typeof fs.open, async () => {
    const queue = await store.load();
    assert.equal(queue.revision, ctimeChanged ? 1 : 0,
      "ctime change requires a fresh validated read; stable old contents remain a valid snapshot otherwise");
  });
  assert.equal(moved, true);
}));