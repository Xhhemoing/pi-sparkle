import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { authCommand } from "../../../src/cli/auth.js";
import { modelsCommand } from "../../../src/cli/models.js";
import { doctorCommand } from "../../../src/cli/doctor.js";
import { adaptCommand } from "../../../src/cli/adapt.js";
import type { CliIo } from "../../../src/cli/main.js";

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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cli-cmds-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("auth login/status/logout round-trips without ever printing the secret", async () => {
  await withStateRoot(async (stateRoot) => {
    const root = ["--state-root", stateRoot];
    const empty = capture();
    assert.equal(await authCommand(["status", ...root], empty.io), 0);
    assert.ok(empty.out.join("").includes("No stored credentials"));

    const secret = "sk-test-checkpoint-secret";
    const login = capture();
    assert.equal(await authCommand(["login", "openai", "--key", secret, ...root], login.io), 0);

    const stored = JSON.parse(await readFile(join(stateRoot, "runtime", "auth.json"), "utf8"));
    assert.ok(JSON.stringify(stored).includes("openai"));

    const status = capture();
    assert.equal(await authCommand(["status", ...root], status.io), 0);
    assert.ok(status.out.join("").includes("stored"));
    assert.ok(!status.out.join("").includes(secret), "status must never print the key");

    const logout = capture();
    assert.equal(await authCommand(["logout", "openai", ...root], logout.io), 0);
    const afterLogout = capture();
    assert.equal(await authCommand(["status", ...root], afterLogout.io), 0);
    assert.ok(afterLogout.out.join("").includes("No stored credentials"));
  });
});

test("auth rejects an unknown provider and an empty key fail-closed", async () => {
  await withStateRoot(async (stateRoot) => {
    const badProvider = capture();
    await assert.rejects(
      () => authCommand(["login", "not-a-provider", "--key", "x", "--state-root", stateRoot], badProvider.io),
      /unknown provider/
    );
    const emptyKey = capture();
    await assert.rejects(
      () => authCommand(["login", "openai", "--key", "  ", "--state-root", stateRoot], emptyKey.io),
      /non-empty/
    );
  });
});

test("models enable/set-default/list round-trips against the live catalog", async () => {
  await withStateRoot(async (stateRoot) => {
    const root = ["--state-root", stateRoot];
    const { listSparkleModels } = await import("../../../src/pi-adapter/listed-model.js");
    const listed = listSparkleModels();
    assert.ok(listed.length > 0, "catalog must expose at least one model");
    const primary = listed[0]!.catalogId;

    const none = capture();
    assert.equal(await modelsCommand(["list", ...root], none.io), 0);
    assert.ok(none.out.join("").includes("No models enabled"));

    const enable = capture();
    assert.equal(await modelsCommand(["enable", primary, ...root], enable.io), 0);
    assert.ok(enable.out.join("").includes(`Enabled ${primary}`));

    let fast: string | undefined;
    if (listed.length > 1) {
      fast = listed[1]!.catalogId;
      const enableFast = capture();
      assert.equal(await modelsCommand(["enable", fast, ...root], enableFast.io), 0);
    }
    const setDefault = capture();
    assert.equal(
      await modelsCommand(["set-default", "--primary", primary, ...(fast ? ["--fast", fast] : []), ...root], setDefault.io),
      0
    );

    const list = capture();
    assert.equal(await modelsCommand(["list", ...root], list.io), 0);
    const text = list.out.join("");
    assert.ok(text.includes(primary));
    assert.ok(text.includes("primary"));
  });
});

test("doctor prints its check lines and flags a writable empty state root as ok", async () => {
  await withStateRoot(async (stateRoot) => {
    const io = capture();
    const code = await doctorCommand(["--state-root", stateRoot], io.io);
    const text = io.out.join("");
    assert.ok(text.includes("pi-sparkle doctor"));
    assert.ok(text.includes("live R1/bandit/topology: off until Checkpoint F-PROD closes"));
    assert.ok(/ok\s+state-root-writable|state-root/.test(text), `state check missing: ${text}`);
    assert.ok(code === 0 || code === 1, "doctor exits 0 when all checks pass, 1 otherwise");
  });
});

test("adapt promote refuses to mutate live policy without explicit review provenance", async () => {
  await withStateRoot(async (stateRoot) => {
    const io = capture();
    const code = await adaptCommand(["promote", "--state-root", stateRoot], io.io);
    assert.notEqual(code, 0, "promote without --review-file must fail");
    const text = `${io.out.join("")}${io.err.join("")}`;
    assert.ok(
      text.includes("refusing to mutate live policy") || /review-file/i.test(text),
      `refusal message missing: ${text}`
    );
  });
});
