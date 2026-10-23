import { readPinnedPiVersions } from "../../../src/pi-compat/check.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { stageManagedCandidate, type ManagedCandidate } from "../../../src/pi-adapter/managed/candidate.js";

const repository = process.cwd();
const pins = readPinnedPiVersions(JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")));
const versions = { core: pins.agentCore, ai: pins.ai };
interface QualificationModule {
  qualifyManagedCandidate(options: { managerRoot: string; candidate: ManagedCandidate; signal?: AbortSignal; timeoutMs?: number }): Promise<Result>;
  lookupIssuedManagedQualification(result: unknown, managerRoot: string): Record<string, unknown>;
  validateManagedQualificationRecord(value: unknown): Record<string, unknown>;
}
interface Result { status: "qualified" | "failed"; reason?: string; record?: { observations: Record<string, unknown>[]; [key: string]: unknown }; command?: { status: string; cleanupUnsettled?: true; spawned: boolean } }
async function qualificationModule(): Promise<QualificationModule> {
  const module = await import(pathToFileURL(path.join(repository, "src/pi-adapter/managed/qualification.ts")).href).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }) as Partial<QualificationModule>;
  assert.equal(typeof module.qualifyManagedCandidate, "function", "actual managed qualification launcher must exist");
  assert.equal(typeof module.lookupIssuedManagedQualification, "function", "private issuance lookup must exist");
  return module as QualificationModule;
}
async function manager(t: TestContext): Promise<string> {
  const parent = path.join(repository, ".agent_workspace/managed-qualification-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  await mkdir(path.join(root, "generations"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return root;
}
async function json(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), "utf8");
}
async function freshBuild(root: string): Promise<void> {
  const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: repository, env: { ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }), HOME: root, USERPROFILE: root, TEMP: root, TMP: root },
    encoding: "utf8", timeout: 60_000, maxBuffer: 512 * 1024, windowsHide: true
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
async function controlCandidate(root: string, code: string): Promise<ManagedCandidate> {
  const program = await mkdtemp(path.join(root, "program-"));
  await mkdir(path.join(program, "dist/pi-adapter/managed"), { recursive: true });
  await json(path.join(program, "package.json"), { name: "qualification-control", version: "1.0.0", type: "module", dependencies: { "@earendil-works/pi-agent-core": versions.core, "@earendil-works/pi-ai": versions.ai } });
  for (const name of ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai"]) {
    await json(path.join(program, "node_modules", name, "package.json"), { name, version: name === "@earendil-works/pi-agent-core" ? versions.core : versions.ai, type: "module" });
  }
  await writeFile(path.join(program, "dist/pi-adapter/managed/bootstrap.js"), await readFile(path.join(repository, "dist/pi-adapter/managed/bootstrap.js"), "utf8"), "utf8");
  await writeFile(path.join(program, "dist/pi-adapter/managed/qualification-worker.js"), code, "utf8");
  return stageManagedCandidate({ programRoot: program, generationsRoot: path.join(root, "generations"), expectedVersions: versions });
}

test("actual staged five-case qualification issues only the launched, validated result", { timeout: 180_000 }, async (t) => {
  const api = await qualificationModule();
  const root = await manager(t);
  await freshBuild(root);
  const candidate = await stageManagedCandidate({ programRoot: repository, generationsRoot: path.join(root, "generations"), expectedVersions: versions });
  const result = await api.qualifyManagedCandidate({ managerRoot: root, candidate });
  if (result.status === "failed") t.diagnostic(JSON.stringify(result));
  assert.equal(result.status, "qualified", result.reason ?? "");
  assert.ok(result.record);
  assert.deepEqual(result.record.observations.map((item) => item.scenario), ["priced-stop", "unpriced-cap", "preabort", "blocked-tool-cancel", "deferred-agent-end"]);
  const priced = result.record.observations[0]!;
  assert.equal(priced.providerDispatches, 1);
  assert.equal(priced.toolCompletions, 1);
  assert.deepEqual(priced.invocation, { outcome: "ok", tokensIn: 371, tokensOut: 4, cacheHit: false });
  const cancelled = result.record.observations[3]!;
  assert.equal(cancelled.streamEntries, 2);
  assert.equal(cancelled.providerDispatches, 1);
  assert.deepEqual(cancelled.turns, [{ inputTokens: 374, outputTokens: 4 }, null]);
  assert.deepEqual(cancelled.invocation, { outcome: "cancelled", tokensIn: null, tokensOut: null, cacheHit: null });
  assert.deepEqual(cancelled.held, { runSettled: false, toolStarts: 1, toolCompletions: 0, toolSignalAborted: true, providerDispatches: 1, taskResults: 0, executionFinished: 0, invocations: 0 });
  const record = api.lookupIssuedManagedQualification(result, root);
  assert.equal(record.generationId, candidate.generationId);
  assert.equal(record.candidateRoot, candidate.root);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.record.observations));
  assert.ok(Object.isFrozen(record));
  assert.throws(() => { (record.versions as { core: string }).core = "0.0.0"; }, TypeError);
  assert.notEqual(api.lookupIssuedManagedQualification(result, root), record);
  for (const copy of [{ ...result }, JSON.parse(JSON.stringify(result)), structuredClone(result), { status: "qualified", record }, null]) {
    assert.throws(() => api.lookupIssuedManagedQualification(copy, root), /issued/);
  }
  await t.test("qualification snapshots caller-owned candidate identity before asynchronous work", async () => {
    const mutable = { ...candidate, versions: { ...candidate.versions } };
    const pending = api.qualifyManagedCandidate({ managerRoot: root, candidate: mutable });
    mutable.generationId = "changed-after-call";
    mutable.root = root;
    mutable.appRoot = root;
    mutable.versions.core = "0.0.0";
    const snapshot = await pending;
    assert.equal(snapshot.status, "qualified", snapshot.reason ?? "");
    assert.equal(snapshot.record?.generationId, candidate.generationId);
    assert.deepEqual(snapshot.record?.versions, versions);
  });
  await t.test("persisted record validator checks data without issuing approval authority", () => {
    assert.equal(typeof api.validateManagedQualificationRecord, "function", "data-only persisted validation must exist");
    const validated = api.validateManagedQualificationRecord(JSON.parse(JSON.stringify(result.record)));
    assert.ok(Object.isFrozen(validated));
    assert.throws(() => api.lookupIssuedManagedQualification(validated, root), /issued/);
    const wrong = structuredClone(result.record!);
    wrong.observations[3]!.providerDispatches = 2;
    assert.throws(() => api.validateManagedQualificationRecord(wrong), /dispatches/);
  });
  const otherRoot = await manager(t);
  assert.throws(() => api.lookupIssuedManagedQualification(result, otherRoot), /manager/);

  await t.test("fixed worker receives isolated directories and no parent credential or Node injection", async () => {
    const sentinel = "managed-parent-secret";
    const inherited = ["MANAGED_QUALIFICATION_SECRET", "NODE_OPTIONS", "NODE_PATH", "NODE_V8_COVERAGE", "OPENAI_API_KEY"] as const;
    const saved = inherited.map((key) => [key, process.env[key]] as const);
    process.env.MANAGED_QUALIFICATION_SECRET = sentinel;
    process.env.NODE_OPTIONS = "--require=must-not-exist-managed";
    process.env.NODE_PATH = path.join(root, "outside-modules");
    process.env.NODE_V8_COVERAGE = path.join(root, "outside-coverage");
    process.env.OPENAI_API_KEY = sentinel;
    try {
      const control = await controlCandidate(root, 'process.stdout.write(JSON.stringify({ env: process.env, cwd: process.cwd() }));');
      const rejected = await api.qualifyManagedCandidate({ managerRoot: root, candidate: control });
      assert.equal(rejected.status, "failed");
      const command = rejected.command as unknown as { stdoutText: string };
      const observed = JSON.parse(command.stdoutText) as { env: Record<string, string>; cwd: string };
      assert.equal(observed.env.MANAGED_QUALIFICATION_SECRET, undefined);
      assert.equal(observed.env.OPENAI_API_KEY, undefined);
      assert.equal(observed.env.NODE_OPTIONS, "");
      assert.equal(observed.env.NODE_PATH, "");
      assert.equal(observed.env.PATH, "");
      for (const key of ["NODE_V8_COVERAGE", "LOGONSERVER", "USERNAME", "USERDOMAIN"]) assert.equal(observed.env[key], "");
      assert.ok(observed.env.HOME?.startsWith(root));
      assert.equal(observed.cwd.startsWith(candidate.root), false);
      assert.equal(observed.cwd.startsWith(root), true);
    } finally {
      for (const [key, prior] of saved) { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
    }
  });

  await t.test("malformed, duplicate, missing, mismatched and altered observations cannot qualify", async (t) => {
    const identity = 'generationId: process.argv[2].split(/[\\\\/]/).at(-1), candidateRoot: process.argv[2]';
    const observations = result.record!.observations;
    const altered = structuredClone(observations);
    altered[3]!.providerDispatches = 2;
    const cases = [
      ["malformed", 'process.stdout.write("{");'],
      ["extra JSON record", 'process.stdout.write("{}\\n{}");'],
      ["nonzero exit", 'process.exitCode = 7;'],
      ["pass boolean", 'process.stdout.write(JSON.stringify({pass:true}));'],
      ["missing", `process.stdout.write(JSON.stringify({${identity}, versions:${JSON.stringify(versions)}, observations:[]}));`],
      ["duplicate", `process.stdout.write(JSON.stringify({${identity}, versions:${JSON.stringify(versions)}, observations:${JSON.stringify([observations[0], observations[0], ...observations.slice(2)])}}));`],
      ["wrong identity", `process.stdout.write(JSON.stringify({generationId:"wrong", candidateRoot:process.argv[2], versions:${JSON.stringify(versions)}, observations:${JSON.stringify(observations)}}));`],
      ["later dispatch", `process.stdout.write(JSON.stringify({${identity}, versions:${JSON.stringify(versions)}, observations:${JSON.stringify(altered)}}));`]
    ];
    for (const [name, code] of cases) await t.test(name!, async () => {
      const control = await controlCandidate(root, code!);
      const failed = await api.qualifyManagedCandidate({ managerRoot: root, candidate: control });
      assert.equal(failed.status, "failed");
      assert.throws(() => api.lookupIssuedManagedQualification(failed, root), /issued/);
    });
  });

  await t.test("timeout, output overflow and cancellation preserve unknown cleanup and never issue", async (t) => {
    for (const [name, code, timeoutMs] of [["timed_out", 'await new Promise(resolve => setTimeout(resolve, 1000));', 30], ["output_limit", 'process.stdout.write("x".repeat(100000));', 5000], ["output_limit", 'process.stderr.write("x".repeat(100000));', 5000]] as const) {
      await t.test(name, async () => {
        const control = await controlCandidate(root, code);
        const failed = await api.qualifyManagedCandidate({ managerRoot: root, candidate: control, timeoutMs });
        assert.equal(failed.status, "failed");
        assert.equal(failed.command?.status, name);
        assert.equal(failed.command.cleanupUnsettled, true);
        assert.throws(() => api.lookupIssuedManagedQualification(failed, root), /issued/);
      });
    }
    const control = await controlCandidate(root, 'await new Promise(resolve => setTimeout(resolve, 1000));');
    const controller = new AbortController();
    const pending = api.qualifyManagedCandidate({ managerRoot: root, candidate: control, signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const failed = await pending;
      assert.equal(failed.status, "failed");
      assert.equal(failed.command?.status, "cancelled");
      assert.equal(failed.command.cleanupUnsettled, true);
    } finally { clearTimeout(timer); }
  });

  await t.test("candidate and timeout input cannot redirect a fixed worker", async () => {
    for (const changed of [{ ...candidate, generationId: "../escape" }, { ...candidate, root: path.join(root, "program") }, { ...candidate, appRoot: root }, { ...candidate, versions: { ...versions, core: "0.0.0" } }]) {
      assert.equal((await api.qualifyManagedCandidate({ managerRoot: root, candidate: changed })).status, "failed");
    }
    for (const timeoutMs of [0, -1, Infinity, 0.5, 2 ** 31]) {
      assert.equal((await api.qualifyManagedCandidate({ managerRoot: root, candidate, timeoutMs })).status, "failed");
    }
  });
});
