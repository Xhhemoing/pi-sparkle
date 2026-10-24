import { readPinnedPiVersions } from "../../../src/pi-compat/check.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { stageManagedCandidate, type ManagedCandidate } from "../../../src/pi-adapter/managed/candidate.js";
import { qualifyManagedCandidate, type ManagedQualificationResult, type ManagedQualificationRecord } from "../../../src/pi-adapter/managed/qualification.js";
import { withExclusiveFileLock } from "../../../src/persist/file-lock.js";

const repository = process.cwd();
const pins = readPinnedPiVersions(JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")));
const versions = { core: pins.agentCore, ai: pins.ai };
interface Qualified extends ManagedCandidate { readonly qualification: ManagedQualificationRecord }
interface Store {
  approve(result: ManagedQualificationResult): Promise<Qualified>;
  readApproved(): Promise<Qualified | undefined>;
  getQualifiedGeneration(id: string): Promise<Qualified>;
}
interface Options { lock?: { timeoutMs?: number; retryMs?: number }; atomicWrite?: { rename?: (source: string, destination: string) => Promise<void> } }
type Constructor = new (root: string, options?: Options) => Store;
async function storeConstructor(): Promise<Constructor> {
  const loaded = await import(pathToFileURL(path.join(repository, "src/pi-adapter/managed/generation-store.ts")).href).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }) as { ManagedGenerationStore?: Constructor };
  assert.equal(typeof loaded.ManagedGenerationStore, "function", "managed generation store must implement approved selection");
  return loaded.ManagedGenerationStore!;
}
async function manager(t: TestContext): Promise<string> {
  const parent = path.join(repository, ".agent_workspace/managed-generation-store-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  await mkdir(path.join(root, "generations"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return root;
}
function freshBuild(root: string): void {
  const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: repository, env: { ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }), HOME: root, USERPROFILE: root, TEMP: root, TMP: root },
    encoding: "utf8", timeout: 60_000, maxBuffer: 512 * 1024, windowsHide: true
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function fault(code: string): Error { return Object.assign(new Error(`injected ${code}`), { code }); }
async function bounded(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("fixture barrier timed out")), 5_000); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function json(file: string, value: unknown): Promise<void> { await writeFile(file, JSON.stringify(value), "utf8"); }

test("qualified generations publish retained selection under the manager lock", { timeout: 240_000 }, async (t) => {
  const GenerationStore = await storeConstructor();
  const root = await manager(t);
  const pointer = path.join(root, "approved.json");
  const qualifications = path.join(root, "qualifications");
  const store = new GenerationStore(root);
  await t.test("only a genuinely absent pointer is empty and requested missing generation refuses", async () => {
    assert.equal(await store.readApproved(), undefined);
    await assert.rejects(store.getQualifiedGeneration(randomUUID()));
    await assert.rejects(store.getQualifiedGeneration("../escape"));
    const absent = path.join(root, "not-created");
    assert.throws(() => new GenerationStore(absent));
    await assert.rejects(lstat(absent), { code: "ENOENT" });
  });
  freshBuild(root);
  const a = await stageManagedCandidate({ programRoot: repository, generationsRoot: path.join(root, "generations"), expectedVersions: versions });
  const b = await stageManagedCandidate({ programRoot: repository, generationsRoot: path.join(root, "generations"), expectedVersions: versions });
  const receiptA = await qualifyManagedCandidate({ managerRoot: root, candidate: a });
  const receiptB = await qualifyManagedCandidate({ managerRoot: root, candidate: b });
  assert.equal(receiptA.status, "qualified", receiptA.status === "failed" ? receiptA.reason : "");
  assert.equal(receiptB.status, "qualified", receiptB.status === "failed" ? receiptB.reason : "");
  const abort = new AbortController(); abort.abort();
  const failed = await qualifyManagedCandidate({ managerRoot: root, candidate: b, signal: abort.signal });
  assert.equal(failed.status, "failed");
  const qa = path.join(qualifications, `${a.generationId}.json`);
  const qb = path.join(qualifications, `${b.generationId}.json`);
  const selectA = async (): Promise<void> => { await store.approve(receiptA); };
  await t.test("copied, serialized, failed and wrong-manager receipts cannot publish", async () => {
    for (const copy of [{ ...receiptA }, structuredClone(receiptA), JSON.parse(JSON.stringify(receiptA)), failed]) {
      await assert.rejects(store.approve(copy as ManagedQualificationResult), /issued/);
    }
    const otherRoot = await manager(t);
    await assert.rejects(new GenerationStore(otherRoot).approve(receiptA), /manager/);
    assert.equal(await store.readApproved(), undefined);
    await assert.rejects(lstat(qualifications), { code: "ENOENT" });
  });
  await t.test("actual A receipt publishes its qualification before the pointer and freezes detached output", async () => {
    const publications: string[] = [];
    const ordered = new GenerationStore(root, { atomicWrite: { rename: async (source, destination) => {
      await rename(source, destination); publications.push(destination);
    } } });
    const approved = await ordered.approve(receiptA);
    assert.deepEqual(publications, [qa, pointer]);
    assert.equal(approved.generationId, a.generationId);
    assert.deepEqual(approved.qualification.versions, versions);
    assert.ok(Object.isFrozen(approved)); assert.ok(Object.isFrozen(approved.qualification.observations));
    assert.throws(() => { (approved.versions as { core: string }).core = "changed"; }, TypeError);
    const restarted = await new GenerationStore(root).readApproved();
    assert.equal(restarted?.generationId, a.generationId);
    assert.notEqual(restarted, approved);
    assert.deepEqual(JSON.parse(await readFile(pointer, "utf8")), { generationId: a.generationId });
  });
  await t.test("failed qualification, invalid candidate and failed record publication retain A", async () => {
    const before = await readFile(pointer, "utf8");
    await assert.rejects(store.approve(failed), /issued/);
    const manifest = path.join(b.root, "candidate.json");
    const original = await readFile(manifest, "utf8");
    try {
      await json(manifest, { generationId: b.generationId, versions: { ...versions, core: "0.0.0" } });
      await assert.rejects(store.approve(receiptB), /version/);
    } finally { await writeFile(manifest, original, "utf8"); }
    const failing = new GenerationStore(root, { atomicWrite: { rename: async (source, destination) => {
      if (destination === qb) throw fault("EIO");
      await rename(source, destination);
    } } });
    await assert.rejects(failing.approve(receiptB), /injected EIO/);
    assert.equal(await readFile(pointer, "utf8"), before);
    assert.equal((await store.readApproved())?.generationId, a.generationId);
    await assert.rejects(lstat(qb), { code: "ENOENT" });
  });
  await t.test("same-generation approval reuses existing bytes and still requires an issued receipt", async () => {
    const previous = JSON.parse(await readFile(qa, "utf8")) as { observations: Array<{ eventTypes?: string[] }> };
    previous.observations[0]!.eventTypes!.push("TEXT_DELTA");
    const before = JSON.stringify(previous);
    await writeFile(qa, before, "utf8"); // Different valid persisted observations are retained.
    const repeat = new GenerationStore(root, { atomicWrite: { rename: async (source, destination) => {
      assert.notEqual(destination, qa, "existing qualification must never be replaced");
      await rename(source, destination);
    } } });
    await repeat.approve(receiptA);
    assert.equal(await readFile(qa, "utf8"), before);
    await assert.rejects(repeat.approve(structuredClone(receiptA)), /issued/);
  });
  await t.test("approving B retains A and restart lookup follows exact requested identity", async () => {
    await store.approve(receiptB);
    assert.equal((await new GenerationStore(root).readApproved())?.generationId, b.generationId);
    assert.equal((await store.getQualifiedGeneration(a.generationId)).generationId, a.generationId);
    for (const file of [qa, qb, a.root, b.root]) assert.ok(await lstat(file));
  });
  await t.test("an unselected corrupt retained record cannot be overwritten during approval", async () => {
    await selectA();
    const original = await readFile(qb, "utf8"), before = await readFile(pointer, "utf8");
    try {
      await writeFile(qb, "{", "utf8");
      await assert.rejects(store.approve(receiptB));
      assert.equal(await readFile(qb, "utf8"), "{");
      assert.equal(await readFile(pointer, "utf8"), before);
      assert.equal((await store.readApproved())?.generationId, a.generationId);
    } finally { await writeFile(qb, original, "utf8"); }
  });
  await t.test("all readers wait through actual Windows-style missing-primary interval", async () => {
    await selectA();
    const aside = deferred(), release = deferred();
    let first = true;
    const publishing = new GenerationStore(root, { atomicWrite: { rename: async (source, destination) => {
      if (destination === pointer && source.endsWith(".tmp") && first) { first = false; throw fault("EPERM"); }
      await rename(source, destination);
      if (source === pointer && destination.endsWith(".bak")) { aside.resolve(); await release.promise; }
    } } }).approve(receiptB);
    let selected: Promise<Qualified | undefined> | undefined, retained: Promise<Qualified> | undefined;
    try {
      await bounded(aside.promise);
      await assert.rejects(readFile(pointer, "utf8"), { code: "ENOENT" });
      let selectedSettled = false, retainedSettled = false;
      selected = new GenerationStore(root).readApproved(); retained = new GenerationStore(root).getQualifiedGeneration(a.generationId);
      void selected.then(() => { selectedSettled = true; }, () => { selectedSettled = true; }); void retained.then(() => { retainedSettled = true; }, () => { retainedSettled = true; });
      await new Promise((done) => setTimeout(done, 50));
      assert.equal(selectedSettled, false); assert.equal(retainedSettled, false);
      release.resolve(); await publishing;
      assert.equal((await selected)?.generationId, b.generationId);
      assert.equal((await retained).generationId, a.generationId);
    } finally { release.resolve(); await Promise.allSettled([publishing, ...(selected === undefined ? [] : [selected]), ...(retained === undefined ? [] : [retained])]); }
  });
  for (const restoreFails of [false, true]) await t.test(`pointer publication failure ${restoreFails ? "retains ambiguous remnant" : "restores A"}`, async () => {
    await selectA();
    const before = await readFile(pointer, "utf8");
    let first = true;
    const failing = new GenerationStore(root, { atomicWrite: { rename: async (source, destination) => {
      if (destination === pointer && source.endsWith(".tmp")) {
        if (first) { first = false; throw fault("EPERM"); }
        throw fault("EIO");
      }
      if (restoreFails && destination === pointer && source.endsWith(".bak")) throw fault("EACCES");
      await rename(source, destination);
    } } });
    try {
      await assert.rejects(failing.approve(receiptB), /injected EIO/);
      if (restoreFails) {
        await assert.rejects(store.readApproved(), /reconcil/);
        await assert.rejects(store.approve(receiptB), /reconcil/);
        assert.ok((await readdir(root)).some((file) => file.startsWith("approved.json.") && file.endsWith(".bak")));
      } else {
        assert.equal(await readFile(pointer, "utf8"), before);
        assert.equal((await store.readApproved())?.generationId, a.generationId);
      }
    } finally {
      await writeFile(pointer, before, "utf8");
      for (const file of await readdir(root)) if (file.startsWith("approved.json.")) await rm(path.join(root, file), { force: true });
    }
  });
  await t.test("missing pointer with remnants refuses while an authoritative primary tolerates leftovers", async () => {
    const before = await readFile(pointer, "utf8"), remnant = `${pointer}.abandoned.tmp`;
    try {
      await writeFile(remnant, "unfinished", "utf8");
      assert.equal((await store.readApproved())?.generationId, a.generationId);
      await rm(pointer);
      await assert.rejects(store.readApproved(), /reconcil/);
    } finally { await writeFile(pointer, before, "utf8"); await rm(remnant, { force: true }); }
  });
  await t.test("corrupt current selection cannot be overwritten by a new valid approval", async () => {
    const before = await readFile(pointer, "utf8");
    for (const value of ["{", JSON.stringify({ generationId: "../escape" }), JSON.stringify({ generationId: a.generationId, extra: true }), " ".repeat(4097)]) {
      try {
        await writeFile(pointer, value, "utf8");
        await assert.rejects(store.readApproved()); await assert.rejects(store.approve(receiptB));
        assert.equal(await readFile(pointer, "utf8"), value);
      } finally { await writeFile(pointer, before, "utf8"); }
    }
  });
  await t.test("persisted qualification corruption, absence and publication remnants never retarget", async () => {
    const before = await readFile(qa, "utf8");
    const good = JSON.parse(before) as ManagedQualificationRecord;
    const mutations: unknown[] = ["{", { ...good, managerRoot: root + "-wrong" }, { ...good, generationId: b.generationId }, { ...good, versions: { core: "0.0.0", ai: versions.ai } }, { ...good, observations: [] }, { ...good, observations: [...good.observations.slice(0, 4), good.observations[0]] }, { ...good, observations: [...good.observations, good.observations[0]] }, { ...good, candidateRoot: b.root }, " ".repeat(128 * 1024 + 1)];
    for (const value of mutations) {
      try {
        await writeFile(qa, typeof value === "string" ? value : JSON.stringify(value), "utf8");
        await assert.rejects(store.getQualifiedGeneration(a.generationId));
        await assert.rejects(store.readApproved()); await assert.rejects(store.approve(receiptA));
      } finally { await writeFile(qa, before, "utf8"); }
    }
    try {
      await rm(qa);
      await assert.rejects(store.getQualifiedGeneration(a.generationId)); await assert.rejects(store.readApproved());
      await writeFile(`${qa}.abandoned.tmp`, "unfinished", "utf8");
      await assert.rejects(store.approve(receiptA), /reconcil/);
    } finally { await writeFile(qa, before, "utf8"); await rm(`${qa}.abandoned.tmp`, { force: true }); }
  });
  await t.test("missing completed candidate and mismatching manifest refuse original generation", async () => {
    const manifest = path.join(a.root, "candidate.json"), before = await readFile(manifest, "utf8");
    try {
      await rm(manifest); await assert.rejects(store.getQualifiedGeneration(a.generationId));
      await json(manifest, { generationId: b.generationId, versions }); await assert.rejects(store.getQualifiedGeneration(a.generationId));
      await writeFile(manifest, " ".repeat(1024 * 1024 + 1), "utf8"); await assert.rejects(store.getQualifiedGeneration(a.generationId));
    } finally { await writeFile(manifest, before, "utf8"); }
    const moved = path.join(root, "app-held");
    await rename(a.appRoot, moved);
    try { await assert.rejects(store.getQualifiedGeneration(a.generationId)); }
    finally { await rename(moved, a.appRoot); }
  });
  await t.test("metadata must remain bounded regular single-link files with physical parents", async (t) => {
    const before = await readFile(qa, "utf8"), saved = path.join(root, "qualification-held.json");
    await rename(qa, saved);
    try {
      await mkdir(qa); await assert.rejects(store.getQualifiedGeneration(a.generationId)); await rm(qa, { recursive: true });
      await link(saved, qa); await assert.rejects(store.getQualifiedGeneration(a.generationId)); await rm(qa);
      try { await symlink(saved, qa, "file"); }
      catch (error: unknown) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EPERM") throw error;
        t.diagnostic("file symlink creation unavailable on this Windows host; hardlink/directory refusals executed");
      }
      if (await lstat(qa).catch(() => undefined)) { await assert.rejects(store.getQualifiedGeneration(a.generationId)); await rm(qa); }
    } finally { await rm(qa, { recursive: true, force: true }); await rename(saved, qa); }
    assert.equal(await readFile(qa, "utf8"), before);
    const held = path.join(root, "qualifications-held");
    await rename(qualifications, held);
    try {
      await symlink(held, qualifications, process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(store.getQualifiedGeneration(a.generationId));
    } finally { await rm(qualifications, { force: true }); await rename(held, qualifications); }
  });
  await t.test("constructor options and approval receipt are captured before lock contention", async () => {
    const entered = deferred(), release = deferred();
    const held = withExclusiveFileLock(path.join(root, "manager.lock"), async () => { entered.resolve(); await release.promise; });
    await bounded(entered.promise);
    let renames = 0;
    const options: Options = { lock: { timeoutMs: 5_000, retryMs: 5 }, atomicWrite: { rename: async (source, destination) => { renames++; await rename(source, destination); } } };
    const captured = new GenerationStore(root, options);
    const pending = captured.approve(receiptB);
    options.lock!.timeoutMs = 0;
    options.atomicWrite!.rename = async () => { throw fault("EIO"); };
    try { release.resolve(); await held; assert.equal((await pending).generationId, b.generationId); assert.equal(renames, 1); }
    finally { release.resolve(); await Promise.allSettled([held, pending]); }
  });
});
