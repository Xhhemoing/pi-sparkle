import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ReadonlyConversationSession, saveConversationReferences, deleteConversationReferences, type ConversationRecoveryOptions } from "../../../src/conversation/recovery.js";
import { ConversationSession } from "../../../src/conversation/session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { ConversationFocus } from "../../../src/conversation/focus.js";
import { DevelopmentController } from "../../../src/development/controller.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { runDirectoryPath, runEventsPath, loopArtifactPath } from "../../../src/execution/loop-artifact.js";
import { parseRunId } from "../../../src/domain/ids.js";

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture(body: (root: string) => Promise<void>) {
  const parent = path.join(process.cwd(), ".agent_workspace/conversation-recovery-20261020");
  await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, "fixture-"));
  try {
    const source = path.join(root, "source"); await mkdir(source); await mkdir(path.join(root, "candidates"));
    git(source, ["init"]); git(source, ["config", "user.name", "Recovery fixture"]); git(source, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(path.join(source, "value.txt"), "before", "utf8"); git(source, ["add", "."]); git(source, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    await body(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
function child(mode: string, root: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "test/fixtures/conversation/restart.ts", mode, root], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 90_000
  });
}
test("a second process loads actual recovery tools and fresh direct facts without replay", async () => fixture(async (root) => {
  const first = child("produce", root); assert.equal(first.status, 0, first.stdout + first.stderr);
  const receipt = JSON.parse(await readFile(path.join(root, "receipt.json"), "utf8"));
  const second = child("recover", root); assert.equal(second.status, 0, second.stdout + second.stderr);
  const recovered = JSON.parse(await readFile(path.join(root, "recovered.json"), "utf8"));
  assert.notEqual(recovered.focus.token.generation, receipt.generation);
  assert.equal(await readFile(path.join(root, "source/value.txt"), "utf8"), "before");
  assert.equal(await readFile(path.join(receipt.candidatePath, "value.txt"), "utf8"), "after");
  assert.equal(JSON.stringify(recovered.status).includes(root), false);
}));

const main = { projectRef: "project", taskRef: "arbitrary-host-task" };
const side = { projectRef: "project", taskRef: "side" };
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function baseOptions(root: string): ConversationRecoveryOptions {
  return { referenceFile: path.join(root, "references.json"), projects: [{ projectRef: "project", sourceRepo: path.join(root, "source"), stateRoot: path.join(root, "state") }],
    tasks: [{ ...main, kind: "direct" }, { ...side, kind: "direct" }] };
}
async function saveInitial(root: string) {
  const focus = new ConversationFocus([{ projectRef: "project" }, main, side]);
  focus.select(main, focus.snapshot().token, "private-message");
  await saveConversationReferences(path.join(root, "references.json"), focus.snapshot()); return focus;
}
async function status(session: ReadonlyConversationSession) {
  const result = await session.handle({ kind: "status", messageRef: "query", focus: session.focus().token });
  assert.equal(result.kind, "recovery-status");
  if (result.kind !== "recovery-status") throw new Error("expected recovery facts"); return result;
}

test("reference save/delete keeps only ordinary private pointers and refuses linked or unusable files", async () => fixture(async (root) => {
  const focus = await saveInitial(root); const file = path.join(root, "references.json");
  const bytes = await readFile(file, "utf8");
  assert.deepEqual(JSON.parse(bytes), { version: 1, current: main });
  assert.equal(bytes.includes("private-message"), false); assert.equal(bytes.includes(focus.snapshot().token.generation), false);
  let accessed = 0;
  for (const input of [
    { ...focus.snapshot(), credentials: "secret" },
    Object.defineProperty({ ...focus.snapshot() }, "messageRef", { get() { accessed++; return "secret"; } }),
    { ...focus.snapshot(), current: Object.defineProperty({ ...main }, "taskRef", { get() { accessed++; return "secret"; } }) }
  ]) await assert.rejects(saveConversationReferences(file, input), /unsupported|ordinary/);
  assert.equal(accessed, 0); assert.equal(await readFile(file, "utf8"), bytes);
  const linkDirectory = path.join(root, "linked");
  await symlink(path.join(root, "source"), linkDirectory, "junction");
  await assert.rejects(saveConversationReferences(path.join(linkDirectory, "ref.json"), focus.snapshot()), /linked/);
  await deleteConversationReferences(file); await deleteConversationReferences(file);
  await assert.rejects(ReadonlyConversationSession.load(baseOptions(root)), /reference.*unavailable/);
  await assert.rejects(lstat(file));
  for (const invalid of ["{broken", JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, current: main, token: "secret" }), " ".repeat(16385)]) {
    await writeFile(file, invalid, "utf8"); await assert.rejects(ReadonlyConversationSession.load(baseOptions(root)));
  }
}));

test("recovery validates host mappings before reading unknown runs and never restores dispatch authority", async () => fixture(async (root) => {
  const old = await saveInitial(root); const options = baseOptions(root);
  const session = await ReadonlyConversationSession.load(options);
  assert.notEqual(session.focus().token.generation, old.snapshot().token.generation);
  await assert.rejects(session.handle({ kind: "question", messageRef: "old", focus: old.snapshot().token }), /stale/);
  for (let i = 0; i < 2; i++) {
    await assert.rejects(session.handle({ kind: "run-direct", target: main, focus: session.focus().token, messageRef: "repeat", requestId: "repeat" }), /read.only/);
    assert.equal((await session.handle({ kind: "question", focus: session.focus().token, messageRef: "repeat" })).kind, "question");
  }
  assert.deepEqual((await status(session)).facts.tasks[0]?.reasons, ["direct-history-unmapped"]);
  await assert.rejects(lstat(path.join(root, "state")));
  let accesses = 0;
  const malicious = Object.defineProperty({ ...options }, "tasks", { get() { accesses++; return []; } });
  await assert.rejects(ReadonlyConversationSession.load(malicious), /ordinary/); assert.equal(accesses, 0);
  await writeFile(options.referenceFile, JSON.stringify({ version: 1, current: { ...main, projectRef: "foreign" } }), "utf8");
  await assert.rejects(ReadonlyConversationSession.load(options), /unknown saved target/);
  await writeFile(options.referenceFile, JSON.stringify({ version: 1, current: { ...main, runId: "run_00000000-0000-4000-8000-000000000001" } }), "utf8");
  await assert.rejects(ReadonlyConversationSession.load(options), /run|mapping/);
  await assert.rejects(lstat(path.join(root, "state")));
}));

test("fresh direct facts detect dirty/revised source and deleted/corrupt evidence without recreating a run", async () => fixture(async (root) => {
  const produced = child("produce", root); assert.equal(produced.status, 0, produced.stdout + produced.stderr);
  const receipt = JSON.parse(await readFile(path.join(root, "receipt.json"), "utf8")) as { runId: string; artifactId: string; sourceRevision: string };
  const options = { ...baseOptions(root), tasks: [{ ...main, kind: "direct" as const, ...receipt }, { ...side, kind: "direct" as const }] };
  // receipt also contains candidatePath/generation; use only the authorized reference fields.
  options.tasks[0] = { ...main, kind: "direct", runId: receipt.runId, artifactId: receipt.artifactId, sourceRevision: receipt.sourceRevision };
  const session = await ReadonlyConversationSession.load(options);
  assert.equal((await status(session)).facts.tasks[0]?.availability, "available");
  await writeFile(path.join(root, "source/value.txt"), "dirty", "utf8");
  assert.ok((await status(session)).facts.tasks[0]?.reasons.includes("source-dirty"));
  git(path.join(root, "source"), ["add", "."]); git(path.join(root, "source"), ["-c", "commit.gpgsign=false", "commit", "-m", "advance"]);
  assert.ok((await status(session)).facts.tasks[0]?.reasons.includes("source-revision-changed"));
  const runId = parseRunId(receipt.runId); const state = path.join(root, "state");
  const eventFile = runEventsPath(state, runId); const events = await readFile(eventFile);
  await appendFile(eventFile, '{"torn":', "utf8");
  assert.deepEqual((await status(session)).facts.tasks[0]?.reasons, ["run-incomplete-tail"]);
  await writeFile(eventFile, events);
  await writeFile(eventFile, "corrupt\n", "utf8");
  assert.deepEqual((await status(session)).facts.tasks[0]?.reasons, ["run-or-artifact-unavailable"]);
  await writeFile(eventFile, events);
  const artifact = loopArtifactPath(state, runId, receipt.artifactId); await unlink(artifact);
  assert.equal((await status(session)).facts.tasks[0]?.availability, "unavailable"); await assert.rejects(lstat(artifact));
  const directory = runDirectoryPath(state, runId); await rm(directory, { recursive: true });
  assert.equal((await status(session)).facts.tasks[0]?.availability, "unavailable"); await assert.rejects(lstat(directory));
}));

test("queue facts use explicit item identity and preserve unresolved claims while late status cannot move focus", async () => fixture(async (root) => {
  await saveInitial(root);
  const queuePath = path.join(root, "queue.json");
  const item = { id: "real-item", goal: "private goal", dependencies: [], allowedScope: ["value.txt"], priority: 1,
    acceptance: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"], verifierVersion: "v1" }] };
  await new WorkItemStore(queuePath).create(createWorkQueue({ id: "queue", authorityRef: "private-authority", items: [item] }));
  const controller = new DevelopmentController({ sourceRepo: path.join(root, "source"), stateRoot: path.join(root, "state"), queuePath, owner: "private-owner",
    executorFactory: () => { throw new Error("recovery must never execute"); } });
  controller.next = () => { throw new Error("recovery must never advance work"); };
  const action = await controller.ledger.prepare({ idempotencyKey: "recovery-test", kind: "candidate-write", input: { queueId: "queue", itemId: "real-item", secret: "private-input" } });
  await controller.ledger.claim(action.actionId, action.version);
  await controller.ledger.prepare({ idempotencyKey: "foreign-queue", kind: "candidate-write", input: { queueId: "other-queue", itemId: "real-item" } });
  const entered = deferred(); const release = deferred(); const original = controller.status.bind(controller); let delayed = false; let reads = 0;
  controller.status = async () => { reads++; const result = await original(); if (delayed) { entered.resolve(); await release.promise; } return result; };
  const options: ConversationRecoveryOptions = { ...baseOptions(root), projects: [{ ...baseOptions(root).projects[0]!, queuePath, controller }], tasks: [{ ...main, kind: "queue", itemId: "real-item" }, { ...side, kind: "queue", itemId: "not-host-task-name" }] };
  const first = await ReadonlyConversationSession.load(options); const second = await ReadonlyConversationSession.load(options);
  const initial = await status(first);
  assert.deepEqual(initial.facts.tasks[0]?.item, { itemId: "real-item", status: "planned" });
  assert.equal(initial.facts.tasks[0]?.actions?.[0]?.state, "running");
  assert.equal(initial.facts.tasks[0]?.actions?.length, 1, "same itemId in a foreign queue must not enter this projection");
  assert.deepEqual(initial.facts.tasks[1]?.reasons, ["queue-item-unavailable"]);
  const projection = JSON.stringify(initial);
  for (const secret of [root, "private-", "claimToken", "inputCanonicalJson", "acceptance"]) assert.equal(projection.includes(secret), false);
  const queueBefore = await readFile(queuePath, "utf8"); const ledgerPath = path.join(root, "actions/actions.json"); const ledgerBefore = await readFile(ledgerPath, "utf8");
  delayed = true; const pending = status(first); await entered.promise;
  await first.handle({ kind: "focus", target: side, temporary: true, focus: first.focus().token, messageRef: "switch" });
  const newer = first.focus(); const secondBefore = second.focus(); release.resolve();
  assert.equal((await pending).staleFocus, true); assert.deepEqual(first.focus(), newer); assert.deepEqual(second.focus(), secondBefore);
  assert.equal(await readFile(queuePath, "utf8"), queueBefore); assert.equal(await readFile(ledgerPath, "utf8"), ledgerBefore);
  const count = reads; await unlink(ledgerPath);
  assert.equal((await status(first)).facts.tasks[0]?.availability, "unavailable"); assert.equal(reads, count); await assert.rejects(lstat(ledgerPath));
}));

test("host task mappings are snapshotted before the first asynchronous read", async () => fixture(async (root) => {
  await saveInitial(root);
  const options = { ...baseOptions(root), tasks: [{ ...main, kind: "direct" as const }] };
  const loading = ReadonlyConversationSession.load(options);
  options.tasks[0]!.taskRef = "mutated-after-load";
  const session = await loading;
  assert.deepEqual(session.refs(), [{ projectRef: "project" }, main]);
}));

test("actual recovery factory refuses conflicting configuration, invalid signals and missing references; kill switch disables it", async () => fixture(async (root) => {
  const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
  const { loadExtensions } = await import(loaderUrl.href);
  const wrapper = path.join(root, "options-wrapper.ts");
  await writeFile(wrapper, `import { createSparkleExtension } from ${JSON.stringify(path.join(process.cwd(), "extensions/pi-sparkle/index.ts").replaceAll("\\", "/"))}; export default createSparkleExtension(globalThis.recoveryOptions);`, "utf8");
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = process.env.SPARKLE_NATIVE;
  try {
    globals.recoveryOptions = { conversation: { projects: [] }, conversationRecovery: baseOptions(root) };
    const conflict = await loadExtensions([wrapper], process.cwd()); assert.equal(conflict.errors.length, 1); assert.match(conflict.errors[0].error, /Choose conversation or conversationRecovery/);
    process.env.SPARKLE_NATIVE = "0";
    const killed = await loadExtensions([wrapper], process.cwd()); assert.deepEqual(killed.errors, []);
    assert.equal(killed.extensions[0].tools.size, 0); assert.equal(killed.extensions[0].handlers.size, 0); assert.equal(killed.extensions[0].commands.size, 0);
    if (previous === undefined) delete process.env.SPARKLE_NATIVE; else process.env.SPARKLE_NATIVE = previous;
    globals.recoveryOptions = { conversationRecovery: baseOptions(root) };
    const loaded = await loadExtensions([wrapper], process.cwd()); assert.deepEqual(loaded.errors, []);
    const tool = loaded.extensions[0].tools.get("sparkle_conversation_focus").definition;
    await assert.rejects(async () => tool.execute("invalid", {}, {}, undefined, {}), /AbortSignal/);
    await assert.rejects(async () => tool.execute("missing", {}, undefined, undefined, {}), (error: unknown) => {
      assert.match(String(error), /reference file unavailable/); assert.equal(String(error).includes(root), false); return true;
    });
    await assert.rejects(lstat(path.join(root, "references.json")));
  } finally {
    delete globals.recoveryOptions;
    if (previous === undefined) delete process.env.SPARKLE_NATIVE; else process.env.SPARKLE_NATIVE = previous;
  }
}));

test("an old direct result arriving after reference recovery cannot overwrite new focus or restore write authority", async () => fixture(async (root) => {
  const entered = deferred(); const release = deferred();
  const old = new ConversationSession({ projects: [{ projectRef: "project" }], tasks: [{ ...main, input: {
    sourceRepo: path.join(root, "source"), stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), objective: "Update value.txt",
    verification: { command: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('value.txt','utf8')!=='after')process.exit(1)"] },
    executorFactory: async ({ tools }) => {
      // Existing NativeWriteSession awaits this factory before allocating the run id.
      entered.resolve(); await release.promise;
      return { async *execute(request, signal) {
        await tools.find((tool) => tool.name === "sparkle_patch_file")!.execute("patch", { path: "value.txt", oldText: "before", newText: "after" }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    }
  } }] });
  await old.handle({ kind: "focus", target: main, focus: old.focus().token, messageRef: "main" });
  const pending = old.handle({ kind: "run-direct", target: main, focus: old.focus().token, messageRef: "run", requestId: "run" });
  await entered.promise;
  try {
    assert.equal(old.focus().current?.runId, undefined);
    const file = path.join(root, "references.json"); await saveConversationReferences(file, old.focus());
    const saved = await readFile(file, "utf8");
    const recovered = await ReadonlyConversationSession.load(baseOptions(root)); const snapshot = recovered.focus();
    release.resolve(); const result = await pending;
    assert.equal(result.kind, "direct-result");
    if (result.kind === "direct-result") assert.equal(result.result.acceptance.accepted, true, result.result.reason);
    assert.ok(old.focus().current?.runId);
    assert.deepEqual(recovered.focus(), snapshot); assert.equal(await readFile(file, "utf8"), saved);
    await assert.rejects(recovered.handle({ kind: "run-direct", target: main, focus: snapshot.token, messageRef: "new", requestId: "new" }), /read.only/);
    assert.equal(await readFile(path.join(root, "source/value.txt"), "utf8"), "before");
  } finally { release.resolve(); await pending; }
}));
