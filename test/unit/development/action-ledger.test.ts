import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { canonicalizeStableJson } from "../../../src/domain/canonical-json.js";
import { ActionLedger, createActionIdempotencyKey } from "../../../src/development/action-ledger.js";

const evidence = { summary: "Host inspected the actual receipt", references: ["receipt.json"] };

test("candidate-discard is an explicit supported effect kind and reloads without changing ledger schema", async () => {
  await fixture(async (dir, ledger) => {
    const prepared = await ledger.prepare({ idempotencyKey: "discard-pinning", kind: "candidate-discard", input: { candidatePath: "host-owned" } });
    const reloaded = await new ActionLedger(join(dir, "ledger")).get(prepared.actionId);
    assert.equal(reloaded?.kind, "candidate-discard"); assert.equal(reloaded?.state, "prepared");
    const snapshot = JSON.parse(await readFile(join(dir, "ledger", "actions.json"), "utf8"));
    assert.equal(snapshot.schemaVersion, 1);
  });
});

async function fixture(run: (dir: string, ledger: ActionLedger) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sparkle-action-ledger-"));
  try { await run(dir, new ActionLedger(join(dir, "ledger"))); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("canonical identity deduplicates exactly and rejects changed key bindings", async () => {
  await fixture(async (dir, ledger) => {
    const key = createActionIdempotencyKey();
    const input = { target: "candidate", args: ["one", "two"] };
    const first = await ledger.prepare({ idempotencyKey: key, kind: "candidate-write", input });
    input.args.push("mutated");
    const other = new ActionLedger(join(dir, "ledger"));
    const repeated = await other.prepare({ idempotencyKey: key, kind: "candidate-write", input: { args: ["one", "two"], target: "candidate" } });
    assert.equal(repeated.actionId, first.actionId);
    assert.match(first.actionId, /^action_v1_/);
    assert.equal(first.inputCanonicalJson, '{"args":["one","two"],"target":"candidate"}');
    await assert.rejects(other.prepare({ idempotencyKey: key, kind: "candidate-write", input }), /identity/);
    await assert.rejects(other.prepare({ idempotencyKey: key, kind: "candidate-check", input: { args: ["one", "two"], target: "candidate" } }), /identity/);
    assert.equal((await other.list()).length, 1);
  });
});

test("one concurrent claim wins and stale tokens cannot settle or claim again", async () => {
  await fixture(async (dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-check", input: {} });
    const other = new ActionLedger(join(dir, "ledger"));
    const claims = await Promise.allSettled([ledger.claim(action.actionId, action.version), other.claim(action.actionId, action.version)]);
    assert.equal(claims.filter((entry) => entry.status === "fulfilled").length, 1);
    const winner = claims.find((entry) => entry.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled");
    assert.equal((await other.get(action.actionId))?.state, "running");
    await assert.rejects(other.complete({ ...winner.value, token: "claim_v1_wrong" }, { evidence, result: {} }), /claim|stale/);
    const completed = await ledger.complete(winner.value, { evidence, result: { receipt: "r1" } });
    assert.equal(completed.state, "completed");
    assert.equal(completed.resultCanonicalJson, '{"receipt":"r1"}');
    await assert.rejects(other.complete(winner.value, { evidence, result: {} }), /claim|stale/);
    await assert.rejects(other.claim(action.actionId, completed.version), /prepared/);
  });
});

test("running checkpoint records the exact host effect target and advances its claim version", async () => {
  await fixture(async (dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-write", input: { objective: "repair" } });
    const first = await ledger.claim(action.actionId, action.version);
    const candidate = { candidatePath: join(dir, "worktree"), sourceRevision: "revision-1", queueClaim: "queue-claim-1" };
    const current = await ledger.checkpoint(first, { evidence, result: candidate });
    candidate.sourceRevision = "mutated-after-checkpoint";
    assert.equal(current.version, first.version + 1);
    assert.equal(current.token, first.token);
    const observed = await new ActionLedger(join(dir, "ledger")).get(action.actionId);
    assert.equal(observed?.state, "running");
    assert.equal(JSON.parse(observed!.resultCanonicalJson!).sourceRevision, "revision-1");
    assert.equal(observed?.inputCanonicalJson, action.inputCanonicalJson);
    await assert.rejects(ledger.complete(first, { evidence }), /stale/);
    assert.equal((await ledger.complete(current, { evidence, result: { ...candidate, outcome: "checked" } })).state, "completed");
  });
});

test("recovery is explicit, fences stale claims, and absent-effect evidence alone permits retry", async () => {
  await fixture(async (dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "git-commit", input: { tree: "candidate-tree" } });
    const oldClaim = await ledger.claim(action.actionId, action.version);
    const restarted = new ActionLedger(join(dir, "ledger"));
    const running = await restarted.get(action.actionId);
    assert.equal(running?.state, "running");
    await assert.rejects(restarted.claim(action.actionId, oldClaim.version), /prepared/);
    await assert.rejects(restarted.recoverInterrupted(action.actionId, { expectedVersion: oldClaim.version, workerStopped: false as true, evidence }), /stopped/);
    const uncertain = await restarted.recoverInterrupted(action.actionId, { expectedVersion: oldClaim.version, workerStopped: true, evidence });
    assert.equal(uncertain.state, "needs-reconciliation");
    await assert.rejects(ledger.complete(oldClaim, { evidence }), /claim|stale/);
    await assert.rejects(restarted.reconcile(action.actionId, { expectedVersion: uncertain.version, resolution: "safe-to-retry", workerStopped: true, evidence: { summary: "guess", references: [] } }), /evidence/);
    const prepared = await restarted.reconcile(action.actionId, { expectedVersion: uncertain.version, resolution: "safe-to-retry", workerStopped: true, evidence });
    assert.equal(prepared.state, "prepared");
    const newClaim = await restarted.claim(action.actionId, prepared.version);
    assert.notEqual(newClaim.token, oldClaim.token);
    assert.equal((await restarted.get(action.actionId))?.attempt, 2);
    await assert.rejects(restarted.reconcile(action.actionId, { expectedVersion: uncertain.version, resolution: "completed", workerStopped: true, evidence }), /version|stale/);
  });
});

test("uncertain and definite failure are distinct and never automatically replayed", async () => {
  await fixture(async (_dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "pull-request", input: { branch: "candidate" } });
    const claim = await ledger.claim(action.actionId, action.version);
    const uncertain = await ledger.markUncertain(claim, { evidence });
    const completed = await ledger.reconcile(action.actionId, { expectedVersion: uncertain.version, resolution: "completed", workerStopped: true, evidence, result: { url: "https://example.invalid/pr/1" } });
    assert.equal(completed.state, "completed");
    assert.equal(completed.history.at(-1)?.resolution, "completed");
    const another = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-apply", input: {} });
    const failed = await ledger.fail(await ledger.claim(another.actionId, another.version), { evidence });
    assert.equal(failed.state, "failed");
    await assert.rejects(ledger.claim(another.actionId, failed.version), /prepared/);
  });
});

test("non-JSON, oversized input and empty evidence fail without altering durable state", async () => {
  await fixture(async (_dir, ledger) => {
    for (const input of [{ bad: undefined }, { bad: Number.NaN }, { text: "x".repeat(70_000) }]) {
      await assert.rejects(ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-write", input }));
    }
    assert.deepEqual(await ledger.list(), []);
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-check", input: {} });
    const claim = await ledger.claim(action.actionId, action.version);
    await assert.rejects(ledger.complete(claim, { evidence: { summary: "model says done", references: [] } }), /evidence/);
    assert.equal((await ledger.get(action.actionId))?.state, "running");
  });
});

test("corrupt, duplicate and unknown-schema durable snapshots fail closed and remain intact", async () => {
  await fixture(async (dir, ledger) => {
    await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-write", input: {} });
    const file = join(dir, "ledger", "actions.json");
    const valid = await readFile(file, "utf8");
    const parsed = JSON.parse(valid);
    for (const bad of ['{"schemaVersion":', JSON.stringify({ ...parsed, schemaVersion: 99 }), JSON.stringify({ ...parsed, actions: [...parsed.actions, parsed.actions[0]] })]) {
      await writeFile(file, bad);
      await assert.rejects(ledger.list(), /action|JSON|schema|canonical|duplicate/);
      assert.equal(await readFile(file, "utf8"), bad);
    }
  });
});

test("canonical persisted records reject unknown fields and impossible prepared transition metadata", async () => {
  await fixture(async (dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-write", input: {} });
    const file = join(dir, "ledger", "actions.json");
    const valid = JSON.parse(await readFile(file, "utf8"));
    const corruptions = [
      { ...valid, authority: "model" },
      { ...valid, actions: [{ ...valid.actions[0], accepted: true }] },
      ...[
        { resolution: "completed" }, { workerStopped: true }, { evidence }, { unsupported: true }
      ].map((extra) => ({ ...valid, actions: [{ ...valid.actions[0], history: [{ ...valid.actions[0].history[0], ...extra }] }] }))
    ];
    for (const bad of corruptions) {
      const bytes = canonicalizeStableJson(bad);
      await writeFile(file, bytes);
      await assert.rejects(ledger.list(), /unknown|prepared|metadata/);
      assert.equal(await readFile(file, "utf8"), bytes);
    }
    await writeFile(file, canonicalizeStableJson(valid));
    await ledger.claim(action.actionId, action.version);
    const running = JSON.parse(await readFile(file, "utf8"));
    running.actions[0].history[1].workerStopped = true;
    await writeFile(file, canonicalizeStableJson(running));
    await assert.rejects(ledger.list(), /metadata|attestation/);
  });
});

test("failed result persistence does not report completion or permit replay", async () => {
  await fixture(async (dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-apply", input: {} });
    const claim = await ledger.claim(action.actionId, action.version);
    const file = join(dir, "ledger", "actions.json");
    const bytes = await readFile(file);
    await rm(file);
    await mkdir(file);
    await assert.rejects(ledger.complete(claim, { evidence }));
    await rm(file, { recursive: true });
    await writeFile(file, bytes);
    assert.equal((await ledger.get(action.actionId))?.state, "running");
    await assert.rejects(ledger.claim(action.actionId, claim.version), /prepared/);
  });
});

test("symlink snapshots are refused", { skip: process.platform === "win32" }, async () => {
  await fixture(async (dir, ledger) => {
    await mkdir(join(dir, "ledger"), { recursive: true });
    const external = join(dir, "external.json");
    await writeFile(external, "{}");
    await symlink(external, join(dir, "ledger", "actions.json"));
    await assert.rejects(ledger.list(), /regular file|symlink/);
    assert.equal(await readFile(external, "utf8"), "{}");
  });
});

test("subprocess death after actual effect is reconciled without replaying the effect", { timeout: 15_000 }, async () => {
  await fixture(async (dir, ledger) => {
    const action = await ledger.prepare({ idempotencyKey: createActionIdempotencyKey(), kind: "candidate-write", input: { receipt: join(dir, "effect.json") } });
    const modulePath = resolve("src/development/action-ledger.ts");
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { ActionLedger } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      import { writeFile } from 'node:fs/promises';
      const ledger = new ActionLedger(${JSON.stringify(join(dir, "ledger"))});
      const claim = await ledger.claim(${JSON.stringify(action.actionId)}, ${action.version});
      await writeFile(${JSON.stringify(join(dir, "effect.json"))}, JSON.stringify({actionId:claim.actionId,idempotencyKey:claim.idempotencyKey,count:1}));
      process.stdout.write('EFFECT_COMMITTED\\n');
      setInterval(() => {}, 1000);
    `], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (part) => { stderr += String(part); });
    const exited = new Promise<void>((done) => child.once("close", () => done()));
    try {
      await new Promise<void>((done, reject) => {
        let output = "";
        const deadline = setTimeout(() => reject(new Error(`effect fixture readiness timeout: ${stderr}`)), 8_000);
        child.once("error", (error) => { clearTimeout(deadline); reject(error); });
        child.once("exit", () => { clearTimeout(deadline); reject(new Error(`fixture exited before ready: ${stderr}`)); });
        child.stdout.on("data", (part) => {
          output += String(part);
          if (output.includes("EFFECT_COMMITTED")) { clearTimeout(deadline); done(); }
        });
      });
      child.kill("SIGKILL");
      await exited;
      const restarted = new ActionLedger(join(dir, "ledger"));
      const before = await restarted.get(action.actionId);
      assert.equal(before?.state, "running");
      await assert.rejects(restarted.claim(action.actionId, before!.version), /prepared/);
      const receipt = JSON.parse(await readFile(join(dir, "effect.json"), "utf8"));
      assert.equal(receipt.actionId, action.actionId);
      const uncertain = await restarted.recoverInterrupted(action.actionId, { expectedVersion: before!.version, workerStopped: true, evidence: { summary: "Subprocess close observed", references: ["effect.json"] } });
      const complete = await restarted.reconcile(action.actionId, { expectedVersion: uncertain.version, resolution: "completed", workerStopped: true, evidence, result: receipt });
      assert.equal(complete.state, "completed");
      assert.equal(JSON.parse(await readFile(join(dir, "effect.json"), "utf8")).count, 1);
      assert.equal((await restarted.prepare({ idempotencyKey: action.idempotencyKey, kind: action.kind, input: JSON.parse(action.inputCanonicalJson) })).state, "completed");
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  });
});
