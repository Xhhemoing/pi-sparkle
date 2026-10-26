import assert from "node:assert/strict";
import cp, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ActionLedger, type ActionClaim, type ActionReceipt } from "../../../src/development/action-ledger.js";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import type { NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { physicalDirectoryWithoutLinks } from "../../../src/native/physical-directory.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
async function fixture() {
  const parent = path.resolve(".agent_workspace/phase1-task-session"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "owner-")), sourceRepo = path.join(root, "source"), stateRoot = path.join(root, "state");
  await mkdir(path.join(sourceRepo, "checks"), { recursive: true });
  await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
  await writeFile(path.join(sourceRepo, "checks/check.cjs"), "const f=require('node:fs');f.appendFileSync(process.argv[2],'checked\\n');if(f.readFileSync('value.txt','utf8')!=='after'){console.log(JSON.stringify({assertion:'value-regression',outcome:'failed'}));process.exit(1)}", "utf8");
  git(sourceRepo, ["init", "-b", "fixture"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
  git(sourceRepo, ["config", "user.name", "Lifecycle fixture"]); git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(sourceRepo, ["rev-parse", "HEAD"]), counter = path.join(root, "check-count.txt");
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Change value using the owned candidate", context: ["value.txt"],
    write: { allow: ["value.txt", "checks"], protect: ["checks"] }, checks: [{ id: "business", command: process.execPath,
      args: ["checks/check.cjs", counter], verifierVersion: "v1", protectedPaths: ["checks"], expect: { baseline: "fail", failureAssertion: "value-regression" } }],
    budget: { totalSeconds: 40, prepareSeconds: 5, checkSeconds: 8, workerSeconds: 8 } });
  const { TaskSpecSession } = await import("../../../src/development/task-session.js");
  const create = (ledger?: ActionLedger) => new TaskSpecSession({ stateRoot, sandboxRoot: path.join(root, "candidates"), ...(ledger === undefined ? {} : { ledger }) });
  const factory = (after = "after"): NativeWriteExecutorFactory => context => ({ async *execute(request, signal) {
    await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: after }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } });
  const count = async () => (await readFile(counter, "utf8")).trim().split("\n").length;
  return { root, sourceRepo, stateRoot, revision, spec, create, factory, count };
}

test("live TaskSpec apply rechecks and persists its target before source mutation; repeat never replays", { timeout: 120000 }, async () => {
  const f = await fixture(); let checkpoints = 0;
  class WatchingLedger extends ActionLedger {
    override async checkpoint(claim: ActionClaim, receipt: ActionReceipt) {
      const action = await this.get(claim.actionId);
      if (action?.kind === "candidate-apply") {
        checkpoints++; assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision);
        assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
      } else {
        assert.equal(action?.kind, "candidate-discard");
        assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "after");
        await access((receipt.result as { candidatePath: string }).candidatePath);
      }
      const next = await super.checkpoint(claim, receipt);
      assert.equal(JSON.parse((await this.get(next.actionId))!.resultCanonicalJson!).sourceRevision, f.revision);
      return next;
    }
  }
  const session = f.create(new WatchingLedger(path.join(f.root, "ledger")));
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    assert.equal(run.accepted, true); assert.equal(await f.count(), 2);
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision);
    const applied = await session.apply(run.runId);
    assert.equal(applied.status, "APPLIED"); assert.equal(applied.reverified, true); assert.equal(checkpoints, 1); assert.equal(await f.count(), 3);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "after");
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), applied.appliedRevision);
    const repeated = await session.apply(run.runId);
    assert.equal(repeated.appliedRevision, applied.appliedRevision); assert.equal(repeated.alreadyRecorded, true); assert.equal(await f.count(), 3);
    const discarded = await session.discard(run.runId); assert.equal(discarded.status, "DISPOSED");
    await assert.rejects(access(run.candidatePath), { code: "ENOENT" }); await access(run.artifactPath);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "after");
  } finally { await session.shutdown(); }
});

for (const after of ["after", "still refused"]) test(`explicit discard removes an unchanged settled ${after === "after" ? "accepted" : "refused"} candidate only`, { timeout: 120000 }, async () => {
  const f = await fixture(), session = f.create();
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory(after) });
    assert.equal(run.accepted, after === "after"); assert.equal(run.effectsSettled, true);
    if (!run.accepted) await assert.rejects(session.apply(run.runId), /accepted/);
    assert.equal((await session.discard(run.runId)).status, "DISPOSED");
    await assert.rejects(access(run.candidatePath), { code: "ENOENT" }); await access(run.artifactPath);
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
  } finally { await session.shutdown(); }
});

test("foreign owner and serialized result never grant TaskSpec lifecycle authority", { timeout: 120000 }, async () => {
  const f = await fixture(), session = f.create(), other = f.create();
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    const copy = JSON.parse(JSON.stringify(run));
    await assert.rejects(other.apply(copy.runId), /live|held|managed/);
    await assert.rejects(other.discard(copy.runId), /live|held|managed/);
    await assert.rejects(session.apply(copy), /run|identity/);
    assert.equal(await f.count(), 2); await access(run.candidatePath);
  } finally { await Promise.all([session.shutdown(), other.shutdown()]); }
});

for (const changed of ["source-dirty", "source-branch", "candidate", "protected", "index", "locked"] as const) test(`live apply/discard refuse ${changed} changes and retain evidence`, { timeout: 120000 }, async () => {
  const f = await fixture(), session = f.create();
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    if (changed === "source-dirty") await writeFile(path.join(f.sourceRepo, "value.txt"), "user source change", "utf8");
    if (changed === "source-branch") git(f.sourceRepo, ["switch", "-c", "other"]);
    if (changed === "candidate") await writeFile(path.join(run.candidatePath, "extra.txt"), "user extra", "utf8");
    if (changed === "protected") await writeFile(path.join(run.candidatePath, "checks/check.cjs"), "process.exit(0)", "utf8");
    if (changed === "index") git(run.candidatePath, ["add", "value.txt"]);
    if (changed === "locked") git(f.sourceRepo, ["worktree", "lock", run.candidatePath]);
    await assert.rejects(session.apply(run.runId));
    // Source branch/bytes do not grant permission to delete unrelated source data;
    // candidate mutations and locks must also refuse explicit candidate removal.
    if (!["source-dirty", "source-branch"].includes(changed)) await assert.rejects(session.discard(run.runId));
    await access(run.candidatePath); await access(run.artifactPath); assert.equal(await f.count(), 2);
  } finally { await session.shutdown(); }
});

for (const failAt of ["checkpoint", "complete"] as const) test(`apply ${failAt} publication failure latches reconciliation and blocks replay/discard`, { timeout: 120000 }, async () => {
  const f = await fixture();
  let failuresInjected = 0;
  class FailingLedger extends ActionLedger {
    override async checkpoint(claim: ActionClaim, receipt: ActionReceipt) {
      if (failAt === "checkpoint") { failuresInjected++; throw new Error("private checkpoint publication failure"); }
      return super.checkpoint(claim, receipt);
    }
    override async complete(claim: ActionClaim, receipt: ActionReceipt) {
      if (failAt === "complete") { failuresInjected++; throw new Error("private completion publication failure"); }
      return super.complete(claim, receipt);
    }
  }
  const ledger = new FailingLedger(path.join(f.root, "ledger")), session = f.create(ledger);
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    await assert.rejects(session.apply(run.runId), /reconciliation|publication/);
    assert.equal(failuresInjected, 1, "the selected real publication boundary must actually be reached");
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), failAt === "checkpoint" ? "before" : "after");
    await assert.rejects(session.apply(run.runId), /reconciliation/); await assert.rejects(session.discard(run.runId), /reconciliation/);
    assert.equal(await f.count(), 3); assert.equal((await ledger.list())[0]!.state, "needs-reconciliation");
    await access(run.candidatePath);
  } finally { await session.shutdown(); }
});

test("same-source unresolved ledger effects refuse apply and discard before another check or deletion", { timeout: 120000 }, async () => {
  const f = await fixture(), ledger = new ActionLedger(path.join(f.root, "ledger")), session = f.create(ledger);
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    const claim = await ledger.admit({ idempotencyKey: "older-effect", kind: "candidate-apply", input: { sourceRepo: f.sourceRepo } }, () => false);
    await ledger.markUncertain(claim, { evidence: { summary: "an earlier source effect is unresolved", references: [run.artifactPath] } });
    await assert.rejects(session.apply(run.runId), /reconciliation|admission/);
    await assert.rejects(session.discard(run.runId), /reconciliation|admission/);
    assert.equal(await f.count(), 2); await access(run.candidatePath);
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision);
  } finally { await session.shutdown(); }
});

for (const drift of ["extra", "protected", "branch"] as const) test(`apply rechecks original ownership after admission await: ${drift}`, { timeout: 120000 }, async () => {
  const f = await fixture(); let candidatePath = "", drifted = 0;
  class DriftingLedger extends ActionLedger {
    override async admit(...args: Parameters<ActionLedger["admit"]>) {
      const claim = await super.admit(...args);
      if (args[0].kind === "candidate-apply") {
        drifted++;
        if (drift === "extra") await writeFile(path.join(candidatePath, "outside.txt"), "later unowned file", "utf8");
        if (drift === "protected") await writeFile(path.join(candidatePath, "checks/check.cjs"), "process.exit(0)", "utf8");
        if (drift === "branch") git(f.sourceRepo, ["switch", "-c", "admission-drift"]);
      }
      return claim;
    }
  }
  const session = f.create(new DriftingLedger(path.join(f.root, "ledger")));
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() }); candidatePath = run.candidatePath;
    await assert.rejects(session.apply(run.runId), /reconciliation/);
    assert.equal(drifted, 1); assert.equal(await f.count(), 2, "stale ownership refuses before the fresh checker dispatch");
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before", "concurrent input changes must never reach source bytes");
    if (drift === "extra") assert.equal(await readFile(path.join(candidatePath, "outside.txt"), "utf8"), "later unowned file");
    if (drift === "protected") assert.equal(await readFile(path.join(candidatePath, "checks/check.cjs"), "utf8"), "process.exit(0)");
    if (drift === "branch") assert.equal(git(f.sourceRepo, ["branch", "--show-current"]), "admission-drift", "preserve the user's branch switch");
    await assert.rejects(session.discard(run.runId), /reconciliation/); await access(run.artifactPath); await access(candidatePath);
  } finally { await session.shutdown(); }
});

for (const changed of ["missing-path", "missing-record", "extra-directory"] as const) test(`applied discard refuses ${changed} without recovery or refreshed ownership`, { timeout: 120000 }, async () => {
  const f = await fixture(), session = f.create(), originalSpawn = cp.spawnSync; let prunes = 0;
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    await session.apply(run.runId);
    assert.equal(path.dirname(run.candidatePath), path.join(f.root, "candidates"), "only the private fixture candidate may be removed");
    if (changed === "missing-path") await rm(run.candidatePath, { recursive: true, force: true });
    if (changed === "missing-record") git(f.sourceRepo, ["worktree", "remove", "--force", run.candidatePath]);
    if (changed === "extra-directory") await mkdir(path.join(run.candidatePath, "later-user-directory"));
    cp.spawnSync = ((...args: Parameters<typeof cp.spawnSync>) => {
      const argv = args[1]; if (Array.isArray(argv) && argv.includes("worktree") && argv.includes("prune")) prunes++;
      return originalSpawn(...args);
    }) as typeof cp.spawnSync; syncBuiltinESMExports();
    await assert.rejects(session.discard(run.runId));
    assert.equal(prunes, 0, "the new user entry must never enter legacy prune recovery");
    if (changed === "extra-directory") await access(path.join(run.candidatePath, "later-user-directory"));
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "after"); await access(run.artifactPath);
  } finally { cp.spawnSync = originalSpawn; syncBuiltinESMExports(); await session.shutdown(); }
});

test("a live Windows case alias records canonical source identity and respects prior same-source uncertainty", { timeout: 120000, skip: process.platform !== "win32" }, async () => {
  const f = await fixture(), sourceAlias = path.join(path.dirname(f.sourceRepo), path.basename(f.sourceRepo).toUpperCase());
  assert.notEqual(sourceAlias, f.sourceRepo); assert.equal(git(sourceAlias, ["rev-parse", "HEAD"]), f.revision, "exercise a real filesystem alias");
  let observedSource: unknown;
  class InspectingLedger extends ActionLedger {
    override async admit(...args: Parameters<ActionLedger["admit"]>) {
      observedSource = (args[0].input as { sourceRepo: string }).sourceRepo;
      return super.admit(...args);
    }
  }
  const ledger = new InspectingLedger(path.join(f.root, "ledger")), session = f.create(ledger);
  const prior = await ledger.admit({ idempotencyKey: "prior-canonical-source", kind: "candidate-apply", input: { sourceRepo: physicalDirectoryWithoutLinks(f.sourceRepo) } }, () => false);
  await ledger.markUncertain(prior, { evidence: { summary: "prior canonical-source operation is unresolved", references: [f.sourceRepo] } });
  try {
    const run = await session.run({ sourceRepo: sourceAlias, spec: f.spec, executorFactory: f.factory() });
    await assert.rejects(session.apply(run.runId), /reconciliation|admission/);
    assert.equal(observedSource, physicalDirectoryWithoutLinks(f.sourceRepo), "canonicalize before creating the ledger binding");
    assert.equal(await f.count(), 2); await access(run.candidatePath);
  } finally { await session.shutdown(); }
});

test("shutdown awaits a held prepared checkpoint after cancellation and never checks out source", { timeout: 120000 }, async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  class HeldLedger extends ActionLedger {
    override async checkpoint(claim: ActionClaim, receipt: ActionReceipt) {
      const next = await super.checkpoint(claim, receipt); entered.resolve(); await release.promise; return next;
    }
  }
  const session = f.create(new HeldLedger(path.join(f.root, "ledger")));
  let applying: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    applying = session.apply(run.runId); const rejection = assert.rejects(applying, /reconciliation|abort|cancel/);
    await entered.promise; let settled = false; closing = session.shutdown().then(() => { settled = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
    release.resolve(); await Promise.all([rejection, closing]);
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision); await access(run.candidatePath);
  } finally { release.resolve(); await Promise.allSettled([...(applying ? [applying] : []), ...(closing ? [closing] : [])]); await session.shutdown(); }
});

test("an actual source ref publication failure stays uncertain and cannot replay", { timeout: 120000 }, async () => {
  const f = await fixture(), session = f.create(), originalSpawn = cp.spawnSync;
  let refusals = 0;
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec: f.spec, executorFactory: f.factory() });
    cp.spawnSync = ((...args: Parameters<typeof cp.spawnSync>) => {
      const argv = args[1];
      if (Array.isArray(argv) && argv.includes("update-ref") && argv.includes("refs/heads/fixture")) {
        refusals++; return { pid: 0, output: [], stdout: "", stderr: "synthetic ref publication failure", status: 1, signal: null };
      }
      return originalSpawn(...args);
    }) as typeof cp.spawnSync;
    syncBuiltinESMExports();
    await assert.rejects(session.apply(run.runId), /reconciliation/);
    await assert.rejects(session.apply(run.runId), /reconciliation/); await assert.rejects(session.discard(run.runId), /reconciliation/);
    assert.equal(refusals, 1); await access(run.candidatePath);
  } finally { cp.spawnSync = originalSpawn; syncBuiltinESMExports(); await session.shutdown(); }
});

test("whole-candidate capacity supports managed TaskSpec run and apply above both old bounds", { timeout: 600000 }, async () => {
  const f = await fixture(), bulk = path.join(f.sourceRepo, "bulk");
  await mkdir(bulk);
  for (let index = 0; index < 1100; index++) await writeFile(path.join(bulk, `part-${index}.txt`), "synthetic", "utf8");
  await writeFile(path.join(bulk, "payload.bin"), Buffer.alloc(17 * 1024 * 1024, 1));
  git(f.sourceRepo, ["add", "."]); git(f.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "large synthetic base"]);
  const revision = git(f.sourceRepo, ["rev-parse", "HEAD"]), session = f.create();
  const spec = snapshotDevelopmentTaskSpec({ ...f.spec, budget: { totalSeconds: 120, prepareSeconds: 30, checkSeconds: 30, workerSeconds: 30 } });
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec, executorFactory: f.factory() });
    assert.equal(run.accepted, true); assert.equal(run.managed, true); assert.equal(run.sourceRevision, revision);
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), revision); assert.equal(await f.count(), 2);
    const applied = await session.apply(run.runId);
    assert.equal(applied.status, "APPLIED"); assert.equal(applied.reverified, true); assert.equal(await f.count(), 3);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "after");
    assert.equal((await readFile(path.join(f.sourceRepo, "bulk/payload.bin"))).byteLength, 17 * 1024 * 1024);
    await access(run.artifactPath);
  } finally { await session.shutdown(); }
});

for (const bound of ["files", "bytes"] as const) test(`whole-candidate ${bound} overflow retains an accepted unmanaged TaskSpec without apply authority`, { timeout: 180000 }, async () => {
  const f = await fixture();
  await writeFile(path.join(f.sourceRepo, ".gitignore"), ".cache/\n", "utf8");
  git(f.sourceRepo, ["add", ".gitignore"]); git(f.sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "ignore candidate cache"]);
  const revision = git(f.sourceRepo, ["rev-parse", "HEAD"]), session = f.create();
  const code = "const f=require('node:fs');f.mkdirSync('.cache');" + (bound === "files"
    ? "for(let i=0;i<4097;i++)f.writeFileSync('.cache/part-'+i+'.txt','synthetic')"
    : "f.writeFileSync('.cache/payload.bin',Buffer.alloc(32*1024*1024+1,1))");
  const spec = snapshotDevelopmentTaskSpec({ ...f.spec, prepare: [{ id: "synthetic-cache", command: process.execPath, args: ["-e", code] }],
    budget: { totalSeconds: 120, prepareSeconds: 30, checkSeconds: 30, workerSeconds: 30 } });
  let factories = 0;
  try {
    const run = await session.run({ sourceRepo: f.sourceRepo, spec, executorFactory: context => { factories++; return f.factory()(context); } });
    assert.equal(factories, 1, "retain-only tasks still allocate their original executor after successful preparation and base checks");
    assert.equal(run.accepted, true); assert.equal(run.effectsSettled, true); assert.equal(run.managed, false);
    await assert.rejects(session.apply(run.runId), /managed/); await assert.rejects(session.discard(run.runId), /managed/);
    await access(run.artifactPath); await access(path.join(run.candidatePath, ".cache"));
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), revision);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
    await assert.rejects(access(path.join(f.sourceRepo, ".cache")), { code: "ENOENT" });
  } finally { await session.shutdown(); }
});
