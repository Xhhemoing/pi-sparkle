#!/usr/bin/env node
// Offline controller demonstration: scripted edits, real Git and host checks.
// No live model, source application, or removal of the retained review evidence.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DevelopmentController } from "../dist/development/controller.js";
import { summarizeDevelopmentTrials } from "../dist/development/evaluation.js";
import { createWorkQueue } from "../dist/development/work-items.js";
import { readLoopArtifact } from "../dist/execution/loop-artifact.js";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(`demo git failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.trim();
}

const workspace = fileURLToPath(new URL("../.agent_workspace/", import.meta.url));
await mkdir(workspace, { recursive: true });
const root = await mkdtemp(path.join(workspace, "development-demo-"));
const sourceRepo = path.join(root, "source");
const stateRoot = path.join(root, "state");
const sandboxRoot = path.join(root, "candidates");
const queuePath = path.join(root, "queue.json");
const hooksRoot = path.join(root, "empty-hooks");
await Promise.all([sourceRepo, stateRoot, sandboxRoot, hooksRoot].map((directory) => mkdir(directory)));
git(sourceRepo, ["init"]);
git(sourceRepo, ["config", "user.name", "Sparkle offline development demo"]);
git(sourceRepo, ["config", "user.email", "demo@example.invalid"]);
git(sourceRepo, ["config", "core.hooksPath", hooksRoot]);
const original = "export const add = (a, b) => 0;\n";
const checker = "import assert from 'node:assert/strict';\nimport { add } from './add.mjs';\nassert.equal(add(2, 3), 5);\nassert.equal(add(-2, 1), -1);\n";
await writeFile(path.join(sourceRepo, "add.mjs"), original);
await writeFile(path.join(sourceRepo, "check-add.mjs"), checker);
git(sourceRepo, ["add", "add.mjs", "check-add.mjs"]);
git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "Offline development fixture"]);
const sourceRevision = git(sourceRepo, ["rev-parse", "HEAD"]);
const attempts = [];
let failedFeedback;

const controller = new DevelopmentController({
  sourceRepo, stateRoot, sandboxRoot, queuePath, owner: "demo:scripted",
  executorFactory({ tools, attempt, acceptanceCriteria }) {
    assert.ok(attempt, "bounded execution provides attempt context");
    assert.deepEqual(acceptanceCriteria.map((criterion) => criterion.id), ["addition"]);
    attempts.push(attempt.number);
    if (attempt.number === 2) {
      assert.equal(attempt.previous?.exitCode, 1, "repair follows an actual failed host command");
      assert.match(attempt.previous.stdoutText, /addition/);
      failedFeedback = attempt.previous;
    }
    return {
      async *execute(request, signal) {
        const writer = tools.find((tool) => tool.name === "sparkle_write_file");
        assert.ok(writer);
        // Deliberately wrong first attempt; repair uses the host's failure feedback.
        const operator = attempt.previous === undefined ? "-" : "+";
        await writer.execute(`demo-write-${attempt.number}`, {
          path: "add.mjs", contents: `export const add = (a, b) => a ${operator} b;\n`
        }, signal);
        yield { type: "MESSAGE", message: {
          protocolVersion: 1, id: `msg_${randomUUID()}`, occurredAt: new Date().toISOString(),
          runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: "SUPERVISOR",
          type: "TASK_RESULT", outcome: "SUCCESS", summary: "Scripted edit; host verification is required",
          artifactIds: [], evidenceIds: [], verification: { kind: "UNOBSERVED", evidenceIds: [] }
        } };
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    };
  }
});

await controller.store.create(createWorkQueue({
  id: "offline-addition", authorityRef: "examples/development-demo.mjs:host-fixture",
  items: [{ id: "implement-addition", goal: "Implement addition in add.mjs and preserve the host checker",
    dependencies: [], allowedScope: ["add.mjs"], priority: 90,
    acceptance: [{ id: "addition", command: process.execPath, args: ["check-add.mjs"],
      verifierVersion: "demo-addition-v1", protectedPaths: ["check-add.mjs"] }] }]
}));
assert.equal((await controller.next())?.id, "implement-addition");
const startedAt = performance.now();
const result = await controller.runNext({ maxAttempts: 3, maxWallTimeMs: 30_000 });
assert.equal(result.status, "ready-for-review");
assert.deepEqual(attempts, [1, 2]);
assert.ok(failedFeedback);
const failed = await readLoopArtifact(stateRoot, failedFeedback.runId, failedFeedback.artifactId);
assert.equal(failed.check.ok, false);
assert.equal(failed.check.exitCode, 1);
assert.equal(failed.check.trustedVerification.ok, true, "failure came from behavior, not verifier drift");

const checkpoint = await controller.status();
assert.equal(checkpoint.queue.items[0].status, "ready-for-review");
const action = checkpoint.actions.find((entry) => entry.actionId === result.actionId);
assert.equal(action?.state, "completed");
const receipt = JSON.parse(action.resultCanonicalJson);
assert.equal(receipt.accepted, true);
const [runId, artifactId] = receipt.evidence[0].artifactRef.split("/");
const passed = await readLoopArtifact(stateRoot, runId, artifactId);
assert.equal(passed.check.ok, true);
assert.equal(passed.check.exitCode, 0);
assert.equal(passed.check.trustedVerification.ok, true);

// This separate host call re-verifies the candidate; runNext never accepts it itself.
await controller.accept("implement-addition");
const accepted = (await controller.status()).queue.items[0].status === "accepted";
assert.equal(accepted, true);
const durationMs = performance.now() - startedAt;
const descriptiveEvaluation = summarizeDevelopmentTrials([{ mode: "scripted", taskId: "implement-addition",
  accepted, attempts: attempts.length, durationMs, costSource: "unknown", evidenceRef: receipt.evidence[0].artifactRef }]);
assert.equal(descriptiveEvaluation.mode, "scripted");
assert.equal(descriptiveEvaluation.repairSuccessRate, 1);
assert.equal(descriptiveEvaluation.costCoverage, 0);
assert.equal(descriptiveEvaluation.costPerAcceptedTaskUsd, undefined);
assert.equal((await controller.runNext()).status, "no-ready-task");
assert.equal(await readFile(path.join(sourceRepo, "add.mjs"), "utf8"), original);
assert.equal(await readFile(path.join(sourceRepo, "check-add.mjs"), "utf8"), checker);
assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), sourceRevision);
assert.equal(git(sourceRepo, ["status", "--porcelain", "--ignored"]), "");
assert.equal(await readFile(path.join(result.candidatePath, "add.mjs"), "utf8"), "export const add = (a, b) => a + b;\n");
assert.equal(await readFile(path.join(result.candidatePath, "check-add.mjs"), "utf8"), checker);
console.log(JSON.stringify({
  mode: "offline-scripted", liveModelCalls: 0, supportsLiveEffectivenessClaim: false,
  costSource: "unknown", descriptiveEvaluation,
  taskStatus: "accepted", checkpointBeforeHostAcceptance: result.status, attempts,
  firstHostCheck: { exitCode: failed.check.exitCode, artifactRef: `${failedFeedback.runId}/${failedFeedback.artifactId}` },
  repairedHostCheck: { exitCode: passed.check.exitCode, artifactRef: receipt.evidence[0].artifactRef },
  sourceUnchanged: true, sourceApplied: false, actionId: result.actionId,
  candidatePath: result.candidatePath, queuePath, retainedEvidenceRoot: root
}, null, 2));
