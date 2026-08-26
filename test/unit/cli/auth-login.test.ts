import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { authCommand } from "../../../src/cli/auth.js";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-sparkle-auth-login-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function collectIo(): {
  stdout: string[];
  stderr: string[];
  io: { stdout(text: string): void; stderr(text: string): void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text) => {
        stdout.push(text);
      },
      stderr: (text) => {
        stderr.push(text);
      }
    }
  };
}

test("auth login --key stores the credential and warns about argv leakage", async () => {
  await withDir(async (dir) => {
    const { stdout, stderr, io } = collectIo();
    const code = await authCommand(
      ["login", "openai", "--key", "sk-from-argv-not-for-ps", "--state-root", dir],
      io
    );
    assert.equal(code, 0);
    assert.match(stderr.join(""), /process argv and shell history/);
    assert.match(stdout.join(""), /Stored api_key credential for openai/);
    const stored = await readFile(join(dir, "runtime", "auth.json"), "utf8");
    assert.match(stored, /sk-from-argv-not-for-ps/);
  });
});

test("auth login --key-file stores the trimmed key without the argv warning", async () => {
  await withDir(async (dir) => {
    const keyFile = join(dir, "openai.key");
    await writeFile(keyFile, "sk-from-file-value\n", "utf8");
    const { stdout, stderr, io } = collectIo();
    const code = await authCommand(
      ["login", "openai", "--key-file", keyFile, "--state-root", dir],
      io
    );
    assert.equal(code, 0);
    assert.equal(stderr.join("").includes("process argv"), false);
    assert.match(stdout.join(""), /Stored api_key credential for openai/);
    const stored = await readFile(join(dir, "runtime", "auth.json"), "utf8");
    assert.match(stored, /sk-from-file-value/);
    assert.equal(stored.includes("sk-from-file-value\\n"), false);
  });
});

test("auth login --key-file refuses an unreadable path", async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      () =>
        authCommand(
          ["login", "openai", "--key-file", join(dir, "missing.key"), "--state-root", dir],
          collectIo().io
        ),
      /cannot be read/
    );
  });
});

test("auth login --key-file refuses an empty file", async () => {
  await withDir(async (dir) => {
    const keyFile = join(dir, "empty.key");
    await writeFile(keyFile, " \n", "utf8");
    await assert.rejects(
      () => authCommand(["login", "openai", "--key-file", keyFile, "--state-root", dir], collectIo().io),
      /must be non-empty/
    );
  });
});

test("auth login refuses combining --key and --from-env", async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      () =>
        authCommand(
          ["login", "openai", "--key", "sk-argv", "--from-env", "--state-root", dir],
          collectIo().io
        ),
      /only one of --key-file/
    );
  });
});

test("auth login --key refuses a blank secret", async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      () => authCommand(["login", "openai", "--key", "   ", "--state-root", dir], collectIo().io),
      /--key must be non-empty/
    );
  });
});

test("auth login refuses combining --key and --key-file", async () => {
  await withDir(async (dir) => {
    const keyFile = join(dir, "openai.key");
    await writeFile(keyFile, "sk-file\n", "utf8");
    await assert.rejects(
      () =>
        authCommand(
          ["login", "openai", "--key", "sk-argv", "--key-file", keyFile, "--state-root", dir],
          collectIo().io
        ),
      /only one of --key-file/
    );
  });
});
