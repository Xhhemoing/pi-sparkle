import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { parseCliErrorJson } from "../../../src/cli/errors.js";

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
    const code = await main(["doctor", "--state-root", stateRoot, "--project", projectRoot], io);
    assert.equal(code, 0, err.join(""));
    const text = out.join("");
    assert.match(text, /developer preview/);
    assert.match(text, /not a production capability/);
    assert.match(text, /ok {2}node:/);
    assert.match(text, /ok {2}state-root:/);
    assert.match(text, /live R1\/bandit\/topology: off/);
    assert.match(text, /fake executor/);
    assert.deepEqual(err, []);
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
    const code = await main(["doctor", "--state-root", stateRoot, "--project", projectRoot], io);
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
