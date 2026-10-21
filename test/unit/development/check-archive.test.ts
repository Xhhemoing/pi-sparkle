import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ActionLedger, type ActionKind, type ActionRecord } from "../../../src/development/action-ledger.js";
import { canonicalizeStableJson, STABLE_JSON_CONTRACT } from "../../../src/domain/canonical-json.js";

const archive = { completedCheckArchive: true };
const evidence = { summary: "Fixture observed settlement", references: ["host:archive-fixture"] };
const scratch = resolve(".agent_workspace/staged-continuation/check-archive-tests");
async function fixture(body: (directory: string, ledger: ActionLedger) => Promise<void>): Promise<void> {
  await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(join(scratch, "unit-"));
  try { await body(directory, new ActionLedger(directory, archive)); }
  finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}
function clone(record: ActionRecord, key: string = randomUUID()): ActionRecord {
  return { ...record, actionId: `action_v1_${randomUUID()}`, idempotencyKey: key };
}
async function bytes(directory: string): Promise<Buffer> { return readFile(join(directory, "actions.json")); }
async function snapshot(directory: string): Promise<{ schemaVersion: number; actions: ActionRecord[]; archivedChecks: ActionRecord[] }> {
  return JSON.parse((await bytes(directory)).toString("utf8"));
}
async function completed(ledger: ActionLedger, id: string, kind: ActionKind = "candidate-check"): Promise<ActionRecord> {
  const claim = await ledger.admit({ idempotencyKey: id, kind, input: { id } }, () => false);
  return ledger.complete(claim, { evidence, result: { settled: true } });
}
async function seed(directory: string, actions: readonly ActionRecord[], archivedChecks: readonly ActionRecord[] = []): Promise<void> {
  await writeFile(join(directory, "actions.json"), canonicalizeStableJson({ schemaVersion: 2, canonicalization: STABLE_JSON_CONTRACT, actions, archivedChecks }), "utf8");
}

test("fresh opt-in durably publishes empty v2; default v1 empty read stays absent and modes refuse each other", async () => fixture(async (directory, ledger) => {
  assert.deepEqual(await ledger.list(), []); const v2 = await bytes(directory);
  assert.equal((await snapshot(directory)).schemaVersion, 2); assert.deepEqual((await snapshot(directory)).archivedChecks, []);
  await assert.rejects(new ActionLedger(directory).list(), /schema/); assert.deepEqual(await bytes(directory), v2);
  const v1dir = join(directory, "v1"); const ordinary = new ActionLedger(v1dir);
  assert.deepEqual(await ordinary.list(), []); await assert.rejects(bytes(v1dir), { code: "ENOENT" });
  await mkdir(v1dir, { recursive: true });
  const emptyV1 = canonicalizeStableJson({ schemaVersion: 1, canonicalization: STABLE_JSON_CONTRACT, actions: [] });
  await writeFile(join(v1dir, "actions.json"), emptyV1, "utf8");
  await assert.rejects(new ActionLedger(v1dir, archive).list(), /schema/); assert.equal((await bytes(v1dir)).toString(), emptyV1);
  await ordinary.prepare({ idempotencyKey: "v1", kind: "candidate-check", input: {} }); const populated = await bytes(v1dir);
  await assert.rejects(new ActionLedger(v1dir, archive).prepare({ idempotencyKey: "new", kind: "candidate-check", input: {} }), /schema/);
  assert.deepEqual(await bytes(v1dir), populated);
}));

test("actual 1026 filesystem admissions and completions archive full receipts and retain restart identity without replay", { timeout: 600_000 }, async (t) => fixture(async (directory, ledger) => {
  let first!: ActionRecord;
  for (let index = 0; index < 1026; index++) {
    if (index === 0) {
      const prepared = await ledger.prepare({ idempotencyKey: "actual:0", kind: "candidate-check", input: { id: "actual:0" } });
      first = await ledger.complete(await ledger.claim(prepared.actionId, prepared.version), { evidence, result: { settled: true } });
    } else await completed(ledger, `actual:${index}`);
    if (index === 1023) { const full = await snapshot(directory); assert.equal(full.actions.length, 1024); assert.equal(full.archivedChecks.length, 0, "completion never compacts"); }
    if (index % 128 === 0) await writeFile(join(scratch, "scale-progress.json"), JSON.stringify({ completed: index + 1 }), "utf8");
  }
  const persisted = await snapshot(directory);
  assert.equal(persisted.archivedChecks.length, 1024); assert.equal(persisted.actions.length, 2);
  assert.deepEqual(persisted.archivedChecks[0], first);
  const restarted = new ActionLedger(directory, archive); assert.equal((await restarted.list()).length, 1026);
  assert.deepEqual(await restarted.get(first.actionId), first);
  const before = await bytes(directory);
  assert.deepEqual(await restarted.prepare({ idempotencyKey: first.idempotencyKey, kind: first.kind, input: { id: "actual:0" } }), first);
  await assert.rejects(restarted.prepare({ idempotencyKey: first.idempotencyKey, kind: first.kind, input: { changed: true } }), /identity/);
  await assert.rejects(restarted.claim(first.actionId, first.version), /prepared|terminal|archiv/);
  await assert.rejects(restarted.admit({ idempotencyKey: first.idempotencyKey, kind: first.kind, input: { id: "actual:0" } }, () => false), /prepared|terminal|replay/);
  await assert.rejects(restarted.reconcile(first.actionId, { expectedVersion: first.version, workerStopped: true, resolution: "safe-to-retry", evidence }), /reconciliation|terminal|archiv/);
  assert.deepEqual(await bytes(directory), before);
  const summary = { actualFilesystemCompletedChecks: 1026, active: persisted.actions.length, archived: persisted.archivedChecks.length, restartIdentity: true, bytes: before.length };
  await writeFile(join(scratch, "scale-observation.json"), JSON.stringify(summary, null, 2), "utf8"); t.diagnostic(JSON.stringify(summary));
}));

test("only completed candidate-checks compact, preserving every other kind/state and original eligible order", async () => fixture(async (directory, ledger) => {
  const retained: ActionRecord[] = [];
  for (const kind of ["candidate-write", "git-commit", "pull-request", "candidate-apply"] as const) retained.push(await completed(ledger, `kind:${kind}`, kind));
  for (const state of ["prepared", "running", "failed", "needs-reconciliation"] as const) {
    const record = await ledger.prepare({ idempotencyKey: `state:${state}`, kind: "candidate-check", input: {} });
    if (state === "prepared") retained.push(record);
    else { const claim = await ledger.claim(record.actionId, record.version);
      if (state === "running") retained.push((await ledger.get(record.actionId))!);
      else retained.push(await (state === "failed" ? ledger.fail(claim, { evidence }) : ledger.markUncertain(claim, { evidence })));
    }
  }
  const template = await completed(ledger, "template");
  const eligible = Array.from({ length: 1024 - retained.length }, (_, index) => clone(template, `eligible:${index}`));
  const ordered = [...retained.slice(0, 2), eligible[0]!, ...retained.slice(2), ...eligible.slice(1)];
  await seed(directory, ordered);
  await ledger.prepare({ idempotencyKey: "new", kind: "candidate-check", input: {} });
  const result = await snapshot(directory);
  assert.deepEqual(result.archivedChecks, eligible); assert.deepEqual(result.actions.slice(0, retained.length), retained);
  assert.equal(result.actions.at(-1)!.idempotencyKey, "new");
}));

test("partial compaction uses remaining archive capacity; exhausted capacity and all-active state preserve bytes/unknown effects", async () => fixture(async (directory, ledger) => {
  const template = await completed(ledger, "template"); const running = await ledger.admit({ idempotencyKey: "unknown", kind: "candidate-write", input: {} }, () => false);
  const unknown = (await ledger.get(running.actionId))!;
  const archived = Array.from({ length: 4095 }, () => clone(template));
  const active = [unknown, ...Array.from({ length: 1023 }, () => clone(template))];
  await seed(directory, active, archived);
  await ledger.prepare({ idempotencyKey: "last-slot", kind: "candidate-check", input: {} });
  const partial = await snapshot(directory); assert.equal(partial.actions.length, 1024); assert.equal(partial.archivedChecks.length, 4096);
  assert.deepEqual(partial.archivedChecks.at(-1), active[1]); assert.deepEqual(partial.actions[0], unknown);
  const before = await bytes(directory);
  await assert.rejects(ledger.admit({ idempotencyKey: "overflow", kind: "candidate-check", input: {} }, () => false), /limit|capacity/);
  assert.deepEqual(await bytes(directory), before); assert.equal((await ledger.get(unknown.actionId))!.state, "running");
  await seed(directory, Array.from({ length: 1024 }, (_, index) => clone(unknown, `running:${index}`)));
  const allActive = await bytes(directory);
  await assert.rejects(ledger.prepare({ idempotencyKey: "no-eligible", kind: "candidate-check", input: {} }), /limit|capacity/);
  assert.deepEqual(await bytes(directory), allActive);
}));

test("concurrent full-capacity admit and settlement retain unique identities and every unresolved row", async () => fixture(async (directory, ledger) => {
  const template = await completed(ledger, "template"); const old = await ledger.admit({ idempotencyKey: "old-running", kind: "candidate-write", input: {} }, () => false);
  const unknown = (await ledger.get(old.actionId))!; await seed(directory, [unknown, ...Array.from({ length: 1023 }, () => clone(template))]);
  const instances = Array.from({ length: 8 }, () => new ActionLedger(directory, archive));
  const operations = instances.map((instance, index) => instance.admit({ idempotencyKey: `concurrent:${index}`, kind: "candidate-check", input: { index } }, () => false));
  const [claims] = await Promise.all([Promise.all(operations), ledger.markUncertain(old, { evidence })]);
  await Promise.all(claims.map((claim, index) => instances[index]!.complete(claim, { evidence })));
  const all = await ledger.list(); assert.equal(all.length, 1032); assert.equal(new Set(all.map((row) => row.actionId)).size, all.length);
  assert.equal(new Set(all.map((row) => row.idempotencyKey)).size, all.length); assert.equal((await ledger.get(old.actionId))!.state, "needs-reconciliation");
  const before = await bytes(directory);
  await assert.rejects(ledger.admit({ idempotencyKey: "blocked", kind: "candidate-check", input: {} }, () => true), /reconciliation|overlap/);
  assert.deepEqual(await bytes(directory), before);
}));

test("archive validation checks cross-partition identities, eligibility, capacity and complete histories", async () => fixture(async (directory, ledger) => {
  const completedRow = await completed(ledger, "complete"); const prepared = await ledger.prepare({ idempotencyKey: "prepared", kind: "candidate-check", input: {} });
  const invalids = [
    { actions: [completedRow], archivedChecks: [completedRow] },
    { actions: [completedRow], archivedChecks: [{ ...clone(completedRow), idempotencyKey: completedRow.idempotencyKey }] },
    { actions: [], archivedChecks: [prepared] },
    { actions: [], archivedChecks: [{ ...completedRow, kind: "candidate-write" as const }] },
    { actions: [], archivedChecks: [{ ...completedRow, history: completedRow.history.slice(1) }] },
    { actions: [], archivedChecks: Array.from({ length: 4097 }, () => clone(completedRow)) }
  ];
  for (const value of invalids) {
    await seed(directory, value.actions, value.archivedChecks); const before = await bytes(directory);
    await assert.rejects(ledger.list(), /identity|duplicate|archive|history|collection/); assert.deepEqual(await bytes(directory), before);
  }
}));

test("8MiB refusal retains full previous bytes and running unknown action", async () => fixture(async (directory, ledger) => {
  const template = await completed(ledger, "template"); const running = await ledger.admit({ idempotencyKey: "unknown", kind: "candidate-write", input: {} }, () => false);
  const unknown = (await ledger.get(running.actionId))!;
  const large = { ...template, inputCanonicalJson: canonicalizeStableJson({ padding: "x".repeat(64000) }) };
  const actions: ActionRecord[] = [unknown]; const archived: ActionRecord[] = [];
  for (let index = 0; index < 128; index++) archived.push(clone(large));
  // Remain below the existing byte bound, then cross it with a new <=64KiB input.
  await seed(directory, actions, archived); const before = await bytes(directory); assert.ok(before.length < 8 * 1024 * 1024);
  const padding = 8 * 1024 * 1024 - before.length - 1000;
  if (padding > 0) { const fillers = Math.floor(padding / 64000); for (let index = 0; index < fillers; index++) actions.push(clone(large)); }
  await seed(directory, actions, archived); const close = await bytes(directory);
  assert.ok(close.length > 8 * 1024 * 1024 - 65500 && close.length < 8 * 1024 * 1024);
  await assert.rejects(ledger.prepare({ idempotencyKey: "oversize", kind: "candidate-check", input: { padding: "x".repeat(64000) } }), /8 MiB/);
  assert.deepEqual(await bytes(directory), close); assert.equal((await ledger.get(unknown.actionId))!.state, "running");
}));

test("atomic publication failure preserves old snapshot/unknown records and failed empty initialization is never successful", async () => fixture(async (directory, ledger) => {
  const template = await completed(ledger, "template"); const claim = await ledger.admit({ idempotencyKey: "unknown", kind: "candidate-write", input: {} }, () => false);
  const unknown = (await ledger.get(claim.actionId))!; await seed(directory, [unknown, ...Array.from({ length: 1023 }, () => clone(template))]);
  const before = await bytes(directory); let calls = 0;
  const failing = new ActionLedger(directory, { ...archive, rename: async () => { calls++; throw Object.assign(new Error("fixture publication failure"), { code: "EIO" }); } });
  await assert.rejects(failing.prepare({ idempotencyKey: "never-admitted", kind: "candidate-check", input: {} }), /publication failure/);
  assert.ok(calls > 0); assert.deepEqual(await bytes(directory), before); assert.equal((await ledger.get(unknown.actionId))!.state, "running");
  const absent = join(directory, "fresh-failure");
  const failedInit = new ActionLedger(absent, { ...archive, rename: async () => { throw new Error("init publication failure"); } });
  await assert.rejects(failedInit.list(), /init publication failure/); await assert.rejects(bytes(absent), { code: "ENOENT" });
  // Existing atomic aside/restore path is exercised rather than replacing the writer.
  let failedOnce = false;
  const restore = new ActionLedger(directory, { ...archive, rename: async (source, destination) => {
    if (!failedOnce) { failedOnce = true; throw Object.assign(new Error("force existing Windows fallback"), { code: "EPERM" }); }
    if (String(source).endsWith(".tmp")) throw Object.assign(new Error("publish refused after aside"), { code: "EIO" });
    return rename(source, destination);
  } });
  await assert.rejects(restore.prepare({ idempotencyKey: "still-not-admitted", kind: "candidate-check", input: {} }), /publish refused/);
  assert.deepEqual(await bytes(directory), before);
}));

test("remnants, snapshot links and symlink root cannot initialize schema2", async (t) => fixture(async (directory) => {
  const remnants = join(directory, "remnants"); await mkdir(remnants); await writeFile(join(remnants, "actions.json.crashed.bak"), "retained", "utf8");
  await assert.rejects(new ActionLedger(remnants, archive).list(), /remnant/); await assert.rejects(bytes(remnants), { code: "ENOENT" });
  const target = join(directory, "target"); await mkdir(target);
  const linked = join(directory, "linked");
  try { await symlink(target, linked, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("host cannot create symlinks"); return; } throw error; }
  await assert.rejects(new ActionLedger(linked, archive).list(), /symlink|directory/);
  const file = join(directory, "external.json"); await writeFile(file, "unchanged", "utf8");
  await symlink(file, join(target, "actions.json"), "file"); await assert.rejects(new ActionLedger(target, archive).list(), /symlink|regular/);
  assert.equal(await readFile(file, "utf8"), "unchanged");
}));

test("archive boolean and publication seam options snapshot synchronously and reject invalid mode", async () => fixture(async (directory) => {
  const options = { completedCheckArchive: true }; const ledger = new ActionLedger(directory, options); options.completedCheckArchive = false;
  await ledger.list(); assert.equal((await snapshot(directory)).schemaVersion, 2);
  for (const value of ["true", 1, null]) assert.throws(() => new ActionLedger(join(directory, "bad"), { completedCheckArchive: value } as never));
  const ordinary = new ActionLedger(join(directory, "false"), { completedCheckArchive: false }); await ordinary.list();
  await assert.rejects(bytes(join(directory, "false")), { code: "ENOENT" });
}));


test("failed atomic restoration retains aside bytes and refuses ambiguous missing primary", async () => fixture(async (directory, ledger) => {
  await ledger.list(); const retained = await bytes(directory); let first = true;
  const failure = new ActionLedger(directory, { ...archive, rename: async (source, destination) => {
    if (first) { first = false; throw Object.assign(new Error("force aside"), { code: "EPERM" }); }
    if (String(source).endsWith(".tmp")) throw Object.assign(new Error("publish failed"), { code: "EIO" });
    if (String(source).endsWith(".bak")) throw Object.assign(new Error("restore failed"), { code: "EACCES" });
    return rename(source, destination);
  } });
  await assert.rejects(failure.prepare({ idempotencyKey: "not-admitted", kind: "candidate-check", input: {} }), /publish failed/);
  await assert.rejects(bytes(directory), { code: "ENOENT" });
  const { readdir } = await import("node:fs/promises"); const aside = (await readdir(directory)).find((name) => name.endsWith(".bak"));
  assert.ok(aside); assert.deepEqual(await readFile(join(directory, aside)), retained);
  await assert.rejects(new ActionLedger(directory, archive).list(), /remnant/);
}));
