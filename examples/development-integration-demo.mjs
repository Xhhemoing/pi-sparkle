#!/usr/bin/env node
// Explicit host SDK integration in a retained temporary fixture; no live model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { DevelopmentController } from "../dist/development/controller.js";
import { reviewDevelopmentCandidate } from "../dist/development/candidate-review.js";
import { createWorkQueue } from "../dist/development/work-items.js";
import { loopArtifactPath, readLoopArtifact } from "../dist/execution/loop-artifact.js";
import { prepareTrustedVerification } from "../dist/execution/trusted-verification.js";
import { NativeApplySession } from "../dist/native/apply.js";
import { EventStore } from "../dist/run/event-store.js";
import { ProtocolChildExecutor } from "../dist/testing/fake-executor.js";

function git(cwd, args) {
  const result = spawnSync("git", args, {cwd, encoding: "utf8", windowsHide: true});
  assert.equal(result.status, 0, result.error?.message ?? result.stderr); return result.stdout.trim();
}
const workspace = fileURLToPath(new URL("../.agent_workspace/", import.meta.url));
await mkdir(workspace, {recursive: true});
const root = await mkdtemp(path.join(workspace, "development-integration-demo-"));
const sourceRepo = path.join(root, "source"), stateRoot = path.join(root, "state"), queuePath = path.join(root, "queue.json");
const sandboxRoot = path.join(root, "candidates"), hooks = path.join(root, "empty-hooks");
await Promise.all([sourceRepo, stateRoot, sandboxRoot, hooks].map(directory => mkdir(directory)));
git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Explicit SDK integration demo"]);
git(sourceRepo, ["config", "user.email", "demo@example.invalid"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
git(sourceRepo, ["config", "core.hooksPath", hooks]);
const recipes = ["a", "b"].map(id => ({id, command: process.execPath, args: [`check-${id}.mjs`],
  verifierVersion: "demo-v1", protectedPaths: [`check-${id}.mjs`]}));
for (const recipe of recipes) {
  await writeFile(path.join(sourceRepo, `${recipe.id}.txt`), "before");
  await writeFile(path.join(sourceRepo, `check-${recipe.id}.mjs`),
    `import assert from 'node:assert/strict';import fs from 'node:fs';assert.equal(fs.readFileSync('${recipe.id}.txt','utf8'),'after');`);
}
git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "Host integration fixture"]);
const initialRevision = git(sourceRepo, ["rev-parse", "HEAD"]);
const checkerBefore = await Promise.all(recipes.map(recipe => readFile(path.join(sourceRepo, `check-${recipe.id}.mjs`))));
const attempts = {a: [], b: []};
let workerExecutions = 0;
const controller = new DevelopmentController({sourceRepo, stateRoot, queuePath, sandboxRoot, owner: "demo:host-sdk",
  executorFactory: ({tools, acceptanceCriteria, attempt}) => ({async *execute(request, signal) {
    const id = acceptanceCriteria[0].id; assert.ok(attempt);
    if (attempt.number === 2) assert.equal(attempt.previous.exitCode, 1);
    attempts[id].push(attempt.number); workerExecutions++;
    await tools.find(tool => tool.name === "sparkle_write_file").execute(`write-${id}-${attempt.number}`,
      {path: `${id}.txt`, contents: attempt.previous === undefined ? "wrong" : "after"}, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  }})});
await controller.store.create(createWorkQueue({id: "host-sdk-integration", authorityRef: "examples/development-integration-demo.mjs:host",
  items: recipes.map((recipe, index) => ({id: recipe.id, goal: `Implement ${recipe.id}`,
    dependencies: index === 0 ? [] : ["a"], allowedScope: [`${recipe.id}.txt`], priority: 90-index, acceptance: [recipe]}))}));
const started = performance.now();
const first = await controller.runNext({maxAttempts: 2, maxWallTimeMs: 30000});
assert.equal(first.status, "ready-for-review"); assert.deepEqual(attempts.a, [1, 2]);
const historical = await reviewDevelopmentCandidate({sourceRepo, queuePath, stateRoot, actionId: first.actionId});
assert.equal(historical.itemStatus, "ready-for-review"); assert.equal(historical.reverified, false);
assert.deepEqual(historical.attempts.map(attempt => attempt.accepted), [false, true]);
// A real explicit host decision; the historical native check is not this authority.
await controller.accept("a");
assert.equal((await controller.status()).queue.items[0].status, "accepted");
const beforeIntegration = await controller.runNext();
assert.equal(beforeIntegration.status, "needs-reconciliation"); assert.equal(workerExecutions, 2);
const review = await reviewDevelopmentCandidate({sourceRepo, queuePath, stateRoot, actionId: first.actionId});
assert.equal(review.itemStatus, "accepted"); assert.equal(review.evidenceStatus, "available");
const [runId, artifactId] = review.finalArtifactRef.split("/");
const stored = await readLoopArtifact(stateRoot, runId, artifactId, {maxBytes: 512*1024,
  eventLogLimits: {maxBytes: 2*1024*1024, maxRecords: 10000}});
// Fixed host definitions rebuild the command and external checker dependencies.
// Artifact JSON provides history; it does not reconstruct an in-process capability.
const checker = fileURLToPath(new URL("../dist/development/recipe-check.js", import.meta.url));
const args = [checker, JSON.stringify([recipes[0]])];
assert.equal(stored.command, process.execPath); assert.deepEqual(stored.args, args);
assert.equal(stored.cwd, review.candidatePath); assert.equal(stored.revision, initialRevision);
assert.equal(git(review.candidatePath, ["diff", "--name-only", "HEAD"]), "a.txt");
for (let index = 0; index < recipes.length; index++) assert.deepEqual(
  await readFile(path.join(review.candidatePath, `check-${recipes[index].id}.mjs`)), checkerBefore[index]);
const events = (await new EventStore(stateRoot, runId).readAll({maxBytes: 2*1024*1024, maxRecords: 10000})).events;
const result = {runId, status: "COMPLETED", sourceRevision: initialRevision, candidatePath: review.candidatePath,
  artifact: {id: artifactId, path: loopArtifactPath(stateRoot, runId, artifactId), schemaVersion: "loop-artifact-v2",
    byteLength: Buffer.byteLength(JSON.stringify(stored))}, executionEvents: events.length, reason: "explicit host fixture acceptance",
  acceptance: {accepted: true, artifactId, revision: initialRevision, cwd: review.candidatePath, command: process.execPath,
    args, independentCheck: stored.check, reason: "explicit host accepted queue item"}};
const descriptor = prepareTrustedVerification({command: process.execPath, args,
  checkerFiles: [checker, fileURLToPath(new URL("../dist/execution/command-runner.js", import.meta.url)),
    fileURLToPath(new URL("../dist/domain/errors.js", import.meta.url))], maxSnapshotFiles: 1024, maxSnapshotBytes: 16*1024*1024});
const intent = await controller.ledger.prepare({kind: "candidate-apply", idempotencyKey: `host-apply:${first.actionId}`,
  input: {candidateActionId: first.actionId, sourceRepo, sourceRevision: initialRevision, candidatePath: review.candidatePath}});
let claim = await controller.ledger.claim(intent.actionId, intent.version);
let prepared;
let applied;
try {
  applied = await new NativeApplySession().apply({sourceRepo, result, trustedVerification: descriptor,
    onPrepared: async target => {
      assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), initialRevision);
      prepared = target; assert.equal(Object.isFrozen(target), true);
      claim = await controller.ledger.checkpoint(claim, {result: target,
        evidence: {summary: "host saved target before checkout", references: [`git:${target.appliedRevision}`]}});
      assert.equal(JSON.parse((await controller.ledger.get(intent.actionId)).resultCanonicalJson).appliedRevision, target.appliedRevision);
    }});
  assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), applied.appliedRevision);
  await controller.ledger.complete(claim, {result: applied,
    evidence: {summary: "host observed applied revision and clean source", references: [`git:${applied.appliedRevision}`]}});
} catch (error) {
  // Never infer safe-to-retry or discard candidate/source from a failed call.
  await controller.ledger.markUncertain(claim, {result: {prepared: prepared ?? null},
    evidence: {summary: "application requires host actual-state inspection", references: [review.finalArtifactRef]}});
  throw error;
}
assert.ok(prepared); assert.equal(applied.reverified, true);
assert.equal(await readFile(path.join(sourceRepo, "a.txt"), "utf8"), "after");
assert.equal(await readFile(path.join(sourceRepo, "b.txt"), "utf8"), "before");
assert.equal(git(sourceRepo, ["status", "--porcelain", "--ignored"]), "");
const second = await controller.runNext({maxAttempts: 2, maxWallTimeMs: 30000});
assert.equal(second.status, "ready-for-review"); assert.equal(second.itemId, "b"); assert.deepEqual(attempts.b, [1, 2]);
assert.equal(git(second.candidatePath, ["rev-parse", "HEAD"]), applied.appliedRevision);
assert.equal(await readFile(path.join(second.candidatePath, "a.txt"), "utf8"), "after");
assert.equal((await controller.status()).queue.items[1].status, "ready-for-review");
for (let index = 0; index < recipes.length; index++) assert.deepEqual(
  await readFile(path.join(sourceRepo, `check-${recipes[index].id}.mjs`)), checkerBefore[index]);
assert.equal(await readFile(path.join(sourceRepo, "b.txt"), "utf8"), "before");
console.log(JSON.stringify({mode: "offline-scripted-explicit-host-sdk", liveModelCalls: 0, costSource: "unknown",
  supportsLiveEffectivenessClaim: false, fixtureOnlySourceApplication: true, sourceApplied: true,
  initialRevision, appliedRevision: applied.appliedRevision, candidateTree: prepared.candidateTree,
  preparedTargetPersistedBeforeMutation: true, applyActionId: intent.actionId, applyActionState: (await controller.ledger.get(intent.actionId)).state,
  prerequisiteState: "accepted", dependentState: second.status, dependentBase: git(second.candidatePath, ["rev-parse", "HEAD"]),
  historicalReverified: historical.reverified, currentApplyReverified: applied.reverified,
  attempts, workerExecutions, automaticAcceptance: false, automaticApplication: false,
  candidates: [first.candidatePath, second.candidatePath], queuePath, retainedEvidenceRoot: root,
  durationMs: performance.now()-started}, null, 2));
