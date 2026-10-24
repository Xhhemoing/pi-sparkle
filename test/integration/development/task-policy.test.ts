import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DevelopmentController } from "../../../src/development/controller.js";
import { startDevelopmentTask } from "../../../src/development/start-task.js";
import { createWorkQueue } from "../../../src/development/work-items.js";
import { WorkItemStore } from "../../../src/development/work-item-store.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import type { NativeWriteExecutorFactory } from "../../../src/native/write-session.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

const BEFORE = "before";
const AFTER = "after";
const GUARD = "protected before";
const OUTSIDE = "outside before";
interface Policy { readonly allowedScope: readonly string[]; readonly protectedPaths: readonly string[]; }
interface Fixture { root: string; sourceRepo: string; stateRoot: string; sandboxRoot: string; queuePath: string; marker: string; }

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function fixture(body: (value: Fixture) => Promise<void>, textGuard = false, autocrlf = false): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "sparkle-task-policy-"));
  const sourceRepo = path.join(root, "source");
  await mkdir(path.join(sourceRepo, "checks"), { recursive: true });
  const sandboxRoot = path.join(root, "candidates");
  await mkdir(sandboxRoot);
  git(sourceRepo, ["init"]);
  git(sourceRepo, ["config", "core.autocrlf", String(autocrlf)]);
  git(sourceRepo, ["config", "user.name", "Task policy fixture"]);
  git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  await writeFile(path.join(sourceRepo, ".gitignore"), "checks/*.tmp\n", "utf8");
  await writeFile(path.join(sourceRepo, "value.txt"), BEFORE, "utf8");
  await writeFile(path.join(sourceRepo, "outside.txt"), OUTSIDE, "utf8");
  if (textGuard) await writeFile(path.join(sourceRepo, ".gitattributes"), "checks/guard.txt text eol=lf\n", "utf8");
  await writeFile(path.join(sourceRepo, "checks", "guard.txt"), textGuard || autocrlf ? `${GUARD}\n` : GUARD, "utf8");
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const head = git(sourceRepo, ["rev-parse", "HEAD"]);
  try {
    await body({ root, sourceRepo, sandboxRoot, stateRoot: path.join(root, "state"),
      queuePath: path.join(root, "queue.json"), marker: path.join(root, "checker-ran.txt") });
  } finally {
    try {
      assert.equal(git(sourceRepo, ["rev-parse", "HEAD"]), head, "source HEAD must remain unchanged");
      assert.equal(git(sourceRepo, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]), "");
      assert.equal(await readFile(path.join(sourceRepo, "value.txt"), "utf8"), BEFORE);
      assert.equal(await readFile(path.join(sourceRepo, "outside.txt"), "utf8"), OUTSIDE);
      assert.equal(await readFile(path.join(sourceRepo, "checks", "guard.txt"), "utf8"), textGuard || autocrlf ? `${GUARD}\n` : GUARD);
    } finally {
      assert.equal(path.dirname(root), path.resolve(tmpdir()), "cleanup must stay inside the fixture temp directory");
      assert.ok(path.basename(root).startsWith("sparkle-task-policy-"));
      await rm(root, { recursive: true, force: true });
    }
  }
}

function checker(f: Fixture, created = false) {
  const args = ["-e", `const fs=require('node:fs'); if(fs.readFileSync('value.txt','utf8')!==${JSON.stringify(AFTER)})process.exit(1); ${created ? "if(fs.readFileSync('created.txt','utf8')!=='created')process.exit(2);" : ""} fs.appendFileSync(${JSON.stringify(f.marker)},'checked\\n');`];
  return { command: process.execPath, args };
}

function direct(f: Fixture, policy: Policy, executorFactory: NativeWriteExecutorFactory, created = false) {
  const check = checker(f, created);
  const trustedVerification = prepareTrustedVerification({ ...check,
    snapshotManifest: { includePrefixes: policy.protectedPaths, optionalIncludePrefixes: policy.allowedScope } });
  // Keep this as a variable: the old interface can run the behavioral RED without
  // importing a nonexistent module or requiring the new property in production.
  const input = { stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.sourceRepo,
    objective: "Update the allowed value", verification: { ...check, trustedVerification }, executorFactory,
    scopePolicy: policy };
  return startDevelopmentTask(input);
}

async function controller(f: Fixture, policy: Policy, executorFactory: NativeWriteExecutorFactory) {
  await new WorkItemStore(f.queuePath).create(createWorkQueue({ id: "policy", authorityRef: "host:test", items: [{
    id: "change", goal: "Update the allowed value", dependencies: [], priority: 90, allowedScope: policy.allowedScope,
    acceptance: [{ id: "contents", ...checker(f), verifierVersion: "v1", protectedPaths: policy.protectedPaths }]
  }] }));
  const owner = new DevelopmentController({ sourceRepo: f.sourceRepo, stateRoot: f.stateRoot,
    sandboxRoot: f.sandboxRoot, queuePath: f.queuePath, owner: "host:test", executorFactory });
  return { owner, result: await owner.runNext({ maxAttempts: 1 }) };
}

for (const toolName of ["sparkle_write_file", "sparkle_patch_file"] as const) {
  for (const target of ["outside.txt", "checks/guard.txt"] as const) {
    test(`direct ${toolName} refuses ${target} before changing candidate bytes`, async () => fixture(async (f) => {
      const policy = { allowedScope: ["value.txt", "checks"], protectedPaths: ["checks"] };
      let refused: unknown;
      let calls = 0;
      const result = await direct(f, policy, ({ tools }) => ({ async *execute(request, signal) {
        calls++;
        const tool = tools.find((entry) => entry.name === toolName)!;
        try {
          await tool.execute("forbidden", toolName === "sparkle_write_file"
            ? { path: target, contents: "tampered" }
            : { path: target, oldText: target === "outside.txt" ? OUTSIDE : GUARD, newText: "tampered" }, signal);
        } catch (error) { refused = error; }
        await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } }));
      assert.equal(calls, 1, "the real owned tool must have been invoked");
      assert.equal(await readFile(path.join(result.candidatePath, target), "utf8"), target === "outside.txt" ? OUTSIDE : GUARD,
        "forbidden tool must refuse before candidate bytes change");
      assert.ok(refused instanceof Error, "the forbidden write/patch must reject");
      assert.equal(result.acceptance.accepted, true, result.reason);
      assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
      assert.match(await readFile(f.marker, "utf8"), /checked/, "the legal continuation must pass the actual Node checker");
    }));
  }
}

for (const lane of ["direct", "controller"] as const) {
  test(`${lane} rejects missing protect before calling the executor factory`, async () => fixture(async (f) => {
    const policy = { allowedScope: ["value.txt", "created.txt"], protectedPaths: ["missing-checker-dependency"] };
    let factories = 0;
    const factory: NativeWriteExecutorFactory = ({ tools }) => {
      factories++;
      return { async *execute(request, signal) {
        await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
        yield* new ProtocolChildExecutor().execute(request, signal);
      } };
    };
    const outcome = await (lane === "direct" ? direct(f, policy, factory) : controller(f, policy, factory))
      .then((result) => ({ result }), (error: unknown) => ({ error }));
    assert.equal(factories, 0, "required protect must be validated before factory/provider allocation");
    if ("result" in outcome) {
      if ("acceptance" in outcome.result) assert.equal(outcome.result.acceptance.accepted, false);
      else assert.equal(outcome.result.result.status, "blocked");
    } else assert.ok(outcome.error instanceof Error);
    await assert.rejects(readFile(f.marker, "utf8"), { code: "ENOENT" });
  }));

  test(`${lane} rejects a filesystem bypass creating a Gitignored protected file`, async () => fixture(async (f) => {
    const policy = { allowedScope: ["value.txt", "created.txt"], protectedPaths: ["checks"] };
    let candidate: string | undefined;
    const factory: NativeWriteExecutorFactory = ({ candidatePath, tools }) => ({ async *execute(request, signal) {
      candidate = candidatePath;
      await writeFile(path.join(candidatePath, "checks", "hidden.tmp"), "bypass", "utf8");
      await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } });
    const outcome = lane === "direct" ? await direct(f, policy, factory) : (await controller(f, policy, factory)).result;
    assert.ok(candidate, "the filesystem bypass must actually execute");
    assert.equal(await readFile(path.join(candidate, "checks", "hidden.tmp"), "utf8"), "bypass");
    assert.equal(git(candidate, ["check-ignore", "checks/hidden.tmp"]), "checks/hidden.tmp");
    assert.equal(await readFile(path.join(candidate, "value.txt"), "utf8"), AFTER);
    if ("acceptance" in outcome) assert.equal(outcome.acceptance.accepted, false, "protected ignored additions must prevent acceptance");
    else assert.equal(outcome.status, "blocked", "protected ignored additions must prevent ready-for-review");
  }));
}

for (const create of [false, true]) {
  test(`direct optional allow may ${create ? "be legally created" : "remain absent"} through the actual checker`, async () => fixture(async (f) => {
    const policy = { allowedScope: ["value.txt", "created.txt", "optional.txt"], protectedPaths: ["checks"] };
    const result = await direct(f, policy, ({ tools }) => ({ async *execute(request, signal) {
      const write = tools.find((entry) => entry.name === "sparkle_write_file")!;
      await write.execute("legal", { path: "value.txt", contents: AFTER }, signal);
      if (create) await write.execute("new", { path: "created.txt", contents: "created" }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }), create);
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
    if (create) assert.equal(await readFile(path.join(result.candidatePath, "created.txt"), "utf8"), "created");
    else await assert.rejects(readFile(path.join(result.candidatePath, "created.txt")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(result.candidatePath, "optional.txt")), { code: "ENOENT" });
    assert.match(await readFile(f.marker, "utf8"), /checked/);
  }));
}

test("direct rejects protected raw-byte drift even when Git text normalization hides it", async (t) => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  let candidate: string | undefined;
  let original: string | undefined;
  const result = await direct(f, policy, ({ candidatePath, tools }) => ({ async *execute(request, signal) {
    candidate = candidatePath;
    original = await readFile(path.join(candidatePath, "checks", "guard.txt"), "utf8");
    await writeFile(path.join(candidatePath, "checks", "guard.txt"), `${GUARD}\r\n`, "utf8");
    // Refresh only the candidate index: the normalized blob stays identical,
    // while the protected worktree bytes must still remain the original LF.
    git(candidatePath, ["add", "--", "checks/guard.txt"]);
    await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  assert.ok(candidate, "the real filesystem bypass must run");
  if (original !== `${GUARD}\n`) {
    t.skip(`this Git checkout did not preserve the required initial LF bytes: ${JSON.stringify(original)}`);
    return;
  }
  assert.equal(original, `${GUARD}\n`, "the protected initial bytes must be LF");
  assert.equal(await readFile(path.join(candidate, "checks", "guard.txt"), "utf8"), `${GUARD}\r\n`);
  const diff = git(candidate, ["diff", "--", "checks/guard.txt"]);
  const status = git(candidate, ["status", "--porcelain=v1", "--", "checks/guard.txt"]);
  if (diff !== "" || status !== "") {
    t.skip(`this Git exposes the LF/CRLF change: ${JSON.stringify({ diff, status })}`);
    return;
  }
  assert.equal(diff, "", "Git must actually hide this byte change");
  assert.equal(status, "");
  assert.equal(result.acceptance.accepted, false, "protected raw-byte changes must prevent acceptance even when Git normalizes them");
}, true));

test("controller accept rechecks protected ignored additions after ready-for-review", async () => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const { owner, result } = await controller(f, policy, ({ tools }) => ({ async *execute(request, signal) {
    await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  assert.equal(result.status, "ready-for-review", result.reason ?? "");
  assert.ok(result.candidatePath);
  assert.match(await readFile(f.marker, "utf8"), /checked/, "the legitimate candidate must first pass the real Node checker");
  await writeFile(path.join(result.candidatePath, "checks", "hidden.tmp"), "after review checkpoint", "utf8");
  assert.equal(git(result.candidatePath, ["check-ignore", "checks/hidden.tmp"]), "checks/hidden.tmp");
  assert.equal(git(result.candidatePath, ["status", "--porcelain=v1", "--", "checks/hidden.tmp"]), "");
  const accepted = await owner.accept("change").then(() => true, () => false);
  const status = (await owner.status()).queue.items[0]?.status;
  assert.notEqual(status, "accepted", "post-review protected byte additions must never be adopted");
  assert.equal(accepted, false, "accept must refuse the mutated protected tree");
  assert.equal(await readFile(path.join(result.candidatePath, "checks", "hidden.tmp"), "utf8"), "after review checkpoint");
}));

for (const invalid of ["copied descriptor", "missing protected manifest", "mismatched argv"] as const) {
  test(`scoped verifier authority rejects ${invalid} before factory allocation`, async () => fixture(async (f) => {
    const scopePolicy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
    const check = checker(f);
    const original = prepareTrustedVerification({ ...check, snapshotManifest: {
      includePrefixes: invalid === "missing protected manifest" ? [] : scopePolicy.protectedPaths,
      optionalIncludePrefixes: scopePolicy.allowedScope
    } });
    const trustedVerification = invalid === "copied descriptor" ? { ...original } : original;
    let factories = 0;
    const input = { stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.sourceRepo,
      objective: "Keep host verification authoritative", scopePolicy,
      verification: { command: check.command, args: invalid === "mismatched argv" ? ["-e", "process.exit(0)"] : check.args,
        trustedVerification },
      executorFactory: (() => { factories++; throw new Error("invalid authority must not allocate a factory"); }) as NativeWriteExecutorFactory };
    await assert.rejects(startDevelopmentTask(input), /descriptor|verifier|manifest|command|argv/i);
    assert.equal(factories, 0);
    await assert.rejects(readFile(f.marker, "utf8"), { code: "ENOENT" });
  }));
}

test("caller policy array mutations after starting a task cannot widen owned-tool authority", async () => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const refusals: unknown[] = [];
  const pending = direct(f, policy, ({ tools }) => ({ async *execute(request, signal) {
    const write = tools.find((entry) => entry.name === "sparkle_write_file")!;
    for (const target of ["outside.txt", "checks/guard.txt"]) {
      try { await write.execute("forbidden-after-caller-mutation", { path: target, contents: "tampered" }, signal); }
      catch (error) { refusals.push(error); }
    }
    await write.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  policy.allowedScope.push("outside.txt", "checks");
  policy.protectedPaths.splice(0);
  const result = await pending;
  assert.equal(await readFile(path.join(result.candidatePath, "outside.txt"), "utf8"), OUTSIDE);
  assert.equal(await readFile(path.join(result.candidatePath, "checks", "guard.txt"), "utf8"), GUARD);
  assert.equal(refusals.length, 2, "the captured policy must reject both attempted permission expansions");
  assert.equal(result.acceptance.accepted, true, result.reason);
  assert.match(await readFile(f.marker, "utf8"), /checked/);
}));

for (const toolName of ["sparkle_write_file", "sparkle_patch_file"] as const) {
  test(`owned ${toolName} path getter cannot check one path and mutate another`, async () => fixture(async (f) => {
    const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
    let pathReads = 0;
    let refusal: unknown;
    const result = await direct(f, policy, ({ tools }) => ({ async *execute(request, signal) {
      const raw = Object.defineProperty(toolName === "sparkle_write_file" ? { contents: "tampered" }
        : { oldText: BEFORE, newText: "tampered" }, "path", {
        enumerable: true, get() { return pathReads++ === 0 ? "value.txt" : "outside.txt"; }
      });
      try { await tools.find((entry) => entry.name === toolName)!.execute("unstable-path", raw, signal); }
      catch (error) { refusal = error; }
      await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } }));
    assert.equal(await readFile(path.join(result.candidatePath, "outside.txt"), "utf8"), OUTSIDE,
      "re-reading the hostile getter must never redirect a real mutation outside the checked scope");
    assert.ok(refusal instanceof Error || pathReads === 1, "reject accessors or pass one captured path through the real tool");
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.match(await readFile(f.marker, "utf8"), /checked/);
  }));
}

test("repair attempts retain the original protected bytes after first-check feedback", async () => fixture(async (f) => {
  const scopePolicy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const check = checker(f);
  const trustedVerification = prepareTrustedVerification({ ...check, snapshotManifest: {
    includePrefixes: scopePolicy.protectedPaths, optionalIncludePrefixes: scopePolicy.allowedScope
  } });
  let factories = 0;
  let analyses = 0;
  let candidate: string | undefined;
  const executorFactory: NativeWriteExecutorFactory = ({ candidatePath, tools, attempt }) => {
    factories++;
    candidate = candidatePath;
    return { async *execute(request, signal) {
      await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("repair-value", {
        path: "value.txt", contents: attempt?.number === 1 ? "needs repair" : AFTER
      }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  };
  const input = { stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.sourceRepo,
    objective: "Repair an ordinary failed check without resetting protected bytes", scopePolicy,
    verification: { ...check, trustedVerification, repairableExitCodes: [1] }, maxAttempts: 2, executorFactory,
    checkFindingAnalysis: { analyze: async ({ feedback }: { feedback: { exitCode: number } }) => {
      analyses++;
      assert.equal(feedback.exitCode, 1, "the first real Node check must complete with an ordinary repairable failure");
      assert.ok(candidate);
      // Deterministic host-side injection after the first check completes and
      // before repair allocation; this tests observation lifetime, not sandboxing.
      assert.equal(await readFile(path.join(candidate, "checks", "guard.txt"), "utf8"), `${GUARD}\n`);
      await writeFile(path.join(candidate, "checks", "guard.txt"), `${GUARD}\r\n`, "utf8");
      git(candidate, ["add", "--", "checks/guard.txt"]);
      assert.equal(git(candidate, ["diff", "--", "checks/guard.txt"]), "");
      assert.equal(git(candidate, ["status", "--porcelain=v1", "--", "checks/guard.txt"]), "");
      return { summary: "ordinary check failure; protected bytes must retain their original observation" };
    } } };
  const result = await startDevelopmentTask(input);
  assert.equal(analyses, 1, "the real first-check feedback seam must run");
  assert.equal(result.loop?.attempts.length, 2, "the task must actually enter its repair attempt");
  assert.equal(factories, 1, "protected drift must refuse the next factory before it can redefine the initial bytes");
  assert.equal(await readFile(path.join(result.candidatePath, "checks", "guard.txt"), "utf8"), `${GUARD}\r\n`);
  assert.equal(result.acceptance.accepted, false, "repair cannot adopt first-attempt protected drift as a new baseline");
  await assert.rejects(readFile(f.marker, "utf8"), { code: "ENOENT" });
}, true));

test("controller accept refuses protected raw-byte drift hidden by Git normalization", async () => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const { result } = await controller(f, policy, ({ tools }) => ({ async *execute(request, signal) {
    await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  assert.equal(result.status, "ready-for-review", result.reason ?? "");
  assert.ok(result.candidatePath);
  const guard = path.join(result.candidatePath, "checks", "guard.txt");
  assert.equal(await readFile(guard, "utf8"), `${GUARD}\n`);
  assert.match(await readFile(f.marker, "utf8"), /checked/);
  await writeFile(guard, `${GUARD}\r\n`, "utf8");
  git(result.candidatePath, ["add", "--", "checks/guard.txt"]);
  assert.equal(git(result.candidatePath, ["diff", "--", "checks/guard.txt"]), "");
  assert.equal(git(result.candidatePath, ["status", "--porcelain=v1", "--", "checks/guard.txt"]), "");
  const owner = freshReviewer(f);
  const accepted = await owner.accept("change").then(() => true, () => false);
  assert.equal(await readFile(guard, "utf8"), `${GUARD}\r\n`, "the actual protected raw-byte drift must remain observable");
  assert.notEqual((await owner.status()).queue.items[0]?.status, "accepted", "normalized Git equality cannot authorize protected byte drift");
  assert.equal(accepted, false);
}, true));

test("scoped verification descriptor getter cannot substitute a weaker real host verifier", async () => fixture(async (f) => {
  const scopePolicy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const command = process.execPath;
  const args = ["-e", `const fs=require('node:fs'); if(fs.readFileSync('value.txt','utf8')!=='after')process.exit(1); fs.writeFileSync('checks/guard.txt','checker tampered'); fs.appendFileSync(${JSON.stringify(f.marker)},'checked');`];
  const matching = prepareTrustedVerification({ command, args,
    snapshotManifest: { includePrefixes: scopePolicy.protectedPaths, optionalIncludePrefixes: scopePolicy.allowedScope } });
  const weaker = prepareTrustedVerification({ command, args,
    snapshotManifest: { optionalIncludePrefixes: ["value.txt"] } });
  let descriptorReads = 0;
  let factories = 0;
  const verification = Object.defineProperty({ command, args }, "trustedVerification", {
    enumerable: true, get() { return descriptorReads++ === 0 ? matching : weaker; }
  });
  const executorFactory: NativeWriteExecutorFactory = ({ tools }) => {
    factories++;
    return { async *execute(request, signal) {
      await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
      yield* new ProtocolChildExecutor().execute(request, signal);
    } };
  };
  const input = { stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot, sourceRepo: f.sourceRepo,
    objective: "Never swap the host verifier after policy validation", scopePolicy, verification, executorFactory };
  const outcome = await startDevelopmentTask(input).then((result) => ({ result }), (error: unknown) => ({ error }));
  if ("error" in outcome) {
    assert.ok(outcome.error instanceof Error);
    return;
  }
  if (outcome.result.acceptance.accepted) {
    assert.equal(factories, 1);
    assert.ok(descriptorReads >= 2, "the attack must actually swap two original host-issued descriptors");
    assert.equal(await readFile(path.join(outcome.result.candidatePath, "checks", "guard.txt"), "utf8"), "checker tampered");
    assert.match(await readFile(f.marker, "utf8"), /checked/, "the actual weaker-manifest Node check must have run");
  }
  assert.equal(outcome.result.acceptance.accepted, false, "a descriptor accessor must not weaken protected verification during execution");
}));

function freshReviewer(f: Fixture): DevelopmentController {
  return new DevelopmentController({ sourceRepo: f.sourceRepo, stateRoot: f.stateRoot, sandboxRoot: f.sandboxRoot,
    queuePath: f.queuePath, owner: "host:fresh-review", executorFactory: () => { throw new Error("review must not allocate another worker"); } });
}

test("controller fresh accept permits unchanged protected CRLF bytes from normal autocrlf checkout", async () => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const { result } = await controller(f, policy, ({ tools }) => ({ async *execute(request, signal) {
    await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  assert.equal(git(f.sourceRepo, ["config", "--get", "core.autocrlf"]), "true");
  assert.equal(result.status, "ready-for-review", result.reason ?? "");
  assert.ok(result.candidatePath);
  assert.equal(await readFile(path.join(result.candidatePath, "checks", "guard.txt"), "utf8"), `${GUARD}\r\n`,
    "the real candidate checkout must contain legal CRLF, rather than just exercising another LF case");
  assert.equal(await readFile(path.join(f.sourceRepo, "checks", "guard.txt"), "utf8"), `${GUARD}\n`);
  assert.match(await readFile(f.marker, "utf8"), /checked/);
  const reviewer = freshReviewer(f);
  await reviewer.accept("change");
  assert.equal((await reviewer.status()).queue.items[0]?.status, "accepted");
  assert.equal(await readFile(path.join(result.candidatePath, "checks", "guard.txt"), "utf8"), `${GUARD}\r\n`);
  assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
}, false, true));

test("direct refuses committed out-of-scope changes even when candidate Git status is clean", async () => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const sourceHead = git(f.sourceRepo, ["rev-parse", "HEAD"]);
  const result = await direct(f, policy, ({ candidatePath, tools }) => ({ async *execute(request, signal) {
    await writeFile(path.join(candidatePath, "outside.txt"), "committed outside change", "utf8");
    await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    git(candidatePath, ["add", "--", "outside.txt", "value.txt"]);
    git(candidatePath, ["-c", "commit.gpgsign=false", "commit", "-m", "candidate outside bypass"]);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  assert.notEqual(git(result.candidatePath, ["rev-parse", "HEAD"]), sourceHead, "the bypass must actually be committed");
  assert.equal(git(result.candidatePath, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
  assert.equal(await readFile(path.join(result.candidatePath, "outside.txt"), "utf8"), "committed outside change");
  assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), AFTER);
  assert.equal(result.acceptance.accepted, false, "scope must include changes committed since the original source revision");
}));

test("fresh Controller accept refuses an outside-scope commit made after ready-for-review", async () => fixture(async (f) => {
  const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
  const sourceHead = git(f.sourceRepo, ["rev-parse", "HEAD"]);
  const { result } = await controller(f, policy, ({ tools }) => ({ async *execute(request, signal) {
    await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
    yield* new ProtocolChildExecutor().execute(request, signal);
  } }));
  assert.equal(result.status, "ready-for-review", result.reason ?? "");
  assert.ok(result.candidatePath);
  await writeFile(path.join(result.candidatePath, "outside.txt"), "committed after review", "utf8");
  git(result.candidatePath, ["add", "--", "outside.txt", "value.txt"]);
  git(result.candidatePath, ["-c", "commit.gpgsign=false", "commit", "-m", "post-review outside bypass"]);
  assert.notEqual(git(result.candidatePath, ["rev-parse", "HEAD"]), sourceHead);
  assert.equal(git(result.candidatePath, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
  const reviewer = freshReviewer(f);
  const accepted = await reviewer.accept("change").then(() => true, () => false);
  assert.equal(await readFile(path.join(result.candidatePath, "outside.txt"), "utf8"), "committed after review");
  assert.notEqual((await reviewer.status()).queue.items[0]?.status, "accepted", "a clean status cannot hide a committed scope violation");
  assert.equal(accepted, false);
}));

test("allow-only candidate commits remain valid for direct execution and fresh Controller acceptance", async () => {
  for (const lane of ["direct", "controller"] as const) {
    await fixture(async (f) => {
      const policy = { allowedScope: ["value.txt"], protectedPaths: ["checks"] };
      const sourceHead = git(f.sourceRepo, ["rev-parse", "HEAD"]);
      const factory: NativeWriteExecutorFactory = ({ candidatePath, tools }) => ({ async *execute(request, signal) {
        await tools.find((entry) => entry.name === "sparkle_write_file")!.execute("legal", { path: "value.txt", contents: AFTER }, signal);
        if (lane === "direct") {
          git(candidatePath, ["add", "--", "value.txt"]);
          git(candidatePath, ["-c", "commit.gpgsign=false", "commit", "-m", "legal candidate commit"]);
        }
        yield* new ProtocolChildExecutor().execute(request, signal);
      } });
      const candidatePath = lane === "direct" ? await (async () => {
        const result = await direct(f, policy, factory);
        assert.equal(result.acceptance.accepted, true, result.reason);
        return result.candidatePath;
      })() : await (async () => {
        const { result } = await controller(f, policy, factory);
        assert.equal(result.status, "ready-for-review", result.reason ?? "");
        assert.ok(result.candidatePath);
        // Preserve Controller's existing evidence binding: it first records a
        // legitimate ready candidate, then the host commits only allowed bytes.
        git(result.candidatePath, ["add", "--", "value.txt"]);
        git(result.candidatePath, ["-c", "commit.gpgsign=false", "commit", "-m", "legal review commit"]);
        const reviewer = freshReviewer(f);
        await reviewer.accept("change");
        assert.equal((await reviewer.status()).queue.items[0]?.status, "accepted");
        return result.candidatePath;
      })();
      assert.notEqual(git(candidatePath, ["rev-parse", "HEAD"]), sourceHead);
      assert.equal(git(candidatePath, ["diff", "--name-only", sourceHead, "HEAD"]), "value.txt");
      assert.equal(git(candidatePath, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
      assert.equal(await readFile(path.join(candidatePath, "value.txt"), "utf8"), AFTER);
      assert.equal(await readFile(path.join(candidatePath, "outside.txt"), "utf8"), OUTSIDE);
      assert.equal(await readFile(path.join(candidatePath, "checks", "guard.txt"), "utf8"), GUARD);
      assert.match(await readFile(f.marker, "utf8"), /checked/);
    });
  }
});
