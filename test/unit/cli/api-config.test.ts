import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { loadProvidersConfig } from "../../../src/config/providers-config.js";
import { FileCredentialStore } from "../../../src/pi-adapter/file-credential-store.js";

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

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-api-cli-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("auth login --key stores a credential that status lists without the secret", async () => {
  await withStateRoot(async (stateRoot) => {
    const login = capture();
    const loginCode = await main(
      ["auth", "login", "openai", "--key", "sk-test-secret-value", "--state-root", stateRoot],
      login.io
    );
    assert.equal(loginCode, 0, login.err.join(""));
    assert.equal(login.out.join("").includes("sk-test-secret-value"), false);

    const status = capture();
    const statusCode = await main(["auth", "status", "--state-root", stateRoot], status.io);
    assert.equal(statusCode, 0, status.err.join(""));
    const text = status.out.join("");
    assert.match(text, /openai/);
    assert.match(text, /api_key|stored/);
    assert.equal(text.includes("sk-test-secret-value"), false);

    const raw = await readFile(join(stateRoot, "auth.json"), "utf8");
    assert.match(raw, /sk-test-secret-value/);
  });
});

test("auth logout removes the stored credential", async () => {
  await withStateRoot(async (stateRoot) => {
    await new FileCredentialStore(join(stateRoot, "auth.json")).modify("openai", async () => ({
      type: "api_key",
      key: "sk-gone"
    }));
    const { io, err } = capture();
    const code = await main(["auth", "logout", "openai", "--state-root", stateRoot], io);
    assert.equal(code, 0, err.join(""));
    assert.equal(await new FileCredentialStore(join(stateRoot, "auth.json")).read("openai"), undefined);
  });
});

test("models enable, set-default, and list keep an allowlist without secrets", async () => {
  await withStateRoot(async (stateRoot) => {
    const enable = capture();
    assert.equal(
      await main(["models", "enable", "openai/gpt-4o-mini", "--state-root", stateRoot], enable.io),
      0,
      enable.err.join("")
    );
    const defaults = capture();
    assert.equal(
      await main(
        [
          "models",
          "set-default",
          "--primary",
          "anthropic/claude-sonnet-4-5",
          "--fast",
          "openai/gpt-4o-mini",
          "--state-root",
          stateRoot
        ],
        defaults.io
      ),
      0,
      defaults.err.join("")
    );
    const list = capture();
    assert.equal(await main(["models", "list", "--state-root", stateRoot], list.io), 0, list.err.join(""));
    const text = list.out.join("");
    assert.match(text, /openai\/gpt-4o-mini/);
    assert.match(text, /anthropic\/claude-sonnet-4-5/);
    assert.match(text, /primary/);
    assert.match(text, /fast/);
    assert.equal(text.toLowerCase().includes("sk-"), false);
    const config = await loadProvidersConfig(stateRoot);
    assert.equal(config.primary, "anthropic/claude-sonnet-4-5");
    assert.equal(config.fast, "openai/gpt-4o-mini");
  });
});

test("models list --available --provider openai shows builtin catalog ids", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, out, err } = capture();
    const code = await main(
      ["models", "list", "--available", "--provider", "openai", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /openai\/gpt-4o-mini/);
  });
});

test("models enable rejects unknown catalog ids", async () => {
  await withStateRoot(async (stateRoot) => {
    const { io, err } = capture();
    const code = await main(
      ["models", "enable", "openai/not-a-real-model-zzz", "--state-root", stateRoot],
      io
    );
    assert.equal(code, 1);
    assert.match(err.join(""), /unknown model/i);
  });
});
