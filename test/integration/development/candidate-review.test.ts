import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalizeStableJson } from "../../../src/domain/canonical-json.js";
import { createAgentInstanceId, createEventId, createMessageId, createRunId, createTaskId, parseRunId } from "../../../src/domain/ids.js";
import { reviewDevelopmentCandidate } from "../../../src/development/candidate-review.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { ActionLedger } from "../../../src/development/action-ledger.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue, type WorkItemEvidence } from "../../../src/development/work-items.js";
import { loopArtifactPath, readLoopArtifact, saveLoopArtifact } from "../../../src/execution/loop-artifact.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const base = "a".repeat(40);
const privateText = "PRIVATE-output-and-command-value";

async function fixture(body: (context: Awaited<ReturnType<typeof createFixture>>) => Promise<void>, options: {
  attempts?: number; failure?: boolean; single?: boolean; legacy?: boolean;
} = {}): Promise<void> {
  const value = await createFixture(options);
  try { await body(value); } finally { await rm(value.root, { recursive: true, force: true }); }
}

async function createFixture(options: { attempts?: number; failure?: boolean; single?: boolean; legacy?: boolean }) {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-candidate-review-"));
  const sourceRepo = path.join(root, "source");
  const candidatePath = path.join(root, "candidate");
  const stateRoot = path.join(root, "state");
  const queuePath = path.join(root, "queue.json");
  const ledgerPath = path.join(root, "actions", "actions.json");
  await mkdir(sourceRepo); await mkdir(candidatePath);
  await writeFile(path.join(sourceRepo, "value.txt"), privateText);
  const definition = { id: "change", goal: privateText, dependencies: [], allowedScope: ["value.txt"], priority: 5,
    acceptance: [{ id: "contents", command: process.execPath, args: ["-e", privateText], verifierVersion: "v1" }] };
  const store = new WorkItemStore(queuePath, { verifyEvidence: async () => true });
  await store.create(createWorkQueue({ id: "review", authorityRef: "host:test", items: [definition] }));
  const claim = (await store.claimNext({ owner: "host", baseRevision: base }))!;
  const ledger = new ActionLedger(path.dirname(ledgerPath));
  const action = await ledger.prepare({ idempotencyKey: `review:change:${claim.token}`, kind: "candidate-write",
    input: { queueId: "review", itemId: "change", claimToken: claim.token, sourceRepo, sourceRevision: base,
      owner: "host", definition } });
  const actionClaim = await ledger.claim(action.actionId, action.version);
  const verification = { command: process.execPath, args: ["/host/recipe-check.js", JSON.stringify(definition.acceptance)] };
  const criteria = [{ id: "contents", description: "Host criterion contents", observableCheck: `${process.execPath} -e ${privateText}`.slice(0, 512) }];
  const attempts = [];
  const checkIds: string[] = [];
  const total = options.single ? 1 : (options.attempts ?? 2);
  for (let number = 1; number <= total; number++) {
    const run = { ...makeRun(), id: createRunId(), rootTaskId: createTaskId() };
    const taskId = createTaskId();
    const eventStore = new EventStore(stateRoot, run.id);
    await eventStore.append(makeEvent("RUN_CREATED", { run }, { runId: run.id, id: createEventId() }));
    const request = { protocolVersion: 1, id: createMessageId(), occurredAt: run.createdAt, runId: createRunId(), taskId,
      from: createAgentInstanceId(), to: createAgentInstanceId(), type: "TASK_REQUEST", objective: privateText,
      inputArtifactIds: [], acceptanceCriteria: criteria.map((entry) => ({ id: entry.id,
        description: `${entry.description}; check: ${entry.observableCheck}` })), limits: { maxAttempts: 1, timeoutMs: 300000, maxWallTimeMs: 300000 } };
    await eventStore.append({ ...makeEvent("RUN_STARTED", {}, { runId: run.id, id: createEventId() }), type: "CHILD_MESSAGE", payload: { message: request } } as Event);
    const contract = await saveLoopArtifact({ stateRoot, runId: run.id, body: { kind: "native-write-task-contract", schemaVersion: 1,
      runId: run.id, taskId, sourceRevision: base, candidatePath, acceptanceCriteria: criteria, verification,
      definitionOnly: true, perCriterionVerification: "UNOBSERVED", objective: privateText } });
    const accepted = !options.failure && number === total;
    const checkId = createRunId().replace("run_", "check_v2_");
    checkIds.push(checkId);
    const artifact = await saveLoopArtifact({ stateRoot, runId: run.id, body: options.failure ? {
      kind: "native-write-failure", sourceRevision: base, candidatePath, verification, reason: privateText, executionEvents: 2
    } : { kind: "ps-p3-closed-loop", schemaVersion: "g1a-v1", revision: base, cwd: candidatePath, ...verification,
      check: { kind: "command-check", schemaVersion: "g1a-v1", checkId, cwd: candidatePath, revision: base,
        ...verification, ok: accepted, exitCode: accepted ? 0 : 1, processStatus: "completed", processExitCode: accepted ? 0 : 1,
        processSignal: null, stdoutText: privateText, stderrText: privateText,
        contentFingerprintBefore: { schemaVersion: "g1a-v1", headRevision: base, entries: [] },
        contentFingerprintAfter: { schemaVersion: "g1a-v1", headRevision: base, entries: [] }, snapshotManifest: {} } } });
    attempts.push({ number, runId: run.id, artifact, accepted, taskContractArtifact: contract });
  }
  const last = attempts.at(-1)!;
  const finalArtifactRef = `${last.runId}/${last.artifact.id}`;
  const loop = await saveLoopArtifact({ stateRoot, runId: last.runId, body: { kind: "native-write-loop", schemaVersion: 1,
    sourceRevision: base, candidatePath, verification, maxAttempts: total, maxWallTimeMs: 30000, attempts,
    stopReason: options.failure ? "executor-failed" : "accepted" } });
  const loopArtifactRef = `${last.runId}/${loop.id}`;
  const evidence: WorkItemEvidence[] = options.failure ? [] : [{ source: "host-command", workItemId: definition.id,
    baseRevision: base, recipeId: "contents", verifierVersion: "v1", command: process.execPath, args: ["-e", privateText],
    artifactRef: finalArtifactRef, checkId: checkIds[total - 1]!, exitCode: 0 }];
  await ledger.complete(actionClaim, { evidence: { summary: "fixture", references: [finalArtifactRef] }, result: {
    itemId: "change", claimToken: claim.token, sourceRevision: base, candidatePath, runId: last.runId,
    accepted: !options.failure, reason: privateText, evidence,
    ...(options.legacy ? {} : { finalArtifactRef, ...(options.single ? {} : { loopArtifactRef }) }) } });
  if (options.failure) await store.block("change", claim.token, "failure");
  else await store.markReady("change", claim.token, base, evidence);
  const input = { sourceRepo, queuePath, stateRoot, actionId: action.actionId };
  async function mutateReceipt(mutate: (value: Record<string, unknown>) => void) {
    const raw = JSON.parse(await readFile(ledgerPath, "utf8"));
    const record = raw.actions[0];
    const receipt = JSON.parse(record.resultCanonicalJson);
    mutate(receipt); record.resultCanonicalJson = canonicalizeStableJson(receipt);
    await writeFile(ledgerPath, canonicalizeStableJson(raw));
  }
  async function mutateArtifact(ref: string, mutate: (value: Record<string, unknown>) => void) {
    const [rawRunId, id] = ref.split("/") as [string, string];
    const runId = parseRunId(rawRunId);
    const value = await readLoopArtifact(stateRoot, runId, id) as Record<string, unknown>;
    mutate(value); await saveLoopArtifact({ stateRoot, runId, id, body: value });
  }
  return { root, input, queuePath, ledgerPath, sourceRepo, stateRoot, candidatePath, store, ledger, claim,
    actionId: action.actionId, attempts, finalArtifactRef, loopArtifactRef, mutateReceipt, mutateArtifact };
}

test("review follows explicit two-attempt references and exposes only historical bounded fields", async () => fixture(async (value) => {
  const before = await Promise.all([readFile(value.queuePath), readFile(value.ledgerPath), readFile(path.join(value.sourceRepo, "value.txt"))]);
  const result = await reviewDevelopmentCandidate(value.input);
  assert.equal(result.evidenceStatus, "available");
  assert.equal(result.historicalOnly, true); assert.equal(result.reverified, false); assert.equal(result.sourceApplied, false);
  assert.equal(result.stopReason, "accepted"); assert.equal(result.historicalAccepted, true);
  assert.deepEqual(result.criterionIds, ["contents"]);
  assert.deepEqual(result.attempts.map((attempt) => [attempt.number, attempt.accepted, attempt.check?.exitCode]), [[1, false, 1], [2, true, 0]]);
  assert.equal(result.queueRevision, (await value.store.load()).revision);
  assert.equal(result.actionVersion, (await value.ledger.get(value.actionId))!.version);
  assert.equal(JSON.stringify(result).includes(privateText), false);
  assert.deepEqual(await Promise.all([readFile(value.queuePath), readFile(value.ledgerPath), readFile(path.join(value.sourceRepo, "value.txt"))]), before);
}));

test("legacy missing receipt references stays unavailable without discovering nearby artifacts", async () => fixture(async (value) => {
  const report = await reviewDevelopmentCandidate(value.input);
  assert.equal(report.evidenceStatus, "unavailable"); assert.deepEqual(report.attempts, []);
  assert.equal(report.reverified, false);
}, { legacy: true }));

test("single-attempt explicit final reference is reviewable without a loop summary", async () => fixture(async (value) => {
  const report = await reviewDevelopmentCandidate(value.input);
  assert.equal(report.evidenceStatus, "available"); assert.equal(report.attempts.length, 1);
  assert.equal(report.loopArtifactRef, undefined);
}, { single: true }));

test("unsuccessful completed receipt reports failure history without inventing a host check", async () => fixture(async (value) => {
  const report = await reviewDevelopmentCandidate(value.input);
  assert.equal(report.evidenceStatus, "available"); assert.equal(report.historicalAccepted, false);
  assert.equal(report.stopReason, "executor-failed");
  assert.ok(report.attempts.every((attempt) => attempt.check === undefined));
  assert.equal(JSON.stringify(report).includes(privateText), false);
}, { failure: true }));

for (const stopReason of ["executor-failed", "attempt-limit", "cancelled", "time-budget"] as const) {
  test(`accepted final attempt outcome binding: ${stopReason}`, async () => fixture(async (value) => {
    await value.store.block("change", value.claim.token, "historical stopped receipt");
    await value.mutateReceipt((receipt) => { receipt.accepted = false; receipt.evidence = []; });
    await value.mutateArtifact(value.loopArtifactRef, (loop) => { loop.stopReason = stopReason; });
    if (stopReason === "cancelled" || stopReason === "time-budget") {
      const review = await reviewDevelopmentCandidate(value.input);
      assert.equal(review.historicalAccepted, false);
      assert.equal(review.attempts.at(-1)!.accepted, true);
      assert.equal(review.stopReason, stopReason);
    } else await assert.rejects(reviewDevelopmentCandidate(value.input), /outcome|acceptance|review/);
  }));
}

test("a released task claim cannot review an old receipt as the current task", async () => fixture(async (value) => {
  await value.store.release("change", value.claim.token);
  await assert.rejects(reviewDevelopmentCandidate(value.input), /claim|binding/);
}));

test("changed task definitions are refused even with unchanged item and action IDs", async () => fixture(async (value) => {
  const queue = await value.store.load();
  await writeFile(value.queuePath, JSON.stringify({ ...queue, items: queue.items.map((entry) => ({ ...entry,
    definition: { ...entry.definition, goal: "different" } })) }));
  await assert.rejects(reviewDevelopmentCandidate(value.input), /definition|binding/);
}));

for (const mismatch of ["candidate", "base", "check", "criteria", "last-ref", "attempt-bound", "shadow-ref", "artifact-size"] as const) {
  test(`review refuses declared evidence mismatch: ${mismatch}`, async () => fixture(async (value) => {
    if (mismatch === "candidate" || mismatch === "base") await value.mutateArtifact(value.loopArtifactRef,
      (body) => { body[mismatch === "candidate" ? "candidatePath" : "sourceRevision"] = "wrong"; });
    if (mismatch === "check") await value.mutateArtifact(value.finalArtifactRef,
      (body) => { (body.check as Record<string, unknown>).checkId = "different"; });
    if (mismatch === "criteria") await value.mutateArtifact(`${value.attempts[0]!.runId}/${value.attempts[0]!.taskContractArtifact.id}`,
      (body) => { body.acceptanceCriteria = []; });
    if (mismatch === "last-ref") await value.mutateReceipt((receipt) => { receipt.finalArtifactRef = `${value.attempts[0]!.runId}/${value.attempts[0]!.artifact.id}`; });
    if (mismatch === "attempt-bound") await value.mutateArtifact(value.loopArtifactRef,
      (body) => { body.attempts = Array(6).fill(value.attempts[0]); });
    if (mismatch === "shadow-ref") await value.mutateArtifact(value.loopArtifactRef, (body) => {
      const first = (body.attempts as Record<string, unknown>[])[0]!;
      first.artifactRef = `${value.attempts[0]!.runId}/${value.attempts[0]!.artifact.id}`;
      (first.artifact as Record<string, unknown>).id = "art_v2_00000000-0000-0000-0000-000000000000";
    });
    if (mismatch === "artifact-size") await value.mutateArtifact(value.loopArtifactRef, (body) => {
      const first = (body.attempts as Record<string, unknown>[])[0]!;
      const artifact = first.artifact as Record<string, unknown>;
      artifact.byteLength = (artifact.byteLength as number) + 1;
    });
    await assert.rejects(reviewDevelopmentCandidate(value.input), /review/);
  }));
}

test("a missing explicit artifact refuses review instead of falling back to unavailable", async () => fixture(async (value) => {
  const last = value.attempts.at(-1)!;
  await rm(loopArtifactPath(value.stateRoot, last.runId, last.artifact.id));
  await assert.rejects(reviewDevelopmentCandidate(value.input), /missing|artifact|review/);
}));

test("oversized explicit artifact is refused before parsing", async () => fixture(async (value) => {
  const last = value.attempts.at(-1)!;
  await writeFile(loopArtifactPath(value.stateRoot, last.runId, last.artifact.id), "x".repeat(1_048_577));
  await assert.rejects(reviewDevelopmentCandidate(value.input), /limit|bound|artifact|review/);
}));

test("queue version change while reading evidence refuses a mixed historical report", async () => fixture(async (value) => {
  const original = WorkItemStore.prototype.load;
  let calls = 0;
  WorkItemStore.prototype.load = async function () {
    const queue = await original.call(this);
    return ++calls === 1 ? queue : { ...queue, revision: queue.revision + 1 };
  };
  try { await assert.rejects(reviewDevelopmentCandidate(value.input), /changed|version|stale/); }
  finally { WorkItemStore.prototype.load = original; }
}));

test("action version change while reading evidence refuses a mixed historical report", async () => fixture(async (value) => {
  const original = ActionLedger.prototype.get;
  let calls = 0;
  ActionLedger.prototype.get = async function (id) {
    const record = await original.call(this, id);
    return ++calls === 1 || record === undefined ? record : { ...record, version: record.version + 1 };
  };
  try { await assert.rejects(reviewDevelopmentCandidate(value.input), /changed|version|stale/); }
  finally { ActionLedger.prototype.get = original; }
}));

test("real two-attempt candidate remains historical after later content changes, without rerunning the checker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "candidate-review-real-"));
  try {
    const sourceRepo = path.join(root, "source"); await mkdir(sourceRepo);
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: sourceRepo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    git("init"); git("config", "user.name", "Review fixture"); git("config", "user.email", "fixture@example.invalid");
    await writeFile(path.join(sourceRepo, "value.txt"), "before");
    git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    const queuePath = path.join(root, "queue.json"); const stateRoot = path.join(root, "state");
    const marker = path.join(root, "host-check-count");
    await new WorkItemStore(queuePath).create(createWorkQueue({ id: "actual", authorityRef: "host:test", items: [{
      id: "change", goal: "Set value.txt to after", dependencies: [], allowedScope: ["value.txt"], priority: 1,
      acceptance: [{ id: "contents", command: process.execPath, verifierVersion: "v1", args: ["-e",
        `require('node:fs').appendFileSync(${JSON.stringify(marker)},'x');if(require('node:fs').readFileSync('value.txt','utf8')!=='after')process.exit(1)`, ""] }]
    }] }));
    let calls = 0;
    const controller = new DevelopmentController({ sourceRepo, queuePath, stateRoot, owner: "host", executorFactory: ({ tools }) => ({
      async *execute(request, signal) {
        calls++;
        await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write",
          { path: "value.txt", contents: calls === 1 ? "wrong" : "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      }
    }) });
    const result = await controller.runNext({ maxAttempts: 2, maxWallTimeMs: 30000 });
    assert.equal(result.status, "ready-for-review"); assert.ok(result.actionId); assert.ok(result.candidatePath);
    await writeFile(path.join(result.candidatePath, "value.txt"), "later mutation");
    const paths = [queuePath, path.join(root, "actions", "actions.json"), marker, path.join(sourceRepo, "value.txt")];
    const before = await Promise.all(paths.map((file) => readFile(file)));
    const review = await reviewDevelopmentCandidate({ sourceRepo, queuePath, stateRoot, actionId: result.actionId });
    assert.equal(review.evidenceStatus, "available"); assert.equal(review.reverified, false); assert.equal(review.historicalAccepted, true);
    assert.deepEqual(review.attempts.map((attempt) => attempt.check?.exitCode), [1, 0]);
    assert.equal(calls, 2); assert.equal(git("status", "--porcelain"), "");
    assert.deepEqual(await Promise.all(paths.map((file) => readFile(file))), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
