import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { NativeWriteSession, type NativeWriteSessionResult } from "../../../src/native/write-session.js";
import { applyIssuedCandidate, disposeIssuedCandidate, issueApplyRegistration, type ApplyIssuedCandidateInput, type IssueApplyRegistrationInput } from "../../../src/native/apply-registration.js";
import { loopArtifactsDir, readLoopArtifact } from "../../../src/execution/loop-artifact.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
interface Fixture { root: string; sourceRepo: string; stateRoot: string; result: NativeWriteSessionResult; }
async function fixture(body: (value: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-registration-inputs-"));
  const sourceRepo = join(root, "source"), stateRoot = join(root, "state");
  await mkdir(sourceRepo);
  git(sourceRepo, ["init"]); git(sourceRepo, ["config", "user.name", "Registration input test"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(sourceRepo, "value.txt"), "before");
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const session = new NativeWriteSession({ stateRoot, sandboxRoot: join(root, "sandbox"), executorFactory: ({ tools }) => ({
    async *execute(request, signal) {
      await tools.find((tool) => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: "after" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    }
  }) });
  try {
    const result = await session.execute({ sourceRepo, objective: "Set value.txt to after", maxAttempts: 1,
      acceptanceCriteria: [{ id: "value", description: "Expected value", observableCheck: "host command" }],
      verification: { command: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='after')process.exit(1)"] } });
    assert.equal(result.acceptance.accepted, true, result.reason);
    await body({ root, sourceRepo, stateRoot, result });
  } finally { await session.shutdown(); await rm(root, { recursive: true, force: true }); }
}

test("registration synchronously snapshots command, argv and all issued result/source bindings", async () => fixture(async (value) => {
  const result = structuredClone(value.result);
  const original = structuredClone(result);
  const input = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result };
  const pending = issueApplyRegistration(input);
  Object.assign(result, { runId: "run_changed", candidatePath: join(value.root, "other-candidate"), sourceRevision: "f".repeat(40) });
  Object.assign(result.acceptance.args, { 0: "changed-argv" });
  Object.assign(result.acceptance, { command: "changed-command", cwd: "changed-cwd" });
  Object.assign(result.artifact, { path: "changed-artifact" });
  Object.assign(result.taskContract!.acceptanceCriteria[0]!, { description: "changed-criterion" });
  input.stateRoot = join(value.root, "other-state"); input.sourceRepo = join(value.root, "other-source");
  input.result = { ...original, runId: "run_replaced" as NativeWriteSessionResult["runId"] };
  const issued = await pending;
  assert.equal(issued.runId, original.runId);
  assert.equal(issued.candidatePath, original.candidatePath);
  assert.equal(issued.sourceRepo, value.sourceRepo);
  assert.equal(issued.sourceRevision, original.sourceRevision);
  const stored = await readLoopArtifact(value.stateRoot, original.runId, issued.artifactId) as { result: NativeWriteSessionResult; sourceRepo: string };
  assert.deepEqual(stored.result, original);
  assert.equal(stored.sourceRepo, value.sourceRepo);
}));

test("apply uses the synchronously captured handle after asynchronous artifact reads", async () => fixture(async (value) => {
  const issued = await issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result });
  const input = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, runId: issued.runId,
    artifactId: issued.artifactId, candidatePath: issued.candidatePath };
  const pending = applyIssuedCandidate(input);
  Object.assign(input, { stateRoot: join(value.root, "other-state"), sourceRepo: join(value.root, "other-source"),
    runId: "run_changed", artifactId: "art_v2_00000000-0000-0000-0000-000000000000", candidatePath: join(value.root, "other-candidate") });
  const applied = await pending;
  assert.equal(applied.status, "APPLIED");
  assert.equal(await readFile(join(value.sourceRepo, "value.txt"), "utf8"), "after");
  await stat(issued.candidatePath);
}));

test("disposal uses the synchronously captured handle and receipt destination", async () => fixture(async (value) => {
  const issued = await issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result });
  const input = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, runId: issued.runId,
    artifactId: issued.artifactId, candidatePath: issued.candidatePath };
  await applyIssuedCandidate(input);
  const pending = disposeIssuedCandidate(input);
  Object.assign(input, { stateRoot: join(value.root, "other-state"), sourceRepo: join(value.root, "other-source"),
    runId: "run_changed", artifactId: "art_v2_00000000-0000-0000-0000-000000000000", candidatePath: join(value.root, "other-candidate") });
  assert.deepEqual(await pending, { status: "DISPOSED", candidatePath: issued.candidatePath });
  await assert.rejects(stat(issued.candidatePath), { code: "ENOENT" });
  assert.deepEqual(await disposeIssuedCandidate({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo,
    runId: issued.runId, artifactId: issued.artifactId, candidatePath: issued.candidatePath }), { status: "DISPOSED", candidatePath: issued.candidatePath });
}));

test("registration refuses input and nested accessors without invoking them or writing artifacts", async () => fixture(async (value) => {
  const before = await readdir(loopArtifactsDir(value.stateRoot, value.result.runId));
  let reads = 0;
  const withInputAccessor = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo,
    get result() { reads++; return value.result; } };
  await assert.rejects(issueApplyRegistration(withInputAccessor), /accessor|ordinary|plain/);
  const result = structuredClone(value.result);
  Object.defineProperty(result.acceptance, "command", { enumerable: true, get() { reads++; return process.execPath; } });
  await assert.rejects(issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result }), /accessor|ordinary|plain/);
  assert.equal(reads, 0);
  assert.deepEqual(await readdir(loopArtifactsDir(value.stateRoot, value.result.runId)), before);
}));

test("registration refuses unsupported input fields and inherited result data", async () => fixture(async (value) => {
  const before = await readdir(loopArtifactsDir(value.stateRoot, value.result.runId));
  await assert.rejects(issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result,
    trustedVerification: {} } as IssueApplyRegistrationInput), /unsupported|unknown/);
  await assert.rejects(issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo,
    result: Object.create(value.result) as NativeWriteSessionResult }), /plain|inherited|prototype/);
  assert.deepEqual(await readdir(loopArtifactsDir(value.stateRoot, value.result.runId)), before);
}));

test("apply and disposal refuse accessor/inherited handles before reading artifacts", async () => fixture(async (value) => {
  const issued = await issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result });
  const handle = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, runId: issued.runId,
    artifactId: issued.artifactId, candidatePath: issued.candidatePath };
  let reads = 0;
  const accessor = { ...handle, get candidatePath() { reads++; return issued.candidatePath; } };
  await assert.rejects(applyIssuedCandidate(accessor), /accessor|ordinary|plain/);
  await assert.rejects(disposeIssuedCandidate(Object.create(handle)), /plain|inherited|prototype/);
  assert.equal(reads, 0);
  assert.equal(await readFile(join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));

test("apply preserves the original AbortSignal when callers replace its input field", async () => fixture(async (value) => {
  const issued = await issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result });
  const original = new AbortController();
  const input: ApplyIssuedCandidateInput = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo,
    runId: issued.runId, artifactId: issued.artifactId, candidatePath: issued.candidatePath, signal: original.signal };
  const pending = applyIssuedCandidate(input);
  Object.assign(input, { signal: new AbortController().signal });
  original.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(await readFile(join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));

test("optional undefined data keeps omission semantics and ordinary extra metadata is copied safely", async () => fixture(async (value) => {
  const result = structuredClone(value.result);
  const metadata = { note: "original" };
  Object.assign(result, { loop: undefined, taskContract: undefined, metadata });
  Object.assign(result.acceptance, { selfReport: undefined });
  // JavaScript callers may explicitly pass an absent optional field.
  const pending = issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result, signal: undefined } as unknown as IssueApplyRegistrationInput);
  metadata.note = "changed";
  const issued = await pending;
  const stored = await readLoopArtifact(value.stateRoot, value.result.runId, issued.artifactId) as { result: Record<string, unknown> };
  assert.equal(Object.hasOwn(stored.result, "loop"), false);
  assert.equal(Object.hasOwn(stored.result, "taskContract"), false);
  assert.deepEqual(stored.result.metadata, { note: "original" });
}));

test("registration refuses serialized signal authority and apply/disposal reject unknown handle fields", async () => fixture(async (value) => {
  await assert.rejects(issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo,
    result: value.result, signal: { aborted: false } } as IssueApplyRegistrationInput), /AbortSignal/);
  const issued = await issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result });
  const handle = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, runId: issued.runId,
    artifactId: issued.artifactId, candidatePath: issued.candidatePath, trustedVerification: {} };
  await assert.rejects(applyIssuedCandidate(handle), /unsupported|unknown/);
  await assert.rejects(disposeIssuedCandidate(handle), /unsupported|unknown/);
  assert.equal(await readFile(join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));

test("relative candidate paths are refused before asynchronous registration or handle lookup", async () => fixture(async (value) => {
  const candidatePath = relative(process.cwd(), value.result.candidatePath);
  const before = await readdir(loopArtifactsDir(value.stateRoot, value.result.runId));
  await assert.rejects(issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo,
    result: { ...value.result, candidatePath } }), /absolute/);
  assert.deepEqual(await readdir(loopArtifactsDir(value.stateRoot, value.result.runId)), before);
  const issued = await issueApplyRegistration({ stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, result: value.result });
  const handle = { stateRoot: value.stateRoot, sourceRepo: value.sourceRepo, runId: issued.runId,
    artifactId: issued.artifactId, candidatePath };
  await assert.rejects(applyIssuedCandidate(handle), /absolute/);
  await assert.rejects(disposeIssuedCandidate(handle), /absolute/);
  assert.equal(await readFile(join(value.sourceRepo, "value.txt"), "utf8"), "before");
}));
