import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { reviewDevelopmentCandidate } from "../../../src/development/candidate-review.js";
import { createWorkQueue, type WorkItemRecipe } from "../../../src/development/work-items.js";
import { parseRunId } from "../../../src/domain/ids.js";
import type { IndependentCheckRecord } from "../../../src/execution/independent-check.js";
import { loopArtifactPath, readLoopArtifact } from "../../../src/execution/loop-artifact.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { NativeApplySession, type NativeApplyInput } from "../../../src/native/apply.js";
import type { NativeWriteSessionResult } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(body: (value: {root: string; sourceRepo: string; stateRoot: string; queuePath: string;
  controller: DevelopmentController; recipes: readonly WorkItemRecipe[]; calls: () => number}) => Promise<void>, dependent = true) {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-host-integration-"));
  const sourceRepo = path.join(root, "source"); await mkdir(sourceRepo);
  git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Integration fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
  for (const id of ["a", "b"]) {
    await writeFile(path.join(sourceRepo, `${id}.txt`), "before");
    await writeFile(path.join(sourceRepo, `check-${id}.mjs`), `import assert from 'node:assert/strict';import fs from 'node:fs';assert.equal(fs.readFileSync('${id}.txt','utf8'),'after');`);
  }
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const stateRoot = path.join(root, "state"), queuePath = path.join(root, "queue.json");
  const recipes = ["a", "b"].map((id): WorkItemRecipe => ({ id, command: process.execPath, args: [`check-${id}.mjs`],
    verifierVersion: "v1", protectedPaths: [`check-${id}.mjs`] }));
  let calls = 0;
  const controller = new DevelopmentController({ sourceRepo, stateRoot, queuePath, sandboxRoot: path.join(root, "candidates"),
    owner: "host:integration", executorFactory: ({ tools, acceptanceCriteria }) => ({ async *execute(request, signal) {
      calls++; const id = acceptanceCriteria![0]!.id;
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: `${id}.txt`, contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
  await controller.store.create(createWorkQueue({ id: "integration", authorityRef: "host:test", items: recipes.map((recipe, index) => ({
    id: recipe.id, goal: `Repair ${recipe.id}`, dependencies: index === 0 || !dependent ? [] : ["a"], allowedScope: [`${recipe.id}.txt`],
    priority: 90-index, acceptance: [recipe]
  })) }));
  try { await body({ root, sourceRepo, stateRoot, queuePath, controller, recipes, calls: () => calls }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

// This is explicit host fixture code, not a public serialized-authority bridge.
// Recipe and external checker paths come from this host's fixed definitions.
async function hostApplyInput(value: Parameters<Parameters<typeof fixture>[0]>[0], actionId: string): Promise<NativeApplyInput> {
  const review = await reviewDevelopmentCandidate({ sourceRepo: value.sourceRepo, queuePath: value.queuePath, stateRoot: value.stateRoot, actionId });
  assert.equal(review.itemStatus, "accepted"); assert.equal(review.historicalAccepted, true);
  assert.equal(review.evidenceStatus, "available"); assert.ok(review.finalArtifactRef);
  const recipe = value.recipes.find((entry) => entry.id === review.itemId)!;
  const checker = fileURLToPath(new URL("../../../src/development/recipe-check.ts", import.meta.url));
  const args = ["--import", import.meta.resolve("tsx"), checker, JSON.stringify([recipe])];
  const [run, id] = review.finalArtifactRef.split("/") as [string, string]; const runId = parseRunId(run);
  const stored = await readLoopArtifact(value.stateRoot, runId, id, { maxBytes: 512*1024, eventLogLimits: {maxBytes: 2*1024*1024, maxRecords: 10000} }) as {
    kind: string; command: string; args: string[]; revision: string; cwd: string; check: IndependentCheckRecord
  };
  assert.equal(stored.kind, "ps-p3-closed-loop"); assert.equal(stored.command, process.execPath); assert.deepEqual(stored.args, args);
  assert.equal(stored.cwd, review.candidatePath); assert.equal(stored.revision, review.baseRevision);
  assert.deepEqual(git(review.candidatePath, ["diff", "--name-only", "HEAD"]).split("\n"), [`${recipe.id}.txt`]);
  assert.equal(await readFile(path.join(review.candidatePath, `check-${recipe.id}.mjs`), "utf8"),
    await readFile(path.join(value.sourceRepo, `check-${recipe.id}.mjs`), "utf8"));
  const result: NativeWriteSessionResult = { runId, status: "COMPLETED", sourceRevision: review.baseRevision,
    candidatePath: review.candidatePath, artifact: {id, path: loopArtifactPath(value.stateRoot, runId, id),
      schemaVersion: "loop-artifact-v2", byteLength: Buffer.byteLength(JSON.stringify(stored))}, executionEvents: 0,
    reason: "explicit host fixture acceptance", acceptance: { accepted: true, artifactId: id, revision: review.baseRevision,
      cwd: review.candidatePath, command: process.execPath, args, independentCheck: stored.check, reason: "host accepted queue item" } };
  const trustedVerification = prepareTrustedVerification({ command: process.execPath, args,
    checkerFiles: [checker, fileURLToPath(new URL("../../../src/execution/command-runner.ts", import.meta.url)),
      fileURLToPath(new URL("../../../src/domain/errors.ts", import.meta.url))], maxSnapshotFiles: 1024, maxSnapshotBytes: 16*1024*1024 });
  return { sourceRepo: value.sourceRepo, result, trustedVerification } as NativeApplyInput;
}

test("explicit host SDK integration lets a dependent task start only from the integrated revision", async () => fixture(async (value) => {
  const first = await value.controller.runNext(); assert.equal(first.status, "ready-for-review");
  await assert.rejects(hostApplyInput(value, first.actionId!), /accepted|artifact|evidence/);
  await value.controller.accept("a");
  assert.equal((await value.controller.runNext()).status, "needs-reconciliation"); assert.equal(value.calls(), 1);
  const input = await hostApplyInput(value, first.actionId!);
  const intent = await value.controller.ledger.prepare({ idempotencyKey: `integration:${first.actionId}:apply`, kind: "candidate-apply",
    input: { candidateActionId: first.actionId, sourceRevision: input.result.sourceRevision, candidatePath: input.result.candidatePath } });
  let claim = await value.controller.ledger.claim(intent.actionId, intent.version);
  const applied = await new NativeApplySession().apply({ ...input, onPrepared: async (target: {appliedRevision: string; candidateTree: string}) => {
    assert.equal(git(value.sourceRepo, ["rev-parse", "HEAD"]), input.result.sourceRevision);
    claim = await value.controller.ledger.checkpoint(claim, { result: target,
      evidence: { summary: "target recorded before source mutation", references: [`git:${target.appliedRevision}`] } });
    const recorded = await value.controller.ledger.get(intent.actionId);
    assert.equal(JSON.parse(recorded!.resultCanonicalJson!).appliedRevision, target.appliedRevision);
  } } as NativeApplyInput);
  await value.controller.ledger.complete(claim, { result: applied,
    evidence: {summary: "actual source revision observed", references: [`git:${git(value.sourceRepo, ["rev-parse", "HEAD"])}`]} });
  assert.equal(applied.status, "APPLIED"); assert.equal(applied.reverified, true);
  assert.equal(await readFile(path.join(value.sourceRepo, "a.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(value.sourceRepo, "b.txt"), "utf8"), "before");
  assert.equal(git(value.sourceRepo, ["status", "--porcelain", "--ignored"]), "");
  assert.equal((await value.controller.status()).queue.items[0]!.status, "accepted");
  const second = await value.controller.runNext(); assert.equal(second.status, "ready-for-review"); assert.equal(second.itemId, "b");
  assert.equal(value.calls(), 2); assert.equal(git(second.candidatePath!, ["rev-parse", "HEAD"]), applied.appliedRevision);
  assert.equal(await readFile(path.join(second.candidatePath!, "a.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(first.candidatePath!, "a.txt"), "utf8"), "after");
}));


test("same-base sibling remains stale after explicit integration and is never silently rebased", async () => fixture(async (value) => {
  const first = await value.controller.runNext(), second = await value.controller.runNext();
  assert.equal(first.status, "ready-for-review"); assert.equal(second.status, "ready-for-review");
  await value.controller.accept("a"); await value.controller.accept("b");
  const firstInput = await hostApplyInput(value, first.actionId!), secondInput = await hostApplyInput(value, second.actionId!);
  const applied = await new NativeApplySession().apply(firstInput);
  await assert.rejects(new NativeApplySession().apply(secondInput), /stale target/);
  assert.equal(git(value.sourceRepo, ["rev-parse", "HEAD"]), applied.appliedRevision);
  assert.equal(await readFile(path.join(value.sourceRepo, "a.txt"), "utf8"), "after");
  assert.equal(await readFile(path.join(value.sourceRepo, "b.txt"), "utf8"), "before");
  assert.equal(await readFile(path.join(second.candidatePath!, "b.txt"), "utf8"), "after");
  assert.equal(value.calls(), 2);
}, false));
