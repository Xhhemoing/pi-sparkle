import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import {
  doctorCommand,
  type DoctorJsonReport,
  type DoctorStorageFs
} from "../../../src/cli/doctor.js";
import { createEpisodeId, createEventId, createRunId } from "../../../src/domain/ids.js";
import { stableProjectKey } from "../../../src/learning/learned-routing.js";
import {
  configurePreferencePersistence,
  isTombstoned,
  listObservations,
  recordPreference,
  resetPreferenceStore
} from "../../../src/preferences/store.js";
import { adaptationRoot } from "../../../src/privacy/state-layout.js";
import { catalogObservedPath } from "../../../src/routing/catalog-observed.js";
import { EventStore } from "../../../src/run/event-store.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const COMPLIANT_NODE_VERSION = "22.19.0";

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text)
    },
    out,
    err
  };
}

test("doctor reports developer preview and fake-executor next steps", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--state-root", stateRoot, "--project", projectRoot],
      io,
      { nodeVersion: COMPLIANT_NODE_VERSION }
    );
    assert.equal(code, 0, err.join(""));
    const text = out.join("");
    assert.match(text, /developer preview/);
    assert.match(text, /not a production capability/);
    assert.match(text, new RegExp(`ok {2}node: ${COMPLIANT_NODE_VERSION}`));
    assert.match(text, /ok {2}state-root:/);
    assert.match(text, /live R1\/bandit\/topology: off/);
    assert.match(text, /fake executor/);
    assert.deepEqual(err, []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor fails closed for an injected Node version below engines", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-old-node-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-old-node-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--state-root", stateRoot, "--project", projectRoot],
      io,
      { nodeVersion: "22.18.9" }
    );

    assert.equal(code, 1);
    assert.match(
      out.join(""),
      /^ {2}FAIL {2}node: 22\.18\.9 \(engines >=22\.19\.0\) — need >= 22\.19\.0$/m
    );
    assert.equal(parseCliErrorJson(err.join(""))?.command, "doctor");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor fails closed when a declared Pi profile is missing from --agents-dir", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-dispatch-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-dispatch-proj-"));
  const agentsDir = join(projectRoot, "agents");
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "worker.md"), "# worker\n", "utf8");
    const { io, out, err } = capture();
    const code = await main(
      ["doctor", "--state-root", stateRoot, "--project", projectRoot, "--agents-dir", agentsDir],
      io
    );
    assert.equal(code, 1);
    assert.match(out.join(""), /FAIL {2}pi-dispatch:/);
    assert.match(out.join(""), /debugger/);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "doctor");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor reports the pinned Pi packages and the offline compat status", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-pi-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-pi-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--state-root", stateRoot, "--project", projectRoot],
      io,
      { nodeVersion: COMPLIANT_NODE_VERSION }
    );
    assert.equal(code, 0, err.join(""));
    const text = out.join("");
    assert.match(text, /ok {2}pi-packages: agent-core=\d+\.\d+\.\d+ ai=\d+\.\d+\.\d+/);
    assert.match(text, /ok {2}pi-compat: status=(?:current|behind|ahead|unknown)/);
    assert.doesNotMatch(text, /FAIL {2}pi-(?:packages|compat):/);
    assert.deepEqual(err, []);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor fails closed when --project has no package.json", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-miss-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-empty-"));
  try {
    const { io, out, err } = capture();
    const code = await main(["doctor", "--state-root", stateRoot, "--project", projectRoot], io);
    assert.equal(code, 1);
    assert.match(out.join(""), /FAIL {2}project:/);
    const parsed = parseCliErrorJson(err.join(""));
    assert.equal(parsed?.command, "doctor");
    assert.equal(parsed?.stage, "preflight");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// --- --json contract --------------------------------------------------------
// The report shape is frozen: the assertions below are the contract, so a
// change that renames a key or drops a check has to change this test on
// purpose. Nothing here depends on the host passing every check — `node` is
// engine-dependent — so `ok` is only ever asserted against the checks
// themselves and against the exit code.

const CONTRACT_KEYS = [
  "version",
  "preview",
  "liveAdaptive",
  "ok",
  "checks",
  "next",
  "locks",
  "runStates",
  "learnedState",
  "storage"
];

async function runDoctorJson(
  args: string[]
): Promise<{ report: DoctorJsonReport; code: number; out: string; err: string }> {
  const { io, out, err } = capture();
  const code = await main(["doctor", "--json", ...args], io);
  const stdout = out.join("");
  return { report: JSON.parse(stdout) as DoctorJsonReport, code, out: stdout, err: err.join("") };
}

test("doctor --json prints exactly one JSON object and no prose on stdout", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-json-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-json-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { report, out } = await runDoctorJson(["--state-root", stateRoot, "--project", projectRoot]);

    assert.equal(out.trimEnd().split("\n").length, 1, "stdout must be a single JSON line");
    assert.doesNotMatch(out, /developer preview/);
    assert.doesNotMatch(out, /next: pnpm cli run/);

    assert.deepEqual(Object.keys(report), CONTRACT_KEYS);
    assert.equal(typeof report.version, "string");
    assert.equal(report.preview, true);
    assert.equal(report.liveAdaptive, false);
    assert.equal(typeof report.ok, "boolean");
    assert.ok(Array.isArray(report.checks));
    assert.ok(report.next.every((step) => typeof step === "string"));
    assert.deepEqual(Object.keys(report.locks), ["advisory", "entries", "scanErrors"]);
    assert.equal(typeof report.locks.advisory, "string");
    assert.ok(Array.isArray(report.locks.entries));
    assert.ok(Array.isArray(report.locks.scanErrors));
    assert.deepEqual(Object.keys(report.runStates), ["advisory", "entries", "scanErrors"]);
    assert.equal(typeof report.runStates.advisory, "string");
    assert.ok(Array.isArray(report.runStates.entries));
    assert.ok(Array.isArray(report.runStates.scanErrors));
    assert.deepEqual(Object.keys(report.learnedState), ["advisory", "entries", "scanErrors"]);
    assert.equal(typeof report.learnedState.advisory, "string");
    assert.ok(Array.isArray(report.learnedState.entries));
    assert.ok(Array.isArray(report.learnedState.scanErrors));
    assert.deepEqual(Object.keys(report.storage), ["advisory", "entries", "scanErrors"]);
    assert.equal(typeof report.storage.advisory, "string");
    assert.ok(Array.isArray(report.storage.entries));
    assert.ok(Array.isArray(report.storage.scanErrors));
    assert.deepEqual(
      report.learnedState.entries.map((entry) => Object.keys(entry)),
      report.learnedState.entries.map(() => [
        "kind",
        "stateClass",
        "projectKey",
        "path",
        "status",
        "remediation"
      ])
    );
    assert.deepEqual(
      report.storage.entries.map((entry) => Object.keys(entry)),
      report.storage.entries.map(() => ["path", "plane", "kind", "bytes", "files", "links"])
    );

    for (const check of report.checks) {
      assert.deepEqual(Object.keys(check), ["name", "ok", "detail"]);
      assert.equal(typeof check.name, "string");
      assert.equal(typeof check.ok, "boolean");
      assert.equal(typeof check.detail, "string");
    }
    assert.deepEqual(
      report.checks.map((check) => check.name),
      [
        "node",
        "pnpm",
        "state-root",
        "legacy-layout",
        "providers",
        "auth",
        "project",
        "pi-dispatch",
        "skill-route",
        "agent-drift",
        "pi-packages",
        "pi-compat",
        "lock-inventory",
        "run-state-inventory",
        "learned-state-inventory",
        "storage"
      ]
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor --json ok mirrors the checks and drives the exit code", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-json-ok-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-json-ok-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { report, code } = await runDoctorJson([
      "--state-root",
      stateRoot,
      "--project",
      projectRoot
    ]);
    assert.equal(
      report.ok,
      report.checks.every((check) => check.ok)
    );
    assert.equal(code, report.ok ? 0 : 1);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor --json keeps stdout parseable while cliFail reports on stderr", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-json-fail-"));
  // No package.json: the `project` check fails deterministically on any host.
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-json-fail-proj-"));
  try {
    const { report, code, err } = await runDoctorJson([
      "--state-root",
      stateRoot,
      "--project",
      projectRoot
    ]);
    assert.equal(code, 1);
    assert.equal(report.ok, false);
    const project = report.checks.find((check) => check.name === "project");
    assert.equal(project?.ok, false);
    assert.match(project?.detail ?? "", /missing package\.json/);
    assert.equal(report.next[0], "fix the failing entries in checks[], then re-run pi-sparkle doctor");

    // JSON mode never mixes prose into stdout; the operator-facing failure
    // report lives on stderr, exactly as in prose mode.
    const parsed = parseCliErrorJson(err);
    assert.equal(parsed?.command, "doctor");
    assert.equal(parsed?.stage, "preflight");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor without --json stays prose and never emits the contract object", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-prose-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-prose-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const { io, out } = capture();
    await main(["doctor", "--state-root", stateRoot, "--project", projectRoot], io);
    const text = out.join("");
    assert.match(text, /pi-sparkle doctor/);
    assert.match(text, /next: pnpm cli run/);
    assert.match(text, /next: --executor pi requires/);
    assert.doesNotMatch(text, /"liveAdaptive"/);
    assert.throws(() => JSON.parse(text) as unknown);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor --json reports a legacy state root without failing the preflight", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-legacy-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-legacy-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(stateRoot, "feedback"), { recursive: true });
    await writeFile(join(stateRoot, "feedback", "records.jsonl"), "", "utf8");
    await mkdir(join(stateRoot, "runs"), { recursive: true });

    const { report } = await runDoctorJson(["--state-root", stateRoot, "--project", projectRoot]);
    const legacy = report.checks.find((check) => check.name === "legacy-layout");
    assert.equal(legacy?.ok, true, "legacy layout is informational, not a failure");
    assert.match(legacy?.detail ?? "", /records\.jsonl/);
    assert.match(legacy?.detail ?? "", /runs/);
    assert.match(legacy?.detail ?? "", /invisible to plane-aware code/);

    const { io, out } = capture();
    await main(["doctor", "--state-root", stateRoot, "--project", projectRoot], io);
    assert.match(out.join(""), /ok {2}legacy-layout: pre-plane state/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor inventories nested locks with additive JSON diagnostics and never removes them", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-locks-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-locks-proj-"));
  const nowMs = Date.parse("2026-08-24T18:00:00.000Z");
  const acquiredAt = "2026-08-24T17:59:50.000Z";
  const validLock = join(stateRoot, "runtime", "episodes", "episode-1.lock");
  const emptyLock = join(stateRoot, "adaptation", "feedback", "records.jsonl.lock");
  const invalidLock = join(stateRoot, "runtime", "invocations.jsonl.lock");
  const validRaw = JSON.stringify({ ownerToken: "owner-1", pid: 4242, acquiredAt });
  const invalidRaw = "{not json";
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(stateRoot, "runtime", "episodes"), { recursive: true });
    await mkdir(join(stateRoot, "adaptation", "feedback"), { recursive: true });
    await writeFile(validLock, validRaw, "utf8");
    await writeFile(emptyLock, "", "utf8");
    await writeFile(invalidLock, invalidRaw, "utf8");
    await writeFile(join(stateRoot, "runtime", "ignored.lock.tmp"), "not a lock", "utf8");
    await utimes(emptyLock, new Date(nowMs - 30_000), new Date(nowMs - 30_000));

    const checkedPids: number[] = [];
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--json", "--state-root", stateRoot, "--project", projectRoot],
      io,
      {
        nodeVersion: COMPLIANT_NODE_VERSION,
        nowMs,
        pidLiveness: (pid) => {
          checkedPids.push(pid);
          return "not-running";
        }
      }
    );
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.match(report.locks.advisory, /PID reuse/);
    assert.match(report.locks.advisory, /never steals or deletes locks/);
    assert.deepEqual(report.locks.scanErrors, []);
    assert.equal(report.locks.entries.length, 3);
    const valid = report.locks.entries.find((entry) => entry.path === validLock);
    assert.deepEqual(valid, {
      path: validLock,
      ageMs: 10_000,
      ageSource: "acquiredAt",
      acquiredAt,
      pid: 4242,
      pidLiveness: "not-running",
      metadata: "valid",
      remediation: `age 10000ms; recorded PID 4242 is not running: inspect and remove manually; never automatic (${validLock})`
    });
    const empty = report.locks.entries.find((entry) => entry.path === emptyLock);
    assert.equal(empty?.metadata, "empty");
    assert.equal(empty?.ageSource, "mtime");
    assert.ok(
      empty?.ageMs !== null && empty?.ageMs !== undefined && Math.abs(empty.ageMs - 30_000) <= 1,
      `unexpected mtime-derived age: ${empty?.ageMs}`
    );
    assert.equal(empty?.pid, null);
    assert.equal(empty?.pidLiveness, "not-recorded");
    const invalid = report.locks.entries.find((entry) => entry.path === invalidLock);
    assert.equal(invalid?.metadata, "invalid");
    assert.equal(invalid?.pid, null);
    assert.equal(invalid?.pidLiveness, "not-recorded");
    assert.match(valid?.remediation ?? "", /age 10000ms/);
    assert.match(valid?.remediation ?? "", /inspect and remove manually; never automatic/);
    assert.match(empty?.remediation ?? "", /inspect metadata and ownership/);
    assert.deepEqual(checkedPids, [4242]);

    const lockCheck = report.checks.find((check) => check.name === "lock-inventory");
    assert.equal(lockCheck?.ok, true, "empty and invalid metadata are diagnostics, not stale proof");
    assert.match(lockCheck?.detail ?? "", /3 lock file\(s\) found/);
    assert.match(lockCheck?.detail ?? "", /advisory only/);

    assert.equal(await readFile(validLock, "utf8"), validRaw);
    assert.equal(await readFile(emptyLock, "utf8"), "");
    assert.equal(await readFile(invalidLock, "utf8"), invalidRaw);

    const prose = capture();
    assert.equal(
      await doctorCommand(["--state-root", stateRoot, "--project", projectRoot], prose.io, {
        nodeVersion: COMPLIANT_NODE_VERSION,
        nowMs,
        pidLiveness: () => "not-running"
      }),
      0,
      prose.err.join("")
    );
    const text = prose.out.join("");
    assert.match(text, /ok {2}lock-inventory: 3 lock file\(s\) found/);
    assert.match(text, /episode-1\.lock: age=10000ms source=acquiredAt pid=4242/);
    assert.match(text, /records\.jsonl\.lock: age=30000ms source=mtime pid=not-recorded/);
    assert.match(text, /metadata=empty/);
    assert.match(text, /inspect and remove manually; never automatic/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor inventories PLANNING and RUNNING logs as read-only advisory crash candidates", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-run-states-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-run-states-proj-"));
  const nowMs = Date.parse("2026-08-24T18:00:00.000Z");
  const planningAt = "2026-08-24T17:59:00.000Z";
  const runningAt = "2026-08-24T17:59:30.000Z";
  const planningRunId = createRunId(() => "doctor-planning");
  const runningRunId = createRunId(() => "doctor-running");
  const completedRunId = createRunId(() => "doctor-completed");
  const planningPath = join(stateRoot, "runtime", "runs", planningRunId, "events.jsonl");
  const runningPath = join(stateRoot, "runtime", "runs", runningRunId, "events.jsonl");
  const completedPath = join(stateRoot, "runtime", "runs", completedRunId, "events.jsonl");
  let eventSequence = 0;
  const eventId = () => createEventId(() => `doctor-${++eventSequence}`);

  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const planningStore = new EventStore(stateRoot, planningRunId);
    await planningStore.append(
      makeEvent("RUN_CREATED", { run: { ...makeRun(), id: planningRunId } }, {
        id: eventId(),
        runId: planningRunId,
        occurredAt: planningAt
      })
    );
    const runningStore = new EventStore(stateRoot, runningRunId);
    await runningStore.append(
      makeEvent("RUN_CREATED", { run: { ...makeRun(), id: runningRunId } }, {
        id: eventId(),
        runId: runningRunId,
        occurredAt: "2026-08-24T17:58:00.000Z"
      })
    );
    await runningStore.append(
      makeEvent("RUN_STARTED", {}, {
        id: eventId(),
        runId: runningRunId,
        occurredAt: runningAt
      })
    );
    const completedStore = new EventStore(stateRoot, completedRunId);
    await completedStore.append(
      makeEvent("RUN_CREATED", { run: { ...makeRun(), id: completedRunId } }, {
        id: eventId(),
        runId: completedRunId,
        occurredAt: "2026-08-24T17:57:00.000Z"
      })
    );
    await completedStore.append(
      makeEvent("RUN_STARTED", {}, {
        id: eventId(),
        runId: completedRunId,
        occurredAt: "2026-08-24T17:57:30.000Z"
      })
    );
    await completedStore.append(
      makeEvent("RUN_COMPLETED", {}, {
        id: eventId(),
        runId: completedRunId,
        occurredAt: "2026-08-24T17:58:30.000Z"
      })
    );
    const originalLogs = await Promise.all(
      [planningPath, runningPath, completedPath].map((path) => readFile(path, "utf8"))
    );

    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--json", "--state-root", stateRoot, "--project", projectRoot],
      io,
      { nodeVersion: COMPLIANT_NODE_VERSION, nowMs }
    );
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.match(report.runStates.advisory, /advisory crash candidates only/);
    assert.match(report.runStates.advisory, /live process may still own the run/);
    assert.match(report.runStates.advisory, /doctor never changes run state/);
    assert.deepEqual(report.runStates.scanErrors, []);
    assert.equal(report.runStates.entries.length, 2);
    assert.deepEqual(
      report.runStates.entries.find((entry) => entry.runId === planningRunId),
      {
        runId: planningRunId,
        path: planningPath,
        status: "PLANNING",
        ageMs: 60_000,
        lastEventAt: planningAt,
        remediation: `inspect with pi-sparkle inspect --run ${planningRunId}; then resume --run ${planningRunId} or delete --run ${planningRunId}`
      }
    );
    assert.deepEqual(
      report.runStates.entries.find((entry) => entry.runId === runningRunId),
      {
        runId: runningRunId,
        path: runningPath,
        status: "RUNNING",
        ageMs: 30_000,
        lastEventAt: runningAt,
        remediation: `inspect with pi-sparkle inspect --run ${runningRunId}; then resume --run ${runningRunId} or delete --run ${runningRunId}`
      }
    );
    assert.equal(
      report.runStates.entries.some((entry) => entry.runId === completedRunId),
      false,
      "terminal logs are not crash candidates"
    );
    const runStateCheck = report.checks.find((check) => check.name === "run-state-inventory");
    assert.equal(runStateCheck?.ok, true);
    assert.match(runStateCheck?.detail ?? "", /2 PLANNING\/RUNNING run log\(s\)/);
    assert.match(runStateCheck?.detail ?? "", /advisory crash candidate/);

    assert.deepEqual(
      await Promise.all(
        [planningPath, runningPath, completedPath].map((path) => readFile(path, "utf8"))
      ),
      originalLogs,
      "doctor must not modify run logs"
    );

    const prose = capture();
    assert.equal(
      await doctorCommand(["--state-root", stateRoot, "--project", projectRoot], prose.io, {
        nodeVersion: COMPLIANT_NODE_VERSION,
        nowMs
      }),
      0,
      prose.err.join("")
    );
    const text = prose.out.join("");
    assert.match(text, /ok {2}run-state-inventory: 2 PLANNING\/RUNNING run log\(s\)/);
    assert.match(text, new RegExp(`run: ${planningRunId}: status=PLANNING age=60000ms`));
    assert.match(text, new RegExp(`resume --run ${runningRunId} or delete --run ${runningRunId}`));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

// --- auth preflight ---------------------------------------------------------
// Hermetic on every CI leg, Windows included: state lives in a temp dir, the
// only ambient input is an environment variable this file sets and restores,
// and the seam below keeps the multi-provider cases off Pi's resolver
// entirely. Nothing here reaches the network.

const CLAUDE = "anthropic/claude-sonnet-4-20250514";
const GPT = "openai/gpt-4o";
/** Never a real key, and asserted *against* everything doctor prints. */
const FAKE_KEY = "fake-doctor-key-do-not-log-71b3";

async function writeProviders(
  stateRoot: string,
  config: Record<string, unknown>
): Promise<void> {
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  await writeFile(
    join(stateRoot, "runtime", "providers.json"),
    `${JSON.stringify({ version: 1, ...config })}\n`,
    "utf8"
  );
}

async function withEnv(
  overrides: Readonly<Record<string, string | undefined>>,
  run: () => Promise<void>
): Promise<void> {
  const saved = Object.keys(overrides).map((key) => ({ key, value: process.env[key] }));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const { key, value } of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Every variable Pi resolves anthropic from, so the host cannot decide these. */
const ANTHROPIC_ENV = {
  ANTHROPIC_AUTH_TOKEN: undefined,
  ANTHROPIC_OAUTH_TOKEN: undefined,
  ANTHROPIC_API_KEY: undefined
} as const;

test("doctor says the fake executor needs no credentials when nothing is enabled", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-none-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-none-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    // `code` is not asserted here: `node` is engine-dependent, so this file
    // only ever reads the check it is about.
    const { report } = await runDoctorJson(["--state-root", stateRoot, "--project", projectRoot]);
    const auth = report.checks.find((check) => check.name === "auth");
    assert.equal(auth?.ok, true);
    assert.match(auth?.detail ?? "", /fake executor needs no credentials/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor reports the credential source of every provider a run would use", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-ok-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-ok-proj-"));
  const asked: string[] = [];
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await writeProviders(stateRoot, { enabled: [CLAUDE, GPT], primary: CLAUDE, fast: GPT });
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--json", "--state-root", stateRoot, "--project", projectRoot],
      io,
      {
        nodeVersion: COMPLIANT_NODE_VERSION,
        authCheck: async (_root, providerId) => {
          asked.push(providerId);
          return providerId === "anthropic"
            ? { type: "api_key", source: "stored credential" }
            : { type: "api_key", source: "OPENAI_API_KEY" };
        }
      }
    );
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;
    const auth = report.checks.find((check) => check.name === "auth");
    assert.equal(auth?.ok, true);
    assert.match(auth?.detail ?? "", /anthropic=api_key via stored credential/);
    assert.match(auth?.detail ?? "", /openai=api_key via OPENAI_API_KEY/);

    // One question per provider, not per enabled model, and only for the
    // providers this state root would actually route to.
    assert.deepEqual(asked, ["anthropic", "openai"]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor fails closed for an enabled provider with no credential", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-missing-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-missing-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await writeProviders(stateRoot, { enabled: [CLAUDE, GPT], primary: CLAUDE });
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--json", "--state-root", stateRoot, "--project", projectRoot],
      io,
      {
        nodeVersion: COMPLIANT_NODE_VERSION,
        authCheck: async (_root, providerId) =>
          providerId === "anthropic" ? { type: "api_key", source: "stored credential" } : undefined
      }
    );
    // The whole point: this is discovered before a run exists, not as Pi's
    // "Provider is not configured" once there is state to clean up.
    assert.equal(code, 1);
    const report = JSON.parse(out.join("")) as DoctorJsonReport;
    const auth = report.checks.find((check) => check.name === "auth");
    assert.equal(auth?.ok, false);
    assert.equal(report.ok, false);
    assert.match(auth?.detail ?? "", /openai=no credential/);
    assert.match(auth?.detail ?? "", /pi-sparkle auth login <provider>/);
    assert.equal(parseCliErrorJson(err.join(""))?.command, "doctor");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor resolves a real environment credential and prints its name, never its value", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-env-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-env-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await writeProviders(stateRoot, { enabled: [CLAUDE], primary: CLAUDE });

    // No seam here: the shipped resolver is what the operator's run will use,
    // so the check is only worth anything if it agrees with it.
    await withEnv({ ...ANTHROPIC_ENV, ANTHROPIC_API_KEY: FAKE_KEY }, async () => {
      const { report, out } = await runDoctorJson([
        "--state-root",
        stateRoot,
        "--project",
        projectRoot
      ]);
      const auth = report.checks.find((check) => check.name === "auth");
      assert.equal(auth?.ok, true);
      assert.match(auth?.detail ?? "", /anthropic=api_key via ANTHROPIC_API_KEY/);
      assert.equal(out.includes(FAKE_KEY), false, "doctor must never print a credential value");
    });

    await withEnv(ANTHROPIC_ENV, async () => {
      const { report, code } = await runDoctorJson([
        "--state-root",
        stateRoot,
        "--project",
        projectRoot
      ]);
      assert.equal(code, 1, "a missing credential fails the preflight");
      const auth = report.checks.find((check) => check.name === "auth");
      assert.equal(auth?.ok, false);
      assert.match(auth?.detail ?? "", /anthropic=no credential/);
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor prints the auth check in prose without leaking a credential", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-prose-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-prose-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await writeProviders(stateRoot, { enabled: [CLAUDE], primary: CLAUDE });
    const { io, out, err } = capture();
    const code = await doctorCommand(["--state-root", stateRoot, "--project", projectRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION,
      authCheck: async () => ({ type: "api_key", source: "ANTHROPIC_API_KEY" })
    });
    assert.equal(code, 0, err.join(""));
    const text = out.join("");
    assert.match(text, /ok {2}auth: anthropic=api_key via ANTHROPIC_API_KEY/);
    assert.equal(text.includes(FAKE_KEY), false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("an unreadable providers.json fails the providers check without a second auth failure", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-broken-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-auth-broken-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(join(stateRoot, "runtime", "providers.json"), "{not json", "utf8");
    const { report, code } = await runDoctorJson(["--state-root", stateRoot, "--project", projectRoot]);
    assert.equal(code, 1);
    assert.equal(report.checks.find((check) => check.name === "providers")?.ok, false);
    const auth = report.checks.find((check) => check.name === "auth");
    assert.equal(auth?.ok, true, "one cause, one failure");
    assert.match(auth?.detail ?? "", /see the providers check/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor reports the current local PID as running but only advisory", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-live-lock-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-live-lock-proj-"));
  const lockPath = join(stateRoot, "runtime", "active.lock");
  const raw = JSON.stringify({
    ownerToken: "active-owner",
    pid: process.pid,
    acquiredAt: new Date().toISOString()
  });
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(lockPath, raw, "utf8");
    const { io, out, err } = capture();
    const code = await doctorCommand(
      ["--json", "--state-root", stateRoot, "--project", projectRoot],
      io,
      { nodeVersion: COMPLIANT_NODE_VERSION }
    );
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;
    assert.equal(report.locks.entries[0]?.pid, process.pid);
    assert.equal(report.locks.entries[0]?.pidLiveness, "running");
    assert.match(report.locks.advisory, /cannot prove a lock is stale/);
    assert.equal(await readFile(lockPath, "utf8"), raw);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("doctor inventories learned and derived state through the shipped readers without changing bytes", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-learned-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-learned-proj-"));
  const damagedProjectRoot = `${projectRoot}-damaged`;
  const absentProjectRoot = `${projectRoot}-absent`;
  const readableProjectKey = stableProjectKey(projectRoot);
  const damagedProjectKey = stableProjectKey(damagedProjectRoot);
  const absentProjectKey = stableProjectKey(absentProjectRoot);
  const projectsDir = join(adaptationRoot(stateRoot), "learning", "projects");
  const readableBanditPath = join(projectsDir, readableProjectKey, "bandit.json");
  const damagedBanditPath = join(projectsDir, damagedProjectKey, "bandit.json");
  const absentBanditPath = join(projectsDir, absentProjectKey, "bandit.json");
  const preferencesPath = join(adaptationRoot(stateRoot), "preferences.json");
  const observedPath = catalogObservedPath(stateRoot);
  const readableBandit = `${JSON.stringify(
    {
      arms: ["model-a"],
      pulls: { "model-a": 1 },
      rewardSum: { "model-a": 1 },
      explorationsUsed: 0,
      highRiskExplorations: 0
    },
    null,
    2
  )}\n`;
  const damagedBandit = '{"arms":';
  const damagedPreferences = '{"observations":';
  const damagedObserved = '{"versions":';

  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await mkdir(join(projectsDir, readableProjectKey), { recursive: true });
    await mkdir(join(projectsDir, damagedProjectKey), { recursive: true });
    await mkdir(join(projectsDir, absentProjectKey), { recursive: true });
    await mkdir(join(adaptationRoot(stateRoot)), { recursive: true });
    await mkdir(join(stateRoot, "runtime", "routing"), { recursive: true });
    await writeFile(readableBanditPath, readableBandit, "utf8");
    await writeFile(damagedBanditPath, damagedBandit, "utf8");
    await writeFile(preferencesPath, damagedPreferences, "utf8");
    await writeFile(observedPath, damagedObserved, "utf8");

    const first = capture();
    const firstCode = await doctorCommand(
      ["--json", "--state-root", stateRoot, "--project", projectRoot],
      first.io,
      { nodeVersion: COMPLIANT_NODE_VERSION }
    );
    assert.equal(firstCode, 0, first.err.join(""));
    const report = JSON.parse(first.out.join("")) as DoctorJsonReport;
    assert.deepEqual(report.learnedState.scanErrors, []);
    assert.match(report.learnedState.advisory, /shipped state readers/);
    assert.match(report.learnedState.advisory, /doctor never repairs, moves, deletes, or rebuilds/);
    assert.equal(report.learnedState.entries.length, 5);

    const byPath = new Map(report.learnedState.entries.map((entry) => [entry.path, entry]));
    assert.deepEqual(byPath.get(readableBanditPath), {
      kind: "bandit",
      stateClass: "learned",
      projectKey: readableProjectKey,
      path: readableBanditPath,
      status: "readable",
      remediation:
        "learned state: repair the file or move it aside and relearn from zero; doctor never changes it"
    });
    assert.deepEqual(byPath.get(damagedBanditPath), {
      kind: "bandit",
      stateClass: "learned",
      projectKey: damagedProjectKey,
      path: damagedBanditPath,
      status: "damaged",
      remediation:
        "learned state: repair the file or move it aside and relearn from zero; doctor never changes it"
    });
    assert.deepEqual(byPath.get(absentBanditPath), {
      kind: "bandit",
      stateClass: "learned",
      projectKey: absentProjectKey,
      path: absentBanditPath,
      status: "absent",
      remediation:
        "learned state: repair the file or move it aside and relearn from zero; doctor never changes it"
    });
    assert.deepEqual(byPath.get(preferencesPath), {
      kind: "preferences",
      stateClass: "learned",
      projectKey: null,
      path: preferencesPath,
      status: "damaged",
      remediation:
        "learned state: repair the file or move it aside and relearn preferences from an empty store; doctor never changes it"
    });
    assert.deepEqual(byPath.get(observedPath), {
      kind: "catalog-observed",
      stateClass: "derived",
      projectKey: null,
      path: observedPath,
      status: "damaged",
      remediation:
        "derived state: delete the damaged file and rebuild it from runtime/invocations.jsonl; doctor never changes it"
    });

    const learnedCheck = report.checks.find((check) => check.name === "learned-state-inventory");
    assert.equal(learnedCheck?.ok, true, "damaged state is advisory, not a scan failure");
    assert.match(learnedCheck?.detail ?? "", /1 readable, 1 absent, 3 damaged/);
    assert.equal(report.ok, true);
    assert.deepEqual(
      await Promise.all(
        [readableBanditPath, damagedBanditPath, preferencesPath, observedPath].map((path) =>
          readFile(path, "utf8")
        )
      ),
      [readableBandit, damagedBandit, damagedPreferences, damagedObserved],
      "doctor must leave learned and derived state byte-identical"
    );

    const validPreferences = '{"observations":[],"tombstones":[]}\n';
    const validObserved = '{"versions":{}}\n';
    await writeFile(preferencesPath, validPreferences, "utf8");
    await writeFile(observedPath, validObserved, "utf8");
    const second = capture();
    assert.equal(
      await doctorCommand(
        ["--json", "--state-root", stateRoot, "--project", projectRoot],
        second.io,
        { nodeVersion: COMPLIANT_NODE_VERSION }
      ),
      0,
      second.err.join("")
    );
    const reread = JSON.parse(second.out.join("")) as DoctorJsonReport;
    const rereadByPath = new Map(reread.learnedState.entries.map((entry) => [entry.path, entry]));
    assert.equal(rereadByPath.get(preferencesPath)?.status, "readable");
    assert.equal(rereadByPath.get(observedPath)?.status, "readable");
    assert.equal(await readFile(preferencesPath, "utf8"), validPreferences);
    assert.equal(await readFile(observedPath, "utf8"), validObserved);

    const prose = capture();
    assert.equal(
      await doctorCommand(["--state-root", stateRoot, "--project", projectRoot], prose.io, {
        nodeVersion: COMPLIANT_NODE_VERSION
      }),
      0,
      prose.err.join("")
    );
    const text = prose.out.join("");
    assert.match(text, /ok {2}learned-state-inventory: 5 state file\(s\) inventoried/);
    assert.match(
      text,
      new RegExp(`state: bandit: project-key=${damagedProjectKey} class=learned status=damaged`)
    );
    assert.match(text, /state: catalog-observed: class=derived status=readable/);
    assert.match(text, /derived state: delete the damaged file and rebuild it/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

/**
 * R7-8. Doctor reaches a stored bandit file through the keyed reader, so the
 * inventory no longer depends on the project-key hash being invertible. The key
 * below is well-formed for the scan but outside the magnitude any project root
 * can hash to, which is exactly what the deleted base-31 preimage refused: it
 * used to push a scan error and report the file `present but unclassified`,
 * failing the check. Read by key, the same bytes classify normally.
 */
test("doctor inventories a stored project key it could not have hashed back to a root", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-keyed-"));
  const unreachableKey = "pffffffff";
  const projectsDir = join(adaptationRoot(stateRoot), "learning", "projects");
  const banditPath = join(projectsDir, unreachableKey, "bandit.json");
  const damagedBandit = '{"arms":';
  try {
    await mkdir(join(projectsDir, unreachableKey), { recursive: true });
    await writeFile(banditPath, damagedBandit, "utf8");

    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.deepEqual(report.learnedState.scanErrors, []);
    assert.deepEqual(
      report.learnedState.entries.find((entry) => entry.path === banditPath),
      {
        kind: "bandit",
        stateClass: "learned",
        projectKey: unreachableKey,
        path: banditPath,
        status: "damaged",
        remediation:
          "learned state: repair the file or move it aside and relearn from zero; doctor never changes it"
      }
    );
    const learnedCheck = report.checks.find((check) => check.name === "learned-state-inventory");
    assert.equal(learnedCheck?.ok, true, "an unmapped key is no longer a scan failure");
    assert.equal(await readFile(banditPath, "utf8"), damagedBandit);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * R7-8. The preferences probe reads through a pure reader instead of binding the
 * process-global store and unbinding it again. The bind was observable: it
 * replaced this process's in-memory history with the inventoried file's, and the
 * unbind left the store unbound whatever it had been before. Doctor is a
 * read-only inventory, so neither may happen.
 */
test("doctor inventories preferences without adopting them into the process store", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-pref-pure-"));
  const preferencesPath = join(adaptationRoot(stateRoot), "preferences.json");
  const planted = {
    id: "pref_planted",
    scope: "user",
    scopeKey: "u1",
    key: "format",
    value: "planted",
    evidenceEpisodeId: "epi_planted",
    weight: 1,
    createdAt: "2026-08-24T18:00:00.000Z",
    explicit: true,
    recurrenceCount: 1
  };
  const snapshot = `${JSON.stringify({ observations: [planted], tombstones: ["pref_gone"] })}\n`;
  try {
    await mkdir(adaptationRoot(stateRoot), { recursive: true });
    await writeFile(preferencesPath, snapshot, "utf8");

    configurePreferencePersistence(undefined);
    resetPreferenceStore();
    const mine = recordPreference("user", "u1", "format", "mine", createEpisodeId(), 1, true);

    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;
    assert.equal(
      report.learnedState.entries.find((entry) => entry.path === preferencesPath)?.status,
      "readable"
    );

    assert.deepEqual(
      listObservations().map((row) => row.id),
      [mine.id],
      "doctor must not load the inventoried snapshot into this process's store"
    );
    assert.equal(isTombstoned("pref_gone"), false, "nor its tombstones");

    // Still unbound, exactly as doctor found it: a later observation cannot land
    // on top of the file doctor only read.
    recordPreference("user", "u1", "format", "later", createEpisodeId(), 1, true);
    assert.equal(await readFile(preferencesPath, "utf8"), snapshot);
  } finally {
    configurePreferencePersistence(undefined);
    resetPreferenceStore();
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("doctor fails the learned-state check only for scan errors", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-learned-scan-"));
  const projectsDir = join(adaptationRoot(stateRoot), "learning", "projects");
  try {
    await mkdir(join(adaptationRoot(stateRoot), "learning"), { recursive: true });
    await writeFile(projectsDir, "not a directory", "utf8");

    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 1);
    const report = JSON.parse(out.join("")) as DoctorJsonReport;
    assert.equal(report.learnedState.scanErrors.length, 1);
    assert.match(report.learnedState.scanErrors[0] ?? "", /projects/);
    assert.deepEqual(
      report.learnedState.entries.map((entry) => [entry.kind, entry.status]),
      [
        ["preferences", "absent"],
        ["catalog-observed", "absent"]
      ]
    );
    const learnedCheck = report.checks.find((check) => check.name === "learned-state-inventory");
    assert.equal(learnedCheck?.ok, false);
    assert.match(learnedCheck?.detail ?? "", /1 scan error/);
    assert.equal(
      report.checks.filter((check) => !check.ok).map((check) => check.name).includes(
        "learned-state-inventory"
      ),
      true
    );
    assert.equal(parseCliErrorJson(err.join(""))?.command, "doctor");
    assert.equal(await readFile(projectsDir, "utf8"), "not a directory");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

// --- storage inventory ------------------------------------------------------
// Windows-hermetic like the rest of this file: temp dirs, `path.join`, no shell,
// no POSIX mode bits. The scan-error case runs through the injected `storageFs`
// seam and through a wrong-node fixture (a plane root that is a regular file),
// both of which fail identically on POSIX and Windows.

const INVOCATIONS = '{"invocation":1}\n{"invocation":2}\n';
const EPISODE = '{"episode":"epi-1"}\n';
const CATALOG_OBSERVED = '{"versions":{}}\n';
const REGISTRY = '{"agents":[]}\n';
const PREFERENCES = '{"observations":[],"tombstones":[]}\n';
const PROJECT_BANDIT = '{"arms":["model-a"]}\n';
const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

test("doctor reports an empty state root as zero storage without a scan error", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-storage-empty-"));
  try {
    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.deepEqual(report.storage.entries, [], "a state root with no plane roots has no entries");
    assert.deepEqual(report.storage.scanErrors, [], "an absent plane root is not a scan error");
    const storage = report.checks.find((check) => check.name === "storage");
    assert.equal(storage?.ok, true);
    assert.match(storage?.detail ?? "", /runtime=0 logical byte\(s\) in 0 file\(s\)/);
    assert.match(storage?.detail ?? "", /adaptation=0 logical byte\(s\) in 0 file\(s\)/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * The inventory walks the immediate entries of both plane roots and totals each
 * recursively, so the record classes a hand-maintained path list omitted —
 * `runtime/routing/catalog-observed.json`, `adaptation/registry.json`, and
 * everything under `adaptation/learning/projects/**` — are counted here without
 * being named. `adaptation/preferences.json` is a file, not a `preferences/`
 * directory.
 */
test("doctor totals both plane roots by immediate entry, including state no path list named", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-storage-tree-"));
  const runtimeDir = join(stateRoot, "runtime");
  const adaptationDir = join(stateRoot, "adaptation");
  const invocationsPath = join(runtimeDir, "invocations.jsonl");
  const routingDir = join(runtimeDir, "routing");
  const episodesDir = join(runtimeDir, "episodes");
  const learningDir = join(adaptationDir, "learning");
  const preferencesPath = join(adaptationDir, "preferences.json");
  const registryPath = join(adaptationDir, "registry.json");
  const banditPath = join(learningDir, "projects", "p1", "bandit.json");
  try {
    await mkdir(routingDir, { recursive: true });
    await mkdir(join(episodesDir, "epi-1"), { recursive: true });
    await mkdir(join(learningDir, "projects", "p1"), { recursive: true });
    await writeFile(invocationsPath, INVOCATIONS, "utf8");
    await writeFile(join(routingDir, "catalog-observed.json"), CATALOG_OBSERVED, "utf8");
    await writeFile(join(episodesDir, "epi-1", "episode.json"), EPISODE, "utf8");
    await writeFile(registryPath, REGISTRY, "utf8");
    await writeFile(preferencesPath, PREFERENCES, "utf8");
    await writeFile(banditPath, PROJECT_BANDIT, "utf8");

    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.deepEqual(report.storage.scanErrors, []);
    assert.deepEqual(report.storage.entries, [
      {
        path: episodesDir,
        plane: "runtime",
        kind: "directory",
        bytes: bytes(EPISODE),
        files: 1,
        links: 0
      },
      {
        path: invocationsPath,
        plane: "runtime",
        kind: "file",
        bytes: bytes(INVOCATIONS),
        files: 1,
        links: 0
      },
      {
        path: routingDir,
        plane: "runtime",
        kind: "directory",
        bytes: bytes(CATALOG_OBSERVED),
        files: 1,
        links: 0
      },
      {
        path: learningDir,
        plane: "adaptation",
        kind: "directory",
        bytes: bytes(PROJECT_BANDIT),
        files: 1,
        links: 0
      },
      {
        path: preferencesPath,
        plane: "adaptation",
        kind: "file",
        bytes: bytes(PREFERENCES),
        files: 1,
        links: 0
      },
      {
        path: registryPath,
        plane: "adaptation",
        kind: "file",
        bytes: bytes(REGISTRY),
        files: 1,
        links: 0
      }
    ]);

    const runtimeBytes = bytes(EPISODE) + bytes(INVOCATIONS) + bytes(CATALOG_OBSERVED);
    const adaptationBytes = bytes(PROJECT_BANDIT) + bytes(PREFERENCES) + bytes(REGISTRY);
    const storage = report.checks.find((check) => check.name === "storage");
    assert.equal(storage?.ok, true);
    assert.match(
      storage?.detail ?? "",
      new RegExp(`runtime=${runtimeBytes} logical byte\\(s\\) in 3 file\\(s\\)`)
    );
    assert.match(
      storage?.detail ?? "",
      new RegExp(`adaptation=${adaptationBytes} logical byte\\(s\\) in 3 file\\(s\\)`)
    );
    assert.match(report.storage.advisory, /Retention is unbounded by accepted policy/);
    assert.match(report.storage.advisory, /doctor measures and never deletes/);
    assert.match(report.storage.advisory, /delete --run and episode deletion are the reclaim verbs/);
    assert.match(report.storage.advisory, /logical bytes of regular files/);
    assert.match(report.storage.advisory, /best-effort snapshot/);
    assert.doesNotMatch(report.storage.advisory, /never follows/);

    // Read-only: measuring the tree changes none of its bytes.
    assert.deepEqual(
      await Promise.all(
        [invocationsPath, registryPath, preferencesPath, banditPath].map((path) =>
          readFile(path, "utf8")
        )
      ),
      [INVOCATIONS, REGISTRY, PREFERENCES, PROJECT_BANDIT]
    );

    const prose = capture();
    assert.equal(
      await doctorCommand(["--state-root", stateRoot], prose.io, {
        nodeVersion: COMPLIANT_NODE_VERSION
      }),
      0,
      prose.err.join("")
    );
    const text = prose.out.join("");
    assert.match(text, /ok {2}storage: runtime=\d+ logical byte\(s\)/);
    assert.match(text, new RegExp(`storage: .*routing: plane=runtime kind=directory bytes=\\d+`));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * The only way a directory read fails after `lstat` called it a directory is a
 * runtime error, and POSIX mode bits do not reproduce one on Windows (nor under
 * a privileged runner). The seam injects it directly instead.
 */
test("doctor fails the storage check when a subtree cannot be read", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-storage-scan-"));
  const feedbackDir = join(stateRoot, "adaptation", "feedback");
  const unreadable: DoctorStorageFs = {
    readdir: async (dir) => {
      if (dir === feedbackDir) {
        const error: NodeJS.ErrnoException = new Error(
          `EACCES: permission denied, scandir '${dir}'`
        );
        error.code = "EACCES";
        throw error;
      }
      return readdir(dir);
    },
    lstat: (path) => lstat(path)
  };
  try {
    await mkdir(feedbackDir, { recursive: true });
    await writeFile(join(feedbackDir, "records.jsonl"), REGISTRY, "utf8");

    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION,
      storageFs: unreadable
    });
    assert.equal(code, 1);
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.equal(report.storage.scanErrors.length, 1);
    assert.match(report.storage.scanErrors[0] ?? "", /feedback/);
    assert.match(report.storage.scanErrors[0] ?? "", /EACCES/);
    assert.deepEqual(report.storage.entries, [
      { path: feedbackDir, plane: "adaptation", kind: "directory", bytes: 0, files: 0, links: 0 }
    ]);
    const storage = report.checks.find((check) => check.name === "storage");
    assert.equal(storage?.ok, false);
    assert.match(storage?.detail ?? "", /1 scan error\(s\)/);
    assert.equal(parseCliErrorJson(err.join(""))?.command, "doctor");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/** The same failure without a seam, from a fixture that is wrong on every OS. */
test("doctor reports a plane root that is not a directory as a storage scan error", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-storage-wrong-node-"));
  const adaptationDir = join(stateRoot, "adaptation");
  try {
    await writeFile(adaptationDir, "not a directory", "utf8");

    const { io, out } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 1);
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.equal(report.storage.scanErrors.length, 1);
    assert.match(report.storage.scanErrors[0] ?? "", /adaptation/);
    assert.deepEqual(report.storage.entries, []);
    assert.equal(report.checks.find((check) => check.name === "storage")?.ok, false);
    assert.equal(await readFile(adaptationDir, "utf8"), "not a directory");
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * A directory link is counted where it sits and never descended, so the bytes
 * behind it are attributed to the entry that really holds them and never twice.
 * Attempted everywhere; skipped only when the host cannot create the link at
 * all (unprivileged Windows without junction support, exotic filesystems).
 */
test("doctor counts a directory link without descending into its target", async (t) => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-doctor-storage-link-"));
  const adaptationDir = join(stateRoot, "adaptation");
  const targetDir = join(adaptationDir, "eval-datasets");
  const nestedDir = join(adaptationDir, "feedback");
  const topLink = join(adaptationDir, "linked-datasets");
  const nestedLink = join(nestedDir, "linked-datasets");
  try {
    await mkdir(join(targetDir, "run-1"), { recursive: true });
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(targetDir, "run-1", "rows.jsonl"), INVOCATIONS, "utf8");
    try {
      const type = process.platform === "win32" ? "junction" : "dir";
      await symlink(targetDir, topLink, type);
      await symlink(targetDir, nestedLink, type);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS" || code === "UNKNOWN") {
        t.skip(`this host cannot create directory links (${code})`);
        return;
      }
      throw error;
    }

    const { io, out, err } = capture();
    const code = await doctorCommand(["--json", "--state-root", stateRoot], io, {
      nodeVersion: COMPLIANT_NODE_VERSION
    });
    assert.equal(code, 0, err.join(""));
    const report = JSON.parse(out.join("")) as DoctorJsonReport;

    assert.deepEqual(report.storage.scanErrors, []);
    const byPath = new Map(report.storage.entries.map((entry) => [entry.path, entry]));
    assert.deepEqual(byPath.get(topLink), {
      path: topLink,
      plane: "adaptation",
      kind: "link",
      bytes: 0,
      files: 0,
      links: 1
    });
    assert.deepEqual(
      byPath.get(nestedDir),
      { path: nestedDir, plane: "adaptation", kind: "directory", bytes: 0, files: 0, links: 1 },
      "a link inside a subtree is counted there, not walked through"
    );
    assert.deepEqual(byPath.get(targetDir), {
      path: targetDir,
      plane: "adaptation",
      kind: "directory",
      bytes: bytes(INVOCATIONS),
      files: 1,
      links: 0
    });
    assert.equal(
      report.storage.entries.reduce((sum, entry) => sum + entry.bytes, 0),
      bytes(INVOCATIONS),
      "the linked target's bytes are counted exactly once"
    );
    const storage = report.checks.find((check) => check.name === "storage");
    assert.equal(storage?.ok, true);
    assert.match(storage?.detail ?? "", /2 link\(s\) counted but not followed/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
