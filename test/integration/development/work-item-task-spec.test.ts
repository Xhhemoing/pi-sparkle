import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { TaskSpecSession } from "../../../src/development/task-session.js";
import { authorTaskSpecFromWorkItem } from "../../../src/development/work-item-task-spec.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("host-authored work item reaches TaskSpec preflight, independent check and explicit apply without claiming the queue", { timeout: 120000 }, async () => {
  const parent = path.resolve(".agent_workspace/work-item-task-spec");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "bridge-")), sourceRepo = path.join(root, "source");
  const session = new TaskSpecSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates") });
  try {
    await mkdir(path.join(sourceRepo, "checks"), { recursive: true });
    await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
    const checker = "if(require('node:fs').readFileSync('value.txt','utf8')!=='after'){console.log(JSON.stringify({assertion:'value-regression',outcome:'failed'}));process.exit(1)}";
    await writeFile(path.join(sourceRepo, "checks/check.cjs"), checker, "utf8");
    git(sourceRepo, ["init", "-b", "fixture"]);
    git(sourceRepo, ["config", "core.autocrlf", "false"]);
    git(sourceRepo, ["config", "user.name", "Synthetic work-item bridge"]);
    git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
    git(sourceRepo, ["add", "."]);
    git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const revision = git(sourceRepo, ["rev-parse", "HEAD"]);
    const queueFile = path.join(root, "queue.json"), store = new WorkItemStore(queueFile);
    await store.create(createWorkQueue({ id: "bridge", authorityRef: "host:synthetic-fixture", items: [{
      id: "repair-value", goal: "Repair value.txt", dependencies: [], priority: 90, allowedScope: ["value.txt"],
      acceptance: [{ id: "business", command: process.execPath, args: ["checks/check.cjs"], verifierVersion: "v1", protectedPaths: ["checks"] }]
    }] }));
    const queueBytes = await readFile(queueFile, "utf8"), queue = JSON.parse(queueBytes);
    const authored = authorTaskSpecFromWorkItem({ item: queue.items[0].definition, context: ["value.txt"], prepare: [],
      checkExpectations: { business: { expect: { baseline: "fail", failureAssertion: "value-regression" } } },
      budget: { totalSeconds: 40, prepareSeconds: 5, checkSeconds: 8, workerSeconds: 8 } });
    assert.equal(authored.workItemId, "repair-value");
    let workerCalls = 0;
    const result = await session.run({ sourceRepo, spec: authored.spec, executorFactory(context) {
      workerCalls++;
      return { async *execute(request, signal) {
        await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    } });
    assert.equal(workerCalls, 1, "the real baseline must reach the worker exactly once");
    assert.equal(result.accepted, true);
    assert.equal(result.effectsSettled, true);
    assert.equal(result.managed, true);
    assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "before");
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), revision);
    const applied = await session.apply(result.runId);
    assert.equal(applied.status, "APPLIED");
    assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), "after");
    assert.equal(await readFile(path.join(sourceRepo, "checks/check.cjs"), "utf8"), checker);
    assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), applied.appliedRevision);
    assert.equal(spawnSync(process.execPath, ["checks/check.cjs"], { cwd: sourceRepo, windowsHide: true }).status, 0);
    assert.equal(await readFile(queueFile, "utf8"), queueBytes, "authoring/execution must not claim or mark the queue accepted");
  } finally {
    await session.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
