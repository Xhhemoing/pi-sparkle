import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
