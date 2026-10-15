#!/usr/bin/env node
// Offline scripted batch: real Git, protected host checks and retained candidates.
// No live model, automatic acceptance, source application or evidence cleanup.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { DevelopmentController } from "../dist/development/controller.js";
import { runDevelopmentBatch } from "../dist/development/batch.js";
import { reviewDevelopmentCandidate } from "../dist/development/candidate-review.js";
import { createWorkQueue } from "../dist/development/work-items.js";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`batch demo Git failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

const specifications = [
  { itemId: "implement-addition", criterionId: "addition", implementation: "add.mjs", checker: "check-add.mjs",
    original: "export const add = (a, b) => 0;\n",
    wrong: "export const add = (a, b) => a - b;\n",
    repaired: "export const add = (a, b) => a + b;\n",
    check: "import assert from 'node:assert/strict';\nimport { add } from './add.mjs';\nassert.equal(add(2, 3), 5);\nassert.equal(add(-2, 1), -1);\n" },
  { itemId: "implement-multiplication", criterionId: "multiplication", implementation: "multiply.mjs", checker: "check-multiply.mjs",
    original: "export const multiply = (a, b) => 0;\n",
    wrong: "export const multiply = (a, b) => a + b;\n",
    repaired: "export const multiply = (a, b) => a * b;\n",
    check: "import assert from 'node:assert/strict';\nimport { multiply } from './multiply.mjs';\nassert.equal(multiply(2, 3), 6);\nassert.equal(multiply(-2, 3), -6);\n" }
];
const workspace = fileURLToPath(new URL("../.agent_workspace/", import.meta.url));
await mkdir(workspace, { recursive: true });
const root = await mkdtemp(path.join(workspace, "development-batch-demo-"));
const sourceRepo = path.join(root, "source");
const stateRoot = path.join(root, "state");
const sandboxRoot = path.join(root, "candidates");
const queuePath = path.join(root, "queue.json");
const hooksRoot = path.join(root, "empty-hooks");
await Promise.all([sourceRepo, stateRoot, sandboxRoot, hooksRoot].map((directory) => mkdir(directory)));
git(sourceRepo, ["init"]);
git(sourceRepo, ["config", "user.name", "Sparkle offline batch demo"]);
git(sourceRepo, ["config", "user.email", "demo@example.invalid"]);
git(sourceRepo, ["config", "core.hooksPath", hooksRoot]);
const sourceFiles = specifications.flatMap((specification) => [specification.implementation, specification.checker]);
await Promise.all(specifications.flatMap((specification) => [
  writeFile(path.join(sourceRepo, specification.implementation), specification.original),
  writeFile(path.join(sourceRepo, specification.checker), specification.check)
]));
git(sourceRepo, ["add", ...sourceFiles]);
git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "Offline batch fixture"]);
const sourceRevision = git(sourceRepo, ["rev-parse", "HEAD"]);
const attempts = new Map(specifications.map((specification) => [specification.itemId, []]));
let workerExecutions = 0;

const controller = new DevelopmentController({
  sourceRepo, stateRoot, sandboxRoot, queuePath, owner: "demo:scripted",
  executorFactory({ tools, attempt, acceptanceCriteria }) {
    assert.ok(attempt, "bounded execution supplies an attempt context");
    assert.equal(acceptanceCriteria.length, 1);
    const specification = specifications.find((entry) => entry.criterionId === acceptanceCriteria[0].id);
    assert.ok(specification, "the host criterion identifies the scripted fixture task");
    assert.ok(attempt.number === 1 || attempt.number === 2);
    if (attempt.number === 1) assert.equal(attempt.previous, undefined);
    else {
      assert.equal(attempt.previous?.exitCode, 1, "repair requires actual failed host feedback");
      assert.ok(attempt.previous.stdoutText.includes(specification.criterionId));
    }
    return {
      async *execute(request, signal) {
        workerExecutions++;
        attempts.get(specification.itemId).push(attempt.number);
        const writer = tools.find((tool) => tool.name === "sparkle_write_file");
        assert.ok(writer);
        // This deterministic fixture intentionally fails, then consumes the
        // prior host failure before choosing its scripted repair.
        await writer.execute(`batch-demo-${specification.itemId}-${attempt.number}`, {
          path: specification.implementation,
          contents: attempt.previous === undefined ? specification.wrong : specification.repaired
        }, signal);
        yield { type: "MESSAGE", message: {
          protocolVersion: 1, id: `msg_${randomUUID()}`, occurredAt: new Date().toISOString(),
          runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR",
          type: "TASK_RESULT", outcome: "SUCCESS", summary: "Scripted candidate edit; host verification decides",
          artifactIds: [], evidenceIds: [], verification: { kind: "UNOBSERVED", evidenceIds: [] }
        } };
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    };
  }
});
await controller.store.create(createWorkQueue({
  id: "offline-batch", authorityRef: "examples/development-batch-demo.mjs:host-fixture",
  items: specifications.map((specification, index) => ({
    id: specification.itemId, goal: `Implement ${specification.criterionId} and preserve the host checker`,
    dependencies: [], allowedScope: [specification.implementation], priority: 90 - index,
    acceptance: [{ id: specification.criterionId, command: process.execPath, args: [specification.checker],
      verifierVersion: `demo-${specification.criterionId}-v1`, protectedPaths: [specification.checker] }]
  }))
}));

const startedAt = performance.now();
const batch = await runDevelopmentBatch(controller, {
  maxItems: 2, maxAttempts: 2, maxWallTimeMs: 60_000, perItemWallTimeMs: 30_000
});
assert.equal(batch.stopReason, "max-items");
assert.equal(batch.deadlineExceeded, false);
assert.equal(batch.sourceRevision, sourceRevision);
assert.equal(batch.sourceApplied, false);
assert.equal(batch.results.length, 2);
assert.deepEqual(batch.results.map((result) => result.status), ["ready-for-review", "ready-for-review"]);
assert.equal(batch.queueSummary.readyForReview, 2);
assert.equal(batch.queueSummary.accepted, 0);
assert.equal(workerExecutions, 4);
assert.equal(new Set(batch.results.map((result) => result.candidatePath)).size, 2);
for (const specification of specifications) assert.deepEqual(attempts.get(specification.itemId), [1, 2]);

const snapshots = [queuePath, path.join(root, "actions", "actions.json"),
  ...[sourceRepo, ...batch.results.map((result) => result.candidatePath)]
    .flatMap((directory) => sourceFiles.map((file) => path.join(directory, file)))];
const beforeReview = await Promise.all(snapshots.map((file) => readFile(file)));
const reviews = [];
for (const result of batch.results) {
  assert.ok(result.actionId);
  const review = await reviewDevelopmentCandidate({ sourceRepo, queuePath, stateRoot, actionId: result.actionId });
  assert.equal(review.itemId, result.itemId);
  assert.equal(review.candidatePath, result.candidatePath);
  assert.equal(review.itemStatus, "ready-for-review");
  assert.equal(review.evidenceStatus, "available");
  assert.equal(review.historicalOnly, true);
  assert.equal(review.reverified, false);
  assert.equal(review.sourceApplied, false);
  assert.equal(review.historicalAccepted, true, "the native host check passed; task acceptance is still separate");
  assert.equal(review.stopReason, "accepted");
  assert.ok(review.finalArtifactRef && review.loopArtifactRef);
  assert.deepEqual(review.attempts.map((attempt) => attempt.accepted), [false, true]);
  assert.deepEqual(review.attempts.map((attempt) => attempt.check.exitCode), [1, 0]);
  assert.ok(review.attempts.every((attempt) => attempt.perCriterionVerification === "UNOBSERVED"));
  reviews.push(review);
}
assert.deepEqual(await Promise.all(snapshots.map((file) => readFile(file))), beforeReview);
assert.equal(workerExecutions, 4, "historical review never dispatches another worker");
const checkpoint = await controller.status();
assert.deepEqual(checkpoint.queue.items.map((item) => item.status), ["ready-for-review", "ready-for-review"]);
assert.equal(checkpoint.queue.items.filter((item) => item.status === "accepted").length, 0);
assert.ok(checkpoint.actions.every((action) => action.state === "completed"));

for (const specification of specifications) {
  assert.equal(await readFile(path.join(sourceRepo, specification.implementation), "utf8"), specification.original);
  assert.equal(await readFile(path.join(sourceRepo, specification.checker), "utf8"), specification.check);
  for (const result of batch.results) {
    assert.equal(await readFile(path.join(result.candidatePath, specification.implementation), "utf8"),
      result.itemId === specification.itemId ? specification.repaired : specification.original);
    assert.equal(await readFile(path.join(result.candidatePath, specification.checker), "utf8"), specification.check);
    assert.equal(git(result.candidatePath, ["rev-parse", "HEAD"]), sourceRevision);
  }
}
assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), sourceRevision);
assert.equal(git(sourceRepo, ["status", "--porcelain", "--ignored"]), "");
const durationMs = performance.now() - startedAt;
console.log(JSON.stringify({
  mode: "offline-scripted", liveModelCalls: 0, supportsLiveEffectivenessClaim: false,
  costSource: "unknown", durationMs,
  batch: { stopReason: batch.stopReason, elapsedMs: batch.elapsedMs, limits: batch.limits,
    deadlineExceeded: batch.deadlineExceeded, queueSummary: batch.queueSummary },
  tasks: batch.results.map((result, index) => ({ ...result,
    scriptedAttempts: attempts.get(result.itemId), historicalReview: reviews[index] })),
  acceptedTasks: 0, sourceRevision, sourceUnchanged: true, sourceApplied: false,
  reviewChangedSnapshotBytes: false, workerExecutions, queuePath, retainedEvidenceRoot: root
}, null, 2));
