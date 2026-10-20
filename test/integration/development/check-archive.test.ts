import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { ActionLedger } from "../../../src/development/action-ledger.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
test("opt-in controller actually writes/checks/reverifies acceptance through fresh schema2 while default remains v1", { timeout: 120_000 }, async () => {
  const scratch = resolve(".agent_workspace/staged-continuation/check-archive-tests"); await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "controller-")); const sourceRepo = join(root, "source");
  try {
    await mkdir(sourceRepo); git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Archive fixture"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]); await writeFile(join(sourceRepo, "value.txt"), "before", "utf8");
    git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const marker = join(root, "checker-count.txt"); const queuePath = join(root, "queue.json");
    await new WorkItemStore(queuePath).create(createWorkQueue({ id: "archive-controller", authorityRef: "host:test", items: [{ id: "change", goal: "Set value to after", dependencies: [], allowedScope: ["value.txt"], priority: 90,
      acceptance: [{ id: "contents", command: process.execPath, args: ["-e", `const f=require('node:fs');if(f.readFileSync('value.txt','utf8')!=='after')process.exit(1);f.appendFileSync(${JSON.stringify(marker)},'checked\\n')`], verifierVersion: "v1" }] }] }));
    const options = { sourceRepo, queuePath, stateRoot: join(root, "state"), sandboxRoot: join(root, "candidates"), owner: "host:archive", completedCheckArchive: true };
    const controller = new DevelopmentController({ ...options, executorFactory: ({ tools }) => ({ async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
    options.completedCheckArchive = false;
    const result = await controller.runNext(); assert.equal(result.status, "ready-for-review");
    const before = await readFile(marker, "utf8"); assert.ok(before.length > 0);
    const first = JSON.parse(await readFile(join(root, "actions", "actions.json"), "utf8")); assert.equal(first.schemaVersion, 2);
    assert.ok(first.actions.some((row: { kind: string; state: string }) => row.kind === "candidate-check" && row.state === "completed"));
    await controller.accept("change"); assert.equal((await controller.status()).queue.items[0]!.status, "accepted");
    assert.ok((await readFile(marker, "utf8")).length > before.length, "accept must actually re-run the checker");
    assert.equal(await readFile(join(sourceRepo, "value.txt"), "utf8"), "before");
    assert.equal(git(sourceRepo, ["status", "--porcelain"]), "");
    const reopened = new DevelopmentController({ ...options, completedCheckArchive: true }); assert.equal((await reopened.status()).queue.items[0]!.status, "accepted");
    await assert.rejects(new ActionLedger(join(root, "actions")).list(), /schema/);
    const ordinary = new ActionLedger(join(root, "ordinary")); const claim = await ordinary.admit({ idempotencyKey: "v1", kind: "candidate-check", input: {} }, () => false);
    await ordinary.complete(claim, { evidence: { summary: "Default lifecycle", references: ["host:default"] } });
    const v1 = JSON.parse(await readFile(join(root, "ordinary", "actions.json"), "utf8")); assert.equal(v1.schemaVersion, 1); assert.equal("archivedChecks" in v1, false);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
