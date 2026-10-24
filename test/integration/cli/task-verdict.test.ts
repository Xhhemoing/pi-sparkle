import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { main } from "../../../src/cli/main.js";
import { runTaskSpecPreflight } from "../../../src/development/task-preflight.js";
import { createProjectId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { closeClosedLoop, openClosedLoop, runClosedLoopCheck } from "../../../src/execution/closed-loop.js";
import { loopArtifactsDir } from "../../../src/execution/loop-artifact.js";
import { prepareTrustedVerification } from "../../../src/execution/trusted-verification.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent } from "../../helpers/event-factory.js";

const SECRET = "PRIVATE_CHECKER_DETAIL_do_not_publish";
let root: string, source: string, accepted: string, refused: string, incomplete: string, marker: string, preflight: string, businessRed: string;
let session: Awaited<ReturnType<typeof openClosedLoop>>;
function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: source, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function call(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "", stderr = "";
  const code = await main(["task", "verdict", ...args], { stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  return { code, stdout, stderr };
}
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sparkle-verdict-"));
  source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "value.txt"), "source stays unchanged\n", "utf8");
  await writeFile(path.join(source, "package.json"), "{}\n", "utf8");
  git(["init"]); git(["config", "user.email", "fixture@example.invalid"]); git(["config", "user.name", "Verdict fixture"]);
  git(["add", "."]); git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const stateRoot = path.join(root, "state"), runId = createRunId();
  const createdAt = parseIsoTimestamp("2026-10-24T00:00:00.000Z");
  await new EventStore(stateRoot, runId).append(makeEvent("RUN_CREATED", { run: {
    id: runId, projectId: createProjectId(), rootTaskId: createTaskId(), status: "PLANNING",
    limits: defaultRunLimits(), createdAt, updatedAt: createdAt
  } }, { runId }));
  session = await openClosedLoop({ sourceRepo: source, sandboxRoot: path.join(root, "sandboxes") });
  marker = path.join(root, "checker-runs.txt");
  for (const exit of [0, 1]) {
    const args = ["-e", `require('node:fs').appendFileSync(${JSON.stringify(marker)},'ran\\n');console.log('${SECRET}');console.error('${SECRET}');process.exit(${exit})`];
    const trustedVerification = prepareTrustedVerification({ command: process.execPath, args });
    const checked = await runClosedLoopCheck({ session, stateRoot, runId, command: process.execPath, args, trustedVerification, note: SECRET });
    assert.equal(checked.acceptance.accepted, exit === 0);
    if (exit === 0) incomplete = checked.artifact.path;
    for (const name of await readdir(loopArtifactsDir(stateRoot, runId))) {
      const file = path.join(loopArtifactsDir(stateRoot, runId), name);
      const record = JSON.parse(await readFile(file, "utf8"));
      if (record.body.artifactId === checked.artifact.id) {
        if (exit === 0) accepted = file; else refused = file;
      }
    }
  }
  assert.ok(accepted && refused && incomplete);
  const prepared = await runTaskSpecPreflight({ candidatePath: session.worktree.cwd, sourceRevision: git(["rev-parse", "HEAD"]),
    stateRoot: path.join(root, "preflight-state"), spec: { version: 1, objective: SECRET, context: ["package.json"],
      write: { allow: ["value.txt"], protect: ["package.json"] }, prepare: [], checks: [{ id: SECRET, command: process.execPath,
        args: ["-e", `console.log('${SECRET}')`], verifierVersion: "fixture-v1", protectedPaths: ["package.json"],
        visibleToWorker: false, expect: { baseline: "pass" } }], budget: { totalSeconds: 30, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } } });
  assert.equal(prepared.ok, true, prepared.reason);
  preflight = prepared.artifactPath;
  const business = await runTaskSpecPreflight({ candidatePath: session.worktree.cwd, sourceRevision: git(["rev-parse", "HEAD"]),
    stateRoot: path.join(root, "preflight-state"), spec: { version: 1, objective: SECRET, context: ["package.json"],
      write: { allow: ["value.txt"], protect: ["package.json"] }, prepare: [], checks: [{ id: SECRET, command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({assertion:'fixture-business-invariant',outcome:'failed'}));process.exit(1)"],
        verifierVersion: "fixture-v1", protectedPaths: ["package.json"], visibleToWorker: false,
        expect: { baseline: "fail", failureAssertion: "fixture-business-invariant" } }],
      budget: { totalSeconds: 30, prepareSeconds: 10, checkSeconds: 5, workerSeconds: 10 }, worker: { model: "inherit" } } });
  assert.equal(business.ok, true, business.reason);
  businessRed = business.artifactPath;
});
after(async () => {
  if (session) await closeClosedLoop(session);
  if (root) await rm(root, { recursive: true, force: true });
});

test("task verdict actual CLI reads historical accepted evidence without executing it", async () => {
  const beforeMarker = await readFile(marker, "utf8"), head = git(["rev-parse", "HEAD"]);
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", "task", "verdict", "--artifact", accepted, "--json"],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.historicalAcceptance.status, "accepted");
  assert.equal(report.currentSourceVerified, false);
  assert.equal(report.grantsAuthority, false);
  assert.equal(report.cost.status, "unknown");
  assert.equal(report.cost.usd, null);
  assert.equal(report.apply.status, "unobserved");
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(await readFile(marker, "utf8"), beforeMarker);
  assert.equal(git(["rev-parse", "HEAD"]), head);
  assert.equal(git(["status", "--porcelain=v1"]), "");
});

test("task verdict preserves refused and provisional history and does not infer acceptance from exit zero", async () => {
  const rejected = await call(["--artifact", refused, "--json"]);
  assert.equal(rejected.code, 0, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).historicalAcceptance.status, "refused");
  const provisional = await call(["--artifact", incomplete, "--json"]);
  assert.equal(provisional.code, 0, provisional.stderr);
  const report = JSON.parse(provisional.stdout);
  assert.equal(report.historicalAcceptance.status, "unobserved");
  assert.equal(report.evidence.state, "incomplete");
  assert.equal(report.process.exitCode, 0);
  assert.equal(report.recordedChecks.passed, 1);
  assert.equal(report.sourceRevision, null);
  assert.equal(report.apply.status, "unobserved");
});

test("task verdict actual TaskSpec preflight projects aggregated checks with no private IDs or output", async () => {
  const files = await readdir(root, { recursive: true }), beforeMarker = await readFile(marker, "utf8");
  const json = await call(["--artifact", preflight, "--json"]), markdown = await call(["--artifact", preflight, "--markdown"]);
  assert.equal(json.code, 0, json.stderr); assert.equal(markdown.code, 0, markdown.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.historicalAcceptance.status, "accepted");
  assert.equal(report.historicalAcceptance.scope, "preflight");
  assert.equal(report.recordedChecks.passed, 1);
  assert.equal(report.settlement, "settled");
  assert.match(markdown.stdout, /historicalAcceptance.status \| accepted/);
  assert.match(markdown.stdout, /historicalAcceptance.scope \| preflight/);
  assert.match(markdown.stdout, /cost.usd \| null/);
  for (const output of [json.stdout, markdown.stdout]) {
    assert.equal(output.includes(SECRET), false);
    assert.equal(output.includes("console.log"), false);
    assert.equal(output.includes("stdoutText"), false);
  }
  assert.deepEqual(await readdir(root, { recursive: true }), files);
  assert.equal(await readFile(marker, "utf8"), beforeMarker);
  assert.equal(await readFile(path.join(source, "value.txt"), "utf8"), "source stays unchanged\n");
});

async function rawFile(name: string, value: unknown): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}
async function envelopeFile(name: string, record: Record<string, unknown>): Promise<string> {
  record.byteLength = 0;
  for (;;) {
    const text = JSON.stringify(record), length = Buffer.byteLength(text);
    if (record.byteLength === length) return rawFile(name, record);
    record.byteLength = length;
  }
}
test("task verdict rejects contradictory historical acceptance", async t => {
  const base = JSON.parse(await readFile(preflight, "utf8"));
  const variants: [string, unknown][] = [
    ["failed-row-outer-ok", { ...base, checks: [{ ...base.checks[0], expected: false,
      result: { ...base.checks[0].result, ok: false, exitCode: 1 } }] }],
    ["cleanup-outer-settled", { ...base, checks: [{ ...base.checks[0],
      result: { ...base.checks[0].result, cleanupUnsettled: true } }] }],
    ["unobserved-outer-ok", { ...base, checks: [], unobservedChecks: [SECRET] }]
  ];
  const closed = JSON.parse(await readFile(accepted, "utf8"));
  closed.body.check.exitCode = 1; closed.body.check.processExitCode = 1;
  closed.body.acceptance.independentCheck.exitCode = 1; closed.body.acceptance.independentCheck.processExitCode = 1;
  variants.push(["closed-loop-ok-exit-one", closed]);
  const original = JSON.parse(await readFile(accepted, "utf8"));
  variants.push(["registration-command-mismatch", { ...original, body: { kind: "native-apply-registration", registrationSchema: 2,
    sourceRepo: source, result: { status: "COMPLETED", candidatePath: original.body.cwd, sourceRevision: git(["rev-parse", "HEAD"]),
      artifact: { id: original.body.artifactId }, acceptance: { ...original.body.acceptance, command: SECRET, args: [] } } } }]);
  for (const [name, value] of variants) await t.test(name, async () => {
    const record = value as Record<string, unknown>;
    const file = record.schemaVersion === undefined ? await rawFile(`${name}.json`, record) : await envelopeFile(`${name}.json`, record);
    const result = await call(["--artifact", file, "--json"]);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.evidence.state, "corrupt");
    assert.equal(report.historicalAcceptance.status, "unobserved");
    assert.equal(result.stdout.includes(SECRET), false);
  });
});

test("task verdict accepts an actual expected business RED without treating exit one as corrupt", async () => {
  const evidence = JSON.parse(await readFile(businessRed, "utf8"));
  assert.equal(evidence.checks[0].result.exitCode, 1);
  assert.equal(evidence.checks[0].result.ok, false);
  assert.equal(evidence.checks[0].expected, true);
  const result = await call(["--artifact", businessRed, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.evidence.state, "available");
  assert.equal(report.historicalAcceptance.status, "accepted");
  assert.equal(report.historicalAcceptance.scope, "preflight");
  assert.equal(report.recordedChecks.passed, 1);
  assert.equal(report.process.exitCode, 1);
  assert.equal(result.stdout.includes("fixture-business-invariant"), false);
});
test("task verdict distinguishes missing, malformed, oversized, unsupported and non-regular evidence", async () => {
  const malformed = path.join(root, "malformed.json"), oversized = path.join(root, "oversized.json"), invalidUtf8 = path.join(root, "invalid-utf8.json");
  await writeFile(malformed, `{${SECRET}`, "utf8");
  await writeFile(oversized, " ".repeat(2 * 1024 * 1024 + 1), "utf8");
  await writeFile(invalidUtf8, Buffer.from([0x7b, 0x22, 0xc0, 0x80, 0x22, 0x3a, 0x31, 0x7d]));
  const unsupported = await rawFile("unsupported.json", { kind: SECRET });
  for (const [file, state] of [[path.join(root, "missing.json"), "missing"], [malformed, "corrupt"], [oversized, "corrupt"],
    [invalidUtf8, "corrupt"], [unsupported, "unsupported"], [source, "unsafe"]]) {
    const result = await call(["--artifact", file!, "--json"]);
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.evidence.state, state);
    assert.equal(report.historicalAcceptance.status, "unobserved");
    assert.equal(result.stdout.includes(SECRET), false);
  }
});

test("task verdict rejects linked parents and leaf links without reading their target", async () => {
  const linked = path.join(root, "linked-source");
  await symlink(path.dirname(accepted), linked, process.platform === "win32" ? "junction" : "dir");
  const parent = await call(["--artifact", path.join(linked, path.basename(accepted)), "--json"]);
  assert.equal(parent.code, 1); assert.equal(JSON.parse(parent.stdout).evidence.state, "unsafe");
  // A directory link also exercises leaf-link refusal on unprivileged Windows.
  const leaf = await call(["--artifact", linked, "--json"]);
  assert.equal(leaf.code, 1); assert.equal(JSON.parse(leaf.stdout).evidence.state, "unsafe");
});

test("task verdict rejects corrupted envelopes and mismatched acceptance references", async () => {
  const record = JSON.parse(await readFile(accepted, "utf8"));
  const wrongLength = await rawFile("wrong-length.json", record);
  const read = await call(["--artifact", wrongLength, "--json"]);
  assert.equal(read.code, 1);
  assert.equal(JSON.parse(read.stdout).evidence.issues[0], "artifact-byte-length-mismatch");
  record.body.acceptance.artifactId = "d".repeat(64);
  const mismatch = await envelopeFile("mismatched-acceptance.json", record);
  const result = await call(["--artifact", mismatch, "--json"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).evidence.issues[0], "acceptance-reference-mismatch");
});

test("task verdict reports stored Native failure settlement and loop summary without following references", async () => {
  const outer = JSON.parse(await readFile(accepted, "utf8"));
  const sourceRevision = git(["rev-parse", "HEAD"]), candidatePath = session.worktree.cwd;
  const failure = await envelopeFile("native-failure.json", { ...outer, body: { kind: "native-write-failure", sourceRevision,
    candidatePath, objective: SECRET, reason: SECRET, processCleanup: { settled: false, status: "timed_out", exitCode: null,
      signal: "SIGTERM", errorMessage: SECRET } } });
  const failed = await call(["--artifact", failure, "--json"]);
  assert.equal(failed.code, 0, failed.stderr);
  const report = JSON.parse(failed.stdout);
  assert.equal(report.historicalAcceptance.status, "refused");
  assert.equal(report.settlement, "unsettled");
  assert.equal(report.process.status, "timed_out");
  assert.equal(failed.stdout.includes(SECRET), false);
  const loop = await envelopeFile("native-loop.json", { ...outer, body: { kind: "native-write-loop", schemaVersion: 1,
    sourceRevision, candidatePath, attempts: [{ number: 1, accepted: true, artifact: { path: path.join(root, "DO_NOT_READ") } }], stopReason: "accepted" } });
  const summary = await call(["--artifact", loop, "--json"]);
  assert.equal(summary.code, 0, summary.stderr);
  assert.equal(JSON.parse(summary.stdout).historicalAcceptance.scope, "native-loop");
  assert.equal(JSON.parse(summary.stdout).settlement, "unobserved");
  assert.equal(summary.stdout.includes("DO_NOT_READ"), false);
});

test("task verdict treats an apply registration as a session record, not an observed application", async () => {
  const outer = JSON.parse(await readFile(accepted, "utf8"));
  const registration = await envelopeFile("registration.json", { ...outer, body: { kind: "native-apply-registration", registrationSchema: 2,
    sourceRepo: source, disposalAuthorization: SECRET, result: { status: "COMPLETED", candidatePath: outer.body.cwd,
      sourceRevision: git(["rev-parse", "HEAD"]), artifact: { id: outer.body.artifactId, path: SECRET }, acceptance: outer.body.acceptance } } });
  const result = await call(["--artifact", registration, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.historicalAcceptance.status, "accepted");
  assert.equal(report.historicalAcceptance.scope, "native-session");
  assert.equal(report.apply.registration, "recorded");
  assert.equal(report.apply.status, "unobserved");
  assert.equal(result.stdout.includes(SECRET), false);
});

test("task verdict separately labels reported prepared and applied records and refuses mismatched association", async () => {
  const observed = JSON.parse((await call(["--artifact", preflight, "--json"])).stdout);
  const base = { candidatePath: observed.candidatePath, sourceRevision: observed.sourceRevision, appliedRevision: "a".repeat(40) };
  const prepared = await rawFile("prepared.json", { ...base, candidateTree: "b".repeat(40) });
  const applied = await rawFile("applied.json", { ...base, status: "APPLIED", reverified: true, retainedCandidate: true });
  for (const [file, status] of [[prepared, "prepared"], [applied, "recorded-applied"]]) {
    const result = await call(["--artifact", preflight, "--apply-record", file!, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.apply.status, status);
    assert.equal(report.currentSourceVerified, false);
    assert.equal(report.grantsAuthority, false);
  }
  const mismatch = await rawFile("mismatched.json", { ...base, sourceRevision: "c".repeat(40), status: "APPLIED", reverified: true, retainedCandidate: true });
  const result = await call(["--artifact", preflight, "--apply-record", mismatch, "--json"]);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).apply.status, "unobserved");
  assert.equal(JSON.parse(result.stdout).apply.evidenceState, "corrupt");
  assert.equal(JSON.parse(result.stdout).evidence.state, "available");
  assert.equal(JSON.parse(result.stdout).historicalAcceptance.status, "accepted");
  const missing = await call(["--artifact", preflight, "--apply-record", path.join(root, "missing-apply.json"), "--json"]);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stdout).apply.evidenceState, "missing");
  const noAssociation = await call(["--artifact", accepted, "--apply-record", applied, "--json"]);
  assert.equal(noAssociation.code, 1);
  assert.equal(JSON.parse(noAssociation.stdout).apply.status, "unobserved");
});

test("task verdict safely renders historical path markup and rejects path control characters", async () => {
  const body = JSON.parse(await readFile(preflight, "utf8"));
  const unsafeMarkup = path.join(root, "candidate_[link](target)<script>|value");
  const file = await rawFile("markup.json", { ...body, candidatePath: unsafeMarkup });
  const markdown = await call(["--artifact", file, "--markdown"]);
  assert.equal(markdown.code, 0, markdown.stderr);
  assert.equal(markdown.stdout.includes("<script>"), false);
  assert.equal(markdown.stdout.includes("[link](target)"), false);
  assert.match(markdown.stdout, /&lt;script&gt;/);
  const controlled = await rawFile("control.json", { ...body, candidatePath: unsafeMarkup + "\u001b[31m" });
  const result = await call(["--artifact", controlled, "--json"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout.includes("candidate_[link]"), false);
});

test("task verdict argument errors are static and help is read only", async () => {
  for (const args of [[], ["--artifact", accepted], ["--artifact", accepted, "--json", "--markdown"],
    ["--artifact", accepted, "--json", "--artifact", refused], ["--artifact", accepted, "--json", SECRET]]) {
    const result = await call(args);
    assert.equal(result.code, 1);
    assert.equal(result.stderr.includes(SECRET), false);
  }
  const help = await call(["--help"]);
  assert.equal(help.code, 0); assert.match(help.stdout, /historical/);
});
