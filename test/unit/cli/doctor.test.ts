import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { doctorCommand, type DoctorJsonReport } from "../../../src/cli/doctor.js";

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
      /^  FAIL {2}node: 22\.18\.9 \(engines >=22\.19\.0\) — need >= 22\.19\.0$/m
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

const CONTRACT_KEYS = ["version", "preview", "liveAdaptive", "ok", "checks", "next"];

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
        "pi-compat"
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
