import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runAuthorizedCommand } from "../../../src/execution/command-runner.js";

const policy = { timeoutMs: 5_000, maxStdoutBytes: 1024, maxStderrBytes: 1024 };

test("pre-aborted command never starts", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runAuthorizedCommand({
    executable: process.execPath,
    args: ["-e", "process.exit(17)"],
    cwd: process.cwd(),
    env: process.env,
    ...policy,
    signal: controller.signal
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.spawned, false);
});

test("abort terminates a running command and returns bounded output", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "sparkle-runner-"));
  try {
    const controller = new AbortController();
    const running = runAuthorizedCommand({
      executable: process.execPath,
      args: ["-e", "setInterval(() => process.stdout.write('x'), 5)"],
      cwd,
      env: process.env,
      timeoutMs: 5_000,
      maxStdoutBytes: 32,
      maxStderrBytes: 32,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 40).unref();
    const result = await running;
    assert.equal(result.status, "cancelled");
    assert.equal(result.spawned, true);
    assert.ok(result.stdoutByteLength >= result.stdoutText.length);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("output overflow is a distinct terminal result", async () => {
  const result = await runAuthorizedCommand({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(1000))"],
    cwd: process.cwd(),
    env: process.env,
    ...policy,
    maxStdoutBytes: 32
  });
  assert.equal(result.status, "output_limit");
  assert.equal(result.ok, false);
});
