import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runDevelopmentBatch } from "../../../src/development/batch.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(dependent: boolean, body: (controller: DevelopmentController, source: string, calls: () => number) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-batch-"));
  const sourceRepo = path.join(root, "source"); await mkdir(sourceRepo);
  git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Batch fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  for (const id of ["a", "b", "c"]) await writeFile(path.join(sourceRepo, `${id}.txt`), "before");
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  let calls = 0;
  const controller = new DevelopmentController({ sourceRepo, queuePath: path.join(root, "queue.json"),
    stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), owner: "host:batch-test",
    executorFactory: ({ tools, acceptanceCriteria }) => ({ async *execute(request, signal) {
      calls++; const id = acceptanceCriteria![0]!.id;
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: `${id}.txt`, contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
  await controller.store.create(createWorkQueue({ id: "batch", authorityRef: "host:test", items: ["a", "b", "c"].map((id, index) => ({
    id, goal: `Repair ${id}`, dependencies: dependent && id !== "a" ? ["a"] : [], allowedScope: [`${id}.txt`], priority: 90 - index,
    acceptance: [{ id, command: process.execPath, args: ["-e", `if(require('node:fs').readFileSync('${id}.txt','utf8')!=='after') process.exit(1)`], verifierVersion: "v1" }]
  })) }));
  try { await body(controller, sourceRepo, () => calls); } finally { await rm(root, { recursive: true, force: true }); }
}
test("real batch retains two independent candidates; later batch does not replay them", async () => fixture(false, async (controller, source, calls) => {
  const first = await runDevelopmentBatch(controller, { maxItems: 2, maxWallTimeMs: 30_000 });
  assert.equal(first.stopReason, "max-items"); assert.equal(calls(), 2);
  assert.equal(first.queueSummary?.readyForReview, 2); assert.equal(first.queueSummary?.accepted, 0);
  const next = await runDevelopmentBatch(controller, { maxItems: 1, maxWallTimeMs: 30_000 });
  assert.equal(next.stopReason, "max-items"); assert.equal(calls(), 3); assert.equal(next.results[0]?.itemId, "c");
  for (const result of [...first.results, ...next.results]) {
    assert.equal(await readFile(path.join(result.candidatePath!, `${result.itemId}.txt`), "utf8"), "after");
  }
  for (const id of ["a", "b", "c"]) assert.equal(await readFile(path.join(source, `${id}.txt`), "utf8"), "before");
  assert.equal(git(source, ["status", "--porcelain", "--ignored"]), "");
}));
test("batch never auto-accepts a prerequisite to release dependent work", async () => fixture(true, async (controller, _source, calls) => {
  const result = await runDevelopmentBatch(controller, { maxItems: 3, maxWallTimeMs: 30_000 });
  assert.equal(result.stopReason, "no-ready-task"); assert.equal(calls(), 1);
  assert.equal(result.queueSummary?.readyForReview, 1); assert.equal(result.queueSummary?.planned, 2);
}));
test("unknown effect on an unselected independent item blocks the whole batch", async () => fixture(false, async (controller, source, calls) => {
  const action = await controller.ledger.prepare({ idempotencyKey: "old-c-effect", kind: "candidate-write",
    input: { queueId: "batch", itemId: "c" } });
  await controller.ledger.claim(action.actionId, action.version);
  const result = await runDevelopmentBatch(controller, { maxItems: 3, maxWallTimeMs: 30_000 });
  assert.equal(result.stopReason, "needs-reconciliation"); assert.equal(calls(), 0);
  assert.equal(result.results.length, 0); assert.equal(result.queueSummary?.planned, 3);
  assert.equal(git(source, ["status", "--porcelain", "--ignored"]), "");
}));
