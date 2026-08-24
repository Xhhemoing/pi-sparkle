import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { doctorCommand, type DoctorJsonReport } from "../../../src/cli/doctor.js";
import { createEventId, createRunId } from "../../../src/domain/ids.js";
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
  "runStates"
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
        "project",
        "pi-dispatch",
        "skill-route",
        "agent-drift",
        "pi-packages",
        "pi-compat",
        "lock-inventory",
        "run-state-inventory"
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
