import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { runIndependentCheck } from "../../../src/execution/independent-check.js";
import type { CommandPolicy } from "../../../src/execution/command-policy.js";

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "r4-check-"));
  const git = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git(["init"]);
  git(["config", "user.email", "r4@test"]);
  git(["config", "user.name", "r4"]);
  writeFileSync(path.join(dir, "ok.txt"), "ok\n", "utf8");
  git(["add", "ok.txt"]);
  git(["commit", "-m", "init"]);
  return dir;
}

function nodePolicy(over: Partial<CommandPolicy> = {}): CommandPolicy {
  return {
    allow: [{ executable: "node", argvPrefix: ["-e"], maxArgs: 8 }],
    envAllowlist: [],
    timeoutMs: 10_000,
    maxStdoutBytes: 8,
    maxStderrBytes: 1024,
    ...over
  };
}

test("stdout over maxStdoutBytes fails even when exit is 0 and stderr cap is larger", () => {
  const dir = initRepo();
  try {
    const check = runIndependentCheck({
      cwd: dir,
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(64)); process.exit(0)"],
      commandPolicy: nodePolicy({ maxStdoutBytes: 8, maxStderrBytes: 1024 })
    });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stderr over maxStderrBytes fails even when exit is 0 and stdout cap is larger", () => {
  const dir = initRepo();
  try {
    const check = runIndependentCheck({
      cwd: dir,
      command: "node",
      args: ["-e", "process.stderr.write('y'.repeat(64)); process.exit(0)"],
      commandPolicy: nodePolicy({ maxStdoutBytes: 1024, maxStderrBytes: 8 })
    });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multibyte stdout is measured in bytes not characters", () => {
  const dir = initRepo();
  try {
    const check = runIndependentCheck({
      cwd: dir,
      command: "node",
      args: ["-e", "process.stdout.write('中'); process.exit(0)"],
      commandPolicy: nodePolicy({ maxStdoutBytes: 2, maxStderrBytes: 1024 })
    });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stdout at the exact byte cap still passes when the check is otherwise clean", () => {
  const dir = initRepo();
  try {
    const check = runIndependentCheck({
      cwd: dir,
      command: "node",
      args: ["-e", "process.stdout.write('abcdefgh'); process.exit(0)"],
      commandPolicy: nodePolicy({ maxStdoutBytes: 8, maxStderrBytes: 1024 })
    });
    assert.equal(check.exitCode, 0);
    assert.equal(check.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("timeout must not pass", () => {
  const dir = initRepo();
  try {
    const run = () =>
      runIndependentCheck({
        cwd: dir,
        command: "node",
        args: ["-e", "setTimeout(() => {}, 30000)"],
        commandPolicy: nodePolicy({ timeoutMs: 200, maxStdoutBytes: 1024, maxStderrBytes: 1024 })
      });
    try {
      const check = run();
      assert.equal(check.ok, false);
    } catch (err) {
      assert.ok(err instanceof DomainValidationError);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-positive stream caps are refused", () => {
  const dir = initRepo();
  try {
    assert.throws(
      () =>
        runIndependentCheck({
          cwd: dir,
          command: "node",
          args: ["-e", "process.exit(0)"],
          commandPolicy: nodePolicy({ maxStdoutBytes: 0, maxStderrBytes: 1024 })
        }),
      /positive integer|maxStdoutBytes/
    );
    assert.throws(
      () =>
        runIndependentCheck({
          cwd: dir,
          command: "node",
          args: ["-e", "process.exit(0)"],
          commandPolicy: nodePolicy({ maxStdoutBytes: 8, maxStderrBytes: -1 })
        }),
      /positive integer|maxStderrBytes/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
