import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ActionLedger, type ActionKind, type ActionRecord } from "../../../src/development/action-ledger.js";

const evidence = { summary: "Host observed effect settlement", references: ["host:receipt"] };
function conflict(scope: string) {
  return (record: ActionRecord): boolean => {
    const other = (JSON.parse(record.inputCanonicalJson) as { scope?: unknown }).scope;
    return typeof other !== "string" || scope === other || scope.startsWith(`${other}/`) || other.startsWith(`${scope}/`);
  };
}
async function fixture(body: (directory: string, ledger: ActionLedger) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "sparkle-action-admission-"));
  try { await body(directory, new ActionLedger(directory)); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

for (const kinds of [["candidate-check", "candidate-check"], ["candidate-write", "candidate-check"]] as const) {
  test(`atomic admission allows one overlapping ${kinds.join("/")} and leaves no rejected rows`, async () => fixture(async (directory, ledger) => {
    const other = new ActionLedger(directory);
    const attempts = await Promise.allSettled([ledger, other].map((instance, index) => instance.admit({
      idempotencyKey: `attempt:${index}`, kind: kinds[index]!, input: { scope: "src" }
    }, conflict("src"))));
    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    const rejected = attempts.find((entry) => entry.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.match(String(rejected.reason), /reconciliation|overlap|conflict/);
    const records = await ledger.list();
    assert.equal(records.length, 1);
    assert.equal(records[0]!.state, "running");
    assert.deepEqual(records[0]!.history.map((entry) => entry.state), ["prepared", "running"]);
    for (let index = 0; index < 8; index++) await assert.rejects(other.admit({
      idempotencyKey: `rejected:${index}`, kind: "candidate-check", input: { scope: "src/part" }
    }, conflict("src/part")), /reconciliation|overlap|conflict/);
    assert.equal((await ledger.list()).length, 1, "contention must not consume the bounded ledger");
  }));
}

test("disjoint admissions coexist, and restart preserves running/uncertain ownership", async () => fixture(async (directory, ledger) => {
  const first = await ledger.admit({ idempotencyKey: "first", kind: "candidate-check", input: { scope: "src/a" } }, conflict("src/a"));
  const second = await new ActionLedger(directory).admit({ idempotencyKey: "second", kind: "candidate-write", input: { scope: "src/b" } }, conflict("src/b"));
  await ledger.markUncertain(first, { evidence });
  const restarted = new ActionLedger(directory);
  for (const scope of ["src/a", "src/b/child"]) await assert.rejects(restarted.admit({
    idempotencyKey: `retry:${scope}`, kind: "candidate-check", input: { scope }
  }, conflict(scope)), /reconciliation|overlap|conflict/);
  assert.equal((await restarted.list()).length, 2);
  await restarted.complete(second, { evidence });
  await restarted.admit({ idempotencyKey: "later", kind: "candidate-check", input: { scope: "src/b" } }, conflict("src/b"));
}));

test("atomic admission preserves immutable idempotency and never replays terminal effects", async () => fixture(async (_directory, ledger) => {
  const input = { idempotencyKey: "same", kind: "candidate-check" as ActionKind, input: { scope: "src/a" } };
  const first = await ledger.admit(input, conflict("src/a"));
  await assert.rejects(ledger.admit(input, conflict("src/a")), /prepared|replay|reconciliation/);
  await ledger.complete(first, { evidence });
  await assert.rejects(ledger.admit(input, conflict("src/a")), /prepared|replay/);
  await assert.rejects(ledger.admit({ ...input, input: { scope: "src/b" } }, conflict("src/b")), /identity/);
  assert.equal((await ledger.list()).length, 1);
}));

test("legacy unknown effects and pre-aborted admission fail before publication", async () => fixture(async (_directory, ledger) => {
  const old = await ledger.prepare({ idempotencyKey: "legacy", kind: "candidate-write", input: {} });
  await ledger.claim(old.actionId, old.version);
  await assert.rejects(ledger.admit({ idempotencyKey: "new", kind: "candidate-check", input: { scope: "other" } }, conflict("other")), /reconciliation|conflict/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(ledger.admit({ idempotencyKey: "cancel", kind: "candidate-check", input: {} }, () => false, abort.signal), /cancel/);
  assert.equal((await ledger.list()).length, 1);
}));
