import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GithubReceiptStore } from "../../../src/development/github-receipt-store.js";

const delivery = (deliveryId = "delivery-1", number = 7) => ({ deliveryId,
  locator: { owner: "Example", repository: "Repo", number }, event: { name: "issues" as const, action: "edited" } });
async function fixture(body: (path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sparkle-gh-receipt-"));
  try { await body(join(root, "receipts.json")); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

test("receipts reload with opaque IDs and canonical metadata, excluding payloads and credentials", async () => fixture(async (path) => {
  const first = await new GithubReceiptStore(path).receive(delivery());
  assert.equal(first.duplicate, false); assert.match(first.receipt.id, /^[0-9a-f-]{36}$/);
  assert.equal(first.receipt.locator.owner, "example");
  const next = await new GithubReceiptStore(path).receive(delivery());
  assert.equal(next.duplicate, true); assert.deepEqual(next.receipt, first.receipt);
  assert.equal((await new GithubReceiptStore(path).load()).length, 1);
  const bytes = await readFile(path, "utf8");
  assert.equal(bytes.includes("token"), false); assert.equal(bytes.includes("body"), false);
  await assert.rejects(new GithubReceiptStore(path).receive({ ...delivery(), body: "secret" } as never));
}));

test("concurrent writers deduplicate under the same lock and conflicting content refuses", async () => fixture(async (path) => {
  const values = await Promise.all(Array.from({ length: 12 }, () => new GithubReceiptStore(path).receive(delivery())));
  assert.equal(values.filter((value) => !value.duplicate).length, 1);
  assert.equal(new Set(values.map((value) => value.receipt.id)).size, 1);
  await assert.rejects(new GithubReceiptStore(path).receive(delivery("delivery-1", 8)), /conflict/);
  assert.equal((await new GithubReceiptStore(path).load()).length, 1);
}));

test("duplicates do not renew TTL, full live capacity refuses, expiry permits redelivery", async () => fixture(async (path) => {
  let time = 1000;
  const store = new GithubReceiptStore(path, { now: () => time, maxRows: 1, retentionMs: 100 });
  const first = await store.receive(delivery()); time = 1099;
  assert.equal((await store.receive(delivery())).receipt.expiresAt, first.receipt.expiresAt);
  await assert.rejects(store.receive(delivery("delivery-2")), /capacity/);
  time = 1100;
  const renewed = await store.receive(delivery());
  assert.equal(renewed.duplicate, false); assert.notEqual(renewed.receipt.id, first.receipt.id);
  assert.equal((await store.load()).length, 1);
}));

test("envelope and snapshot byte limits refuse without partial publication", async () => fixture(async (path) => {
  await assert.rejects(new GithubReceiptStore(path, { maxEnvelopeBytes: 30 }).receive(delivery()), /envelope/);
  await assert.rejects(new GithubReceiptStore(path, { maxSnapshotBytes: 100 }).receive(delivery()), /snapshot/);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  const store = new GithubReceiptStore(path); await store.receive(delivery());
  const before = await readFile(path);
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.receive({ ...delivery(), locator: { ...delivery().locator, number: value } }));
  }
  await assert.rejects(store.receive({ ...delivery(), event: { name: "issues" as const, action: "x".repeat(5000) } }));
  assert.deepEqual(await readFile(path), before);
}));

test("corrupt, noncanonical and oversized snapshots fail closed", async () => fixture(async (path) => {
  for (const body of ["{", "{}", '{"rows":[],"version":1}\n', " ".repeat(2000)]) {
    await writeFile(path, body, "utf8");
    await assert.rejects(new GithubReceiptStore(path, { maxSnapshotBytes: 1000 }).receive(delivery()));
    assert.equal(await readFile(path, "utf8"), body);
  }
}));

test("missing snapshot beside publication remnants refuses", async () => fixture(async (path) => {
  await writeFile(`${path}.123.crashed.tmp`, "incomplete", "utf8");
  await assert.rejects(new GithubReceiptStore(path).receive(delivery()), /remnant/);
  await assert.rejects(readFile(path), { code: "ENOENT" });
}));

test("hardlinked snapshots refuse without changing either name", async () => fixture(async (path) => {
  const store = new GithubReceiptStore(path); await store.receive(delivery());
  await link(path, `${path}.other`); const before = await readFile(path);
  await assert.rejects(store.receive(delivery("delivery-2")), /regular|link/);
  assert.deepEqual(await readFile(path), before); assert.deepEqual(await readFile(`${path}.other`), before);
}));

test("symlink snapshots and parent directories refuse", async (t) => fixture(async (path) => {
  const target = `${path}.target`; await writeFile(target, "unchanged", "utf8");
  try { await symlink(target, path, "file"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Windows symlink creation unavailable"); return; } throw error; }
  await assert.rejects(new GithubReceiptStore(path).receive(delivery()), /regular|link/);
  await rm(path); const directory = `${path}.directory`; await mkdir(directory);
  await symlink(directory, `${path}.parent`, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(new GithubReceiptStore(join(`${path}.parent`, "receipts.json")).receive(delivery()), /directory|link/);
  assert.equal(await readFile(target, "utf8"), "unchanged");
}));

test("receipt input snapshots before waiting on filesystem", async () => fixture(async (path) => {
  const input = delivery(); const pending = new GithubReceiptStore(path).receive(input);
  input.deliveryId = "changed"; input.locator.number = 999; input.event.action = "deleted";
  const value = await pending;
  assert.equal(value.receipt.deliveryId, "delivery-1"); assert.equal(value.receipt.locator.number, 7);
  assert.equal(value.receipt.event.action, "edited");
}));


test("directory snapshots, invalid limits and accessors refuse without invoking getters", async () => fixture(async (path) => {
  await mkdir(path); await assert.rejects(new GithubReceiptStore(path).receive(delivery()), /regular/);
  let getters = 0;
  assert.throws(() => new GithubReceiptStore(path, { get maxRows() { getters++; return 1; } }));
  for (const options of [{ maxRows: 513 }, { maxSnapshotBytes: 1048577 }, { maxEnvelopeBytes: 4097 }, { retentionMs: 604800001 }, { lock: { timeoutMs: 0 } }]) {
    assert.throws(() => new GithubReceiptStore(path, options));
  }
  await assert.rejects(new GithubReceiptStore(path).receive({ ...delivery(), get event() { getters++; return delivery().event; } }));
  assert.equal(getters, 0);
}));
