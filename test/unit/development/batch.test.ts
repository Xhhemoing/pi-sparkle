import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { runDevelopmentBatch, type DevelopmentBatchController } from "../../../src/development/batch.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import type { DevelopmentResult } from "../../../src/development/controller.js";
import type { ActionRecord } from "../../../src/development/action-ledger.js";

function fixture() {
  let calls = 0;
  let revision = "a".repeat(40);
  let queue = createWorkQueue({ id: "batch", authorityRef: "host:test", items: ["a", "b", "c"].map((id) => ({
    id, goal: id, dependencies: [], allowedScope: [id], priority: 90,
    acceptance: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"], verifierVersion: "v1" }]
  })) });
  const limits: number[] = [];
  const controller: DevelopmentBatchController = {
    currentSourceRevision: () => revision,
    status: async () => ({ queue, actions: [] }),
    runNext: async (input) => {
      limits.push(input?.maxWallTimeMs ?? -1);
      const itemId = ["a", "b", "c"][calls++]!;
      queue = { ...queue, revision: queue.revision + 1, items: queue.items.map((record) => record.definition.id === itemId
        ? { ...record, status: "ready-for-review" } : record) };
      return { status: "ready-for-review", itemId, candidatePath: `/retained/${itemId}` };
    }
  };
  return { controller, calls: () => calls, limits, drift: () => { revision = "b".repeat(40); }, queue: () => queue };
}

test("batch limits serial work and reports pending review without accepting", async () => {
  const f = fixture();
  const result = await runDevelopmentBatch(f.controller, { maxItems: 2, maxWallTimeMs: 1000 });
  assert.equal(result.stopReason, "max-items");
  assert.equal(f.calls(), 2);
  assert.equal(result.results.length, 2);
  assert.equal(result.queueSummary?.readyForReview, 2);
  assert.equal(result.queueSummary?.accepted, 0);
  assert.equal(result.sourceApplied, false);
  assert.ok(Object.isFrozen(result.results));
});
test("bad or accessor options fail before queue access", async () => {
  const f = fixture();
  let reads = 0; f.controller.status = async () => { reads++; return { queue: f.queue(), actions: [] }; };
  for (const input of [{ maxItems: 9, maxWallTimeMs: 100 }, { maxItems: 1, maxWallTimeMs: 0 },
    { maxItems: 1, maxWallTimeMs: 100, sourceRepo: "override" },
    { get maxItems(): number { throw new Error("accessor executed"); }, maxWallTimeMs: 100 }]) {
    await assert.rejects(runDevelopmentBatch(f.controller, input), /development batch/);
  }
  assert.equal(reads, 0); assert.equal(f.calls(), 0);
});
test("caller options are fixed before the first await", async () => {
  const f = fixture(); const input = { maxItems: 1, maxWallTimeMs: 1000 };
  const status = f.controller.status;
  f.controller.status = async () => { input.maxItems = 8; input.maxWallTimeMs = 1; return status(); };
  const result = await runDevelopmentBatch(f.controller, input);
  assert.equal(result.limits.maxItems, 1); assert.equal(result.limits.maxWallTimeMs, 1000); assert.equal(f.calls(), 1);
});
test("per-item budget shrinks from the shared elapsed time", async () => {
  const f = fixture(); const run = f.controller.runNext;
  f.controller.runNext = async (input) => { await pause(30); return run(input); };
  await runDevelopmentBatch(f.controller, { maxItems: 2, maxWallTimeMs: 1000, perItemWallTimeMs: 1000 });
  assert.ok(f.limits[1]! < f.limits[0]!); assert.ok(f.limits.every((value) => value > 0 && value <= 1000));
});
test("first blocked outcome stops all later dispatch", async () => {
  const f = fixture(); let calls = 0;
  f.controller.runNext = async () => { calls++; return { status: "blocked", itemId: "a", reason: "actual host failure" }; };
  const result = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 1000 });
  assert.equal(result.stopReason, "blocked"); assert.equal(calls, 1); assert.equal(result.results.length, 1);
});
test("visible running claim stops before invoking a worker", async () => {
  const f = fixture();
  f.controller.status = async () => ({ queue: { ...f.queue(), items: f.queue().items.map((item, index) =>
    index === 0 ? { ...item, status: "running" } : item) }, actions: [] });
  const result = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 1000 });
  assert.equal(result.stopReason, "needs-reconciliation"); assert.equal(f.calls(), 0);
});
test("a visible unknown effect after the last item prevents a normal limit report", async () => {
  const f = fixture(); const status = f.controller.status; let reads = 0;
  f.controller.status = async () => {
    const value = await status(); reads++;
    return { ...value, actions: reads === 1 ? [] : [{ actionId: "late-unknown", state: "needs-reconciliation" } as ActionRecord] };
  };
  const result = await runDevelopmentBatch(f.controller, { maxItems: 1, maxWallTimeMs: 1000 });
  assert.equal(result.stopReason, "needs-reconciliation"); assert.equal(result.results.length, 1); assert.equal(f.calls(), 1);
});
test("cancellation during admission cannot dispatch work", async () => {
  const f = fixture(); const abort = new AbortController(); const status = f.controller.status;
  f.controller.status = async () => { abort.abort(); return status(); };
  const result = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 1000, signal: abort.signal });
  assert.equal(result.stopReason, "cancelled"); assert.equal(f.calls(), 0);
});
test("deadline waits for the current operation to settle, without detached work", async () => {
  const f = fixture(); let settled = false;
  f.controller.runNext = async () => { await pause(50); settled = true; return { status: "blocked", itemId: "a" }; };
  const result = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 20 });
  assert.equal(settled, true); assert.equal(result.stopReason, "deadline");
  assert.equal(result.results.length, 1); assert.equal(result.deadlineExceeded, true);
});
test("source drift or queue read errors stop with a truthful partial report", async () => {
  const f = fixture(); const run = f.controller.runNext;
  f.controller.runNext = async (input) => { const value = await run(input); f.drift(); return value; };
  const result = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 1000 });
  assert.equal(result.stopReason, "source-changed"); assert.equal(f.calls(), 1);
  f.controller.status = async () => { throw new Error("corrupt queue"); };
  const failed = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 1000 });
  assert.equal(failed.stopReason, "error"); assert.match(failed.reason!, /corrupt queue/);
});
test("no-ready-task is a selection stop, not project acceptance", async () => {
  const f = fixture(); f.controller.runNext = async (): Promise<DevelopmentResult> => ({ status: "no-ready-task" });
  const result = await runDevelopmentBatch(f.controller, { maxItems: 3, maxWallTimeMs: 1000 });
  assert.equal(result.stopReason, "no-ready-task"); assert.equal(result.results.length, 0); assert.equal(result.queueSummary?.planned, 3);
});
