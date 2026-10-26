import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { promoteWithRegistry } from "../../../src/lab/adaptation/promotion.js";
import { rollbackActive } from "../../../src/lab/adaptation/rollback.js";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { prepareDevelopmentCheckPlan } from "../../../src/development/check-plan.js";
import { TaskSpecSession } from "../../../src/development/task-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { runtimeRoot } from "../../../src/persist/state-layout.js";

async function adapters() {
  const resource = await import("../../../src/lab/adaptation/task-resources.js").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  });
  const evaluation = await import("../../../src/lab/adaptation/eval-real-tasks.js").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  });
  assert.equal(typeof resource?.materializeTaskResources, "function", "approved resource content must reach an actual TaskSpec");
  assert.equal(typeof evaluation?.evaluateRealTaskResources, "function", "evaluation must bind real task artifacts");
  return { ...resource!, ...evaluation! };
}
const projectRoot = "/synthetic/project", sourceRevision = "a".repeat(40);
const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Update a synthetic file", context: [], write: { allow: ["value.txt"], protect: ["checks"], require: ["value.txt"] }, prepare: [], checks: [{ id: "unit", command: "node", args: ["checks/unit.mjs"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "pass" } }], worker: { model: "inherit", maxAttempts: 1 }, budget: { totalSeconds: 60, prepareSeconds: 10, workerSeconds: 20, checkSeconds: 20, usd: 1 } });

async function setup(topic: "host-only-checks" | "input-validation" | "node-preparation" = "host-only-checks", selectedProjectRoot = projectRoot) {
  const api = await adapters(), registry = new ResourceRegistry();
  const identity = api.taskResourceIdentity(selectedProjectRoot, topic);
  const content = (guidance: string) => JSON.stringify({ topic, guidance, sourceRefs: ["private/source.json"], expectedEffect: "Host verification remains independent" });
  const parent = registry.registerBaseline({ identity, content: content("Existing generic guidance"), author: { kind: "human", identity: "owner" } });
  const candidate = registry.createCandidate({ identity, content: content("File-only workers leave host-only checks UNOBSERVED."), parentVersionId: parent.versionId, author: { kind: "detector", identity: "real-task-review" }, evaluationPlan: { stages: ["static", "real-task"], metrics: ["host-check-reached"], planVersion: 1 } });
  const selectedSpec = topic === "node-preparation" ? snapshotDevelopmentTaskSpec({ ...spec, prepare: [{ id: "install", command: "node", args: ["private/fixed-prepare.mjs"] }] }) : spec;
  const materialize = (logicalTaskId: string) => api.materializeTaskResources({ registry, projectRoot: selectedProjectRoot, logicalTaskId, sourceRevision, spec: selectedSpec, topics: [topic],
    ...(topic !== "node-preparation" ? {} : { preparationBinding: { recipeId: "install", command: "node", args: ["private/fixed-prepare.mjs"], authorityRef: "private/owner-decision", candidateOnly: true as const } }) });
  const promote = () => promoteWithRegistry(registry, { candidateId: candidate.candidateId, expectedCurrentVersionId: parent.versionId, content: content("File-only workers leave host-only checks UNOBSERVED."), approvedBy: { kind: "human", identity: "owner" }, explicitApproval: true, review: { reviewId: "review-one", candidateId: candidate.candidateId, contentHash: candidate.contentHash, verdict: "approved", reviewerKind: "independent", reviewerId: "peer", actorId: candidate.author.identity, evidenceRefs: ["private/source.json"] }, changeNote: { scope: "host-only-checks", evidence: ["private/source.json"], guardrails: ["no command authority"], rollbackVersionId: parent.versionId } });
  return { api, registry, identity, parent, candidate, materialize, promote };
}

test("materialization consumes only active content, keeps TaskSpec authority, and follows CAS promotion and rollback", async () => {
  const f = await setup();
  const before = f.materialize("before");
  assert.ok(before.spec.objective.includes("Existing generic guidance"));
  assert.ok(!before.spec.objective.includes("File-only workers"));
  assert.deepEqual({ ...before.spec, objective: spec.objective }, spec);
  f.promote();
  const after = f.materialize("after");
  assert.ok(after.spec.objective.includes("File-only workers"));
  assert.equal(after.resources[0]!.versionId, f.registry.getActiveVersion(f.identity)?.versionId);
  assert.equal(before.resources[0]!.versionId, f.parent.versionId, "in-flight materializations do not refresh themselves");
  rollbackActive(f.registry, { identity: f.identity, expectedCurrentVersionId: after.resources[0]!.versionId, targetVersionId: f.parent.versionId, reason: "user", automatic: false, evidence: ["private/review.json"] });
  assert.ok(f.materialize("rolled-back").spec.objective.includes("Existing generic guidance"));
});

test("materialization refuses absent or malformed content and unsupported resource selection", async () => {
  const { materializeTaskResources } = await adapters();
  assert.throws(() => materializeTaskResources({ registry: new ResourceRegistry(), projectRoot, logicalTaskId: "one", sourceRevision, spec, topics: ["node-preparation"] }), /active/);
  const f = await setup();
  assert.throws(() => materializeTaskResources({ registry: f.registry, projectRoot, logicalTaskId: "one", sourceRevision, spec, topics: ["permission"] as never }), /topic/);
});

test("an explicitly owner-created empty-guidance baseline materializes the exact original TaskSpec", async () => {
  const api = await adapters(), registry = new ResourceRegistry(), identity = api.taskResourceIdentity(projectRoot, "host-only-checks");
  registry.registerBaseline({ identity, content: JSON.stringify({ topic: "host-only-checks", guidance: "", sourceRefs: ["owner/original-behavior"], expectedEffect: "No additional guidance" }), author: { kind: "human", identity: "owner" } });
  const materialized = api.materializeTaskResources({ registry, projectRoot, logicalTaskId: "original", sourceRevision, spec, topics: ["host-only-checks"] });
  assert.deepEqual(materialized.spec, spec, "no marker or fake generic instruction changes the no-op baseline");
  assert.equal(materialized.resources.length, 1);
});

for (const topic of ["host-only-checks", "input-validation", "node-preparation"] as const) test(`${topic} evaluation binds actual task evidence, retains failures and unknowns, and refuses unjustified conclusions`, async () => {
  const f = await setup(topic), root = await mkdtemp(path.join(tmpdir(), "resource-trials-"));
  try {
    const trials: Array<{ recordFile: string; inputFile: string; contractFile: string; eventsFile: string; checkFile?: string }> = [];
    const save = async (name: string, value: unknown) => { const file = path.join(root, name); await writeFile(file, JSON.stringify(value), "utf8"); return file; };
    const add = async (logical: string, materialized: ReturnType<typeof f.materialize>, failed: boolean) => {
      const runId = `run_${logical}`, candidatePath = path.join(root, logical);
      const verification = { ...prepareDevelopmentCheckPlan({ scopePolicy: { allowedScope: materialized.baseSpec.write.allow, protectedPaths: materialized.baseSpec.write.protect }, checks: materialized.baseSpec.checks.map(({ expect: _expect, ...check }) => check) }).verification,
        timeoutMs: Math.round(materialized.baseSpec.budget.checkSeconds * 1000) };
      trials.push({ inputFile: await save(`${logical}-input.json`, materialized),
        recordFile: await save(`${logical}-record.json`, { id: logical, comparisonId: logical, date: "2026-10-26", source: "pi-sparkle", arm: "sparkle", model: "synthetic", thinking: "high", runId, sourceRevision, status: failed ? "FAILED" : "COMPLETED", accepted: !failed, effectsSettled: true, reviewed: true, kept: !failed, escapedDefects: 0, referenceUsd: "unknown", cost: { knownLowerBoundUsd: 0.01 } }),
        eventsFile: await save(`${logical}-events.jsonl`, { type: "RUN_CREATED", runId, occurredAt: new Date(Date.now() + 1000).toISOString(), payload: { run: { id: runId } } }),
        contractFile: await save(`${logical}-contract.json`, { schemaVersion: "loop-artifact-v2", id: `art_v2_${randomUUID()}`, runId, body: { kind: "native-write-task-contract", schemaVersion: 1, runId, taskId: `tsk_${logical}`, sourceRevision, candidatePath, objective: materialized.spec.objective, verification } }),
        checkFile: await save(`${logical}-check.json`, { schemaVersion: "loop-artifact-v2", id: `art_v2_${randomUUID()}`, runId, body: { kind: "ps-p3-closed-loop", revision: sourceRevision, cwd: candidatePath, command: verification.command, args: verification.args, check: { kind: "command-check", cwd: candidatePath, command: verification.command, args: verification.args, processStatus: "completed", processExitCode: failed ? 1 : 0, processSignal: null, exitCode: failed ? 1 : 0, trustedVerification: { schemaVersion: "exact-verification-v1", descriptorId: verification.trustedVerification!.id, ok: true } } } }) });
    };
    await add("baseline", f.materialize("baseline"), true);
    f.promote();
    const versionId = f.registry.getActiveVersion(f.identity)!.versionId;
    for (let i = 0; i < 4; i++) await add(`candidate${i}`, f.materialize(`candidate${i}`), i === 0);
    const evaluate = () => f.api.evaluateRealTaskResources({ registry: f.registry, identity: f.identity, versionId, trials });
    let result = await evaluate();
    assert.equal(result.conclusion, "unclear");
    assert.equal(result.candidateTasks, topic === "node-preparation" ? 0 : 4);
    await add("candidate4", f.materialize("candidate4"), false);
    result = await evaluate();
    assert.equal(result.candidateTasks, topic === "node-preparation" ? 0 : 5); assert.equal(result.attempts.length, 6);
    if (topic === "node-preparation") {
      assert.equal(result.conclusion, "unclear");
      assert.ok(result.attempts.every(attempt => attempt.issues.some(issue => issue.includes("command/argv"))));
      assert.ok(result.evaluations.every(record => record.overall === "UNOBSERVED"));
    } else assert.equal(result.conclusion, "better", "only a bound descriptive delivery-rate comparison is claimed");
    assert.equal(result.cost.totalUsd, "unknown"); assert.ok(Math.abs(result.cost.knownLowerBoundUsd - 0.06) < 1e-12);
    assert.ok(result.attempts.some(attempt => attempt.status === "FAILED"));
    assert.ok(result.evaluations.every(record => record.dependencyVersions?.resource === versionId || record.dependencyVersions?.resource === f.parent.versionId));
    trials.push(trials[1]!);
    await assert.rejects(evaluate(), /duplicate/); trials.pop();
    const repeatedRun = JSON.parse(await readFile(trials[0]!.recordFile, "utf8")); repeatedRun.id = "renamed-baseline-attempt";
    trials.push({ ...trials[0]!, recordFile: await save("renamed-baseline-record.json", repeatedRun) });
    await assert.rejects(evaluate(), /duplicate actual run/, "renaming an operator record cannot repeat a real run's cost or delivery result"); trials.pop();
    repeatedRun.source = ["pi-sparkle"];
    trials.push({ ...trials[0]!, recordFile: await save("array-source-record.json", repeatedRun) });
    await assert.rejects(evaluate(), /invalid native real-task record identity/, "source aliases cannot bypass actual-run identity"); trials.pop();
    const retryOf = trials[1]!, retryRecord = JSON.parse(await readFile(retryOf.recordFile, "utf8")), retryContract = JSON.parse(await readFile(retryOf.contractFile, "utf8")), retryCheck = JSON.parse(await readFile(retryOf.checkFile!, "utf8")), retryEvent = JSON.parse(await readFile(retryOf.eventsFile, "utf8"));
    retryRecord.id = "genuine-retry"; retryRecord.runId += "-retry";
    retryContract.runId = retryRecord.runId; retryContract.body.runId = retryRecord.runId; retryContract.id = `art_v2_${randomUUID()}`;
    retryCheck.runId = retryRecord.runId; retryCheck.id = `art_v2_${randomUUID()}`;
    retryEvent.runId = retryRecord.runId; retryEvent.payload.run.id = retryRecord.runId;
    trials.push({ ...retryOf, recordFile: await save("retry-record.json", retryRecord), contractFile: await save("retry-contract.json", retryContract), checkFile: await save("retry-check.json", retryCheck), eventsFile: await save("retry-events.jsonl", retryEvent) });
    const withRetry = await evaluate(); assert.equal(withRetry.attempts.length, 7); assert.equal(withRetry.candidateTasks, topic === "node-preparation" ? 0 : 5);
    assert.ok(Math.abs(withRetry.cost.knownLowerBoundUsd - 0.07) < 1e-12, "a different real run retains its own cost without inventing a new logical task"); trials.pop();
    if (topic !== "node-preparation") {
      const trial = trials[2]!, originalInput = await readFile(trial.inputFile, "utf8"), originalRecord = await readFile(trial.recordFile, "utf8"), originalCheck = await readFile(trial.checkFile!, "utf8");
      const changedInput = JSON.parse(originalInput);
      changedInput.baseSpec.checks[0].args = ["checks/different.mjs"];
      changedInput.spec.checks[0].args = ["checks/different.mjs"];
      await writeFile(trial.inputFile, JSON.stringify(changedInput), "utf8");
      let rejected = await evaluate();
      assert.equal(rejected.candidateTasks, 4, "claimed check changes cannot masquerade as actual checker consumption");
      assert.ok(rejected.attempts[2]!.issues.some(issue => /verifier|checker/.test(issue)));
      await writeFile(trial.inputFile, originalInput, "utf8");
      const changedRecord = JSON.parse(originalRecord); changedRecord.comparisonId = "same-task-retry";
      await writeFile(trial.recordFile, JSON.stringify(changedRecord), "utf8");
      rejected = await evaluate(); assert.equal(rejected.candidateTasks, 4, "a relabeled retry is not a distinct registered task");
      await writeFile(trial.recordFile, originalRecord, "utf8");
      const changedCheck = JSON.parse(originalCheck); changedCheck.body.check.exitCode = 1; changedCheck.body.check.processExitCode = 1;
      await writeFile(trial.checkFile!, JSON.stringify(changedCheck), "utf8");
      rejected = await evaluate(); assert.equal(rejected.attempts[2]!.correctDelivery, false, "a bound failed host check outranks accepted metadata");
      await writeFile(trial.checkFile!, originalCheck, "utf8");
      const savedFile = trial.checkFile; delete trial.checkFile;
      rejected = await evaluate(); assert.equal(rejected.attempts[2]!.correctDelivery, "unknown", "missing check evidence cannot attest positive delivery");
      trial.checkFile = savedFile!;
    }
    const stored = JSON.parse(await readFile(trials[1]!.contractFile, "utf8"));
    stored.body.objective = "Different actual input";
    await writeFile(trials[1]!.contractFile, JSON.stringify(stored), "utf8");
    result = await evaluate();
    assert.equal(result.conclusion, "unclear"); assert.equal(result.candidateTasks, topic === "node-preparation" ? 0 : 4);
    assert.equal(result.attempts.length, 6, "unverified attempts stay visible rather than disappearing");
    assert.ok(result.attempts.some(attempt => attempt.issues.some(issue => issue.includes("objective"))));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Node workflow requires an existing host-selected prepare binding and leaves guidance with the host", async () => {
  const api = await adapters(), registry = new ResourceRegistry();
  const identity = api.taskResourceIdentity(projectRoot, "node-preparation");
  const content = JSON.stringify({ topic: "node-preparation", guidance: "Host-only candidate preparation selection", sourceRefs: ["private/source.json"], expectedEffect: "Fewer preparation failures" });
  registry.registerBaseline({ identity, content, author: { kind: "human", identity: "owner" } });
  assert.throws(() => api.materializeTaskResources({ registry, projectRoot, logicalTaskId: "node", sourceRevision, spec, topics: ["node-preparation"] }), /preparation binding/);
  const prepared = snapshotDevelopmentTaskSpec({ ...spec, prepare: [{ id: "install", command: "node", args: ["private/fixed-prepare.mjs"] }] });
  const binding = { recipeId: "install", command: "node", args: ["private/fixed-prepare.mjs"], authorityRef: "private/owner-decision", candidateOnly: true as const };
  const materialized = api.materializeTaskResources({ registry, projectRoot, logicalTaskId: "node", sourceRevision, spec: prepared, topics: ["node-preparation"], preparationBinding: binding });
  assert.deepEqual(materialized.spec.prepare, prepared.prepare);
  assert.deepEqual(materialized.hostGuidance, ["Host-only candidate preparation selection"]);
  assert.ok(!materialized.spec.objective.includes("Host-only candidate preparation selection"));
  assert.throws(() => api.materializeTaskResources({ registry, projectRoot, logicalTaskId: "node", sourceRevision, spec: prepared, topics: ["node-preparation"], preparationBinding: { ...binding, args: ["different.mjs"] } }), /preparation binding/);
});

test("materialized prompt is consumed by a real TaskSpecSession and its actual host artifacts feed evaluation", { timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "resource-task-session-")), repo = path.join(root, "source"), stateRoot = path.join(root, "state");
  const session = new TaskSpecSession({ stateRoot, sandboxRoot: path.join(root, "candidates") });
  const git = (args: string[]) => { const result = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  try {
    await mkdir(path.join(repo, "checks"), { recursive: true });
    await writeFile(path.join(repo, "value.txt"), "before", "utf8");
    await writeFile(path.join(repo, "checks/unit.mjs"), "import {readFileSync} from 'node:fs'; if (!['before','after'].includes(readFileSync('value.txt','utf8'))) process.exit(1);", "utf8");
    git(["init", "-b", "fixture"]); git(["config", "core.autocrlf", "false"]);
    git(["config", "user.name", "Resource fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
    git(["add", "."]); git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const revision = git(["rev-parse", "HEAD"]), f = await setup("host-only-checks", repo); f.promote();
    const materialized = f.api.materializeTaskResources({ registry: f.registry, projectRoot: repo, logicalTaskId: "actual-task", sourceRevision: revision,
      spec: snapshotDevelopmentTaskSpec({ ...spec, checks: [{ ...spec.checks[0]!, command: process.execPath }], budget: { totalSeconds: 45, prepareSeconds: 5, workerSeconds: 10, checkSeconds: 15 } }), topics: ["host-only-checks"] });
    const run = await session.run({ sourceRepo: repo, spec: materialized.spec, executorFactory: context => ({ async *execute(request, signal) {
      await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }) });
    assert.equal(run.accepted, true); assert.equal(run.effectsSettled, true);
    const directory = path.dirname(run.artifactPath), artifacts = await Promise.all((await readdir(directory)).filter(file => file.endsWith(".json")).map(async file => ({ file: path.join(directory, file), value: JSON.parse(await readFile(path.join(directory, file), "utf8")) })));
    const contract = artifacts.find(entry => entry.value.body.kind === "native-write-task-contract"), checked = artifacts.find(entry => entry.value.body.kind === "ps-p3-closed-loop");
    assert.ok(contract); assert.ok(checked);
    const inputFile = path.join(root, "input.json"), recordFile = path.join(root, "record.json");
    await writeFile(inputFile, JSON.stringify(materialized), "utf8");
    await writeFile(recordFile, JSON.stringify({ id: "actual-attempt", comparisonId: "actual-task", source: "pi-sparkle", arm: "sparkle", model: "controlled", thinking: "none", runId: run.runId,
      sourceRevision: revision, status: run.status, accepted: run.accepted, effectsSettled: run.effectsSettled, reviewed: true, kept: true, escapedDefects: 0, referenceUsd: "unknown" }), "utf8");
    const result = await f.api.evaluateRealTaskResources({ registry: f.registry, identity: f.identity, versionId: f.registry.getActiveVersion(f.identity)!.versionId,
      trials: [{ recordFile, inputFile, contractFile: contract.file, checkFile: checked.file, eventsFile: path.join(runtimeRoot(stateRoot), "runs", run.runId, "events.jsonl") }] });
    assert.equal(result.attempts[0]!.consumed, true, result.attempts[0]!.issues.join("; "));
    assert.equal(result.attempts[0]!.correctDelivery, true); assert.equal(result.conclusion, "unclear", "one controlled task is not a real-task benefit conclusion");
    assert.equal(await readFile(path.join(repo, "value.txt"), "utf8"), "before");
  } finally { await session.shutdown(); await rm(root, { recursive: true, force: true }); }
});
