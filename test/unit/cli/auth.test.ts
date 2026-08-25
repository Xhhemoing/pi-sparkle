import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, type CliIo } from "../../../src/cli/main.js";
import { authStorePath } from "../../../src/pi-adapter/file-credential-store.js";

/**
 * The operator-facing half of `auth`: which flag combinations are refused,
 * what `--from-env` is allowed to call success, and what the three verbs say
 * when the credential file is damaged or empty. Driven through `main` so the
 * exit code and the structured failure report are part of what is asserted —
 * a message that reads well but exits 0 is exactly the failure mode these
 * cover.
 *
 * Offline by construction: no login flow here prompts or reaches the network,
 * and every environment variable the exercised providers consult is cleared
 * inside the test, so a developer machine with a real key cannot change the
 * outcome.
 */
const STORED_KEY = "sk-stored-do-not-log-4a71";
const ROTATED_KEY = "sk-rotated-do-not-log-8c02";
const ENV_KEY = "sk-env-do-not-log-13be";

/** Every variable Pi consults for openai, plus the compatibility override. */
const OPENAI_ENV = ["OPENAI_API_KEY", "PI_API_KEY"] as const;

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) }, out, err };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auth-cli-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
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

function withoutOpenAiEnv(
  extra: Readonly<Record<string, string | undefined>> = {}
): Record<string, string | undefined> {
  return { ...Object.fromEntries(OPENAI_ENV.map((key) => [key, undefined])), ...extra };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function storeKey(stateRoot: string, providerId: string, key: string): Promise<void> {
  const { io, err } = capture();
  const code = await main(["auth", "login", providerId, "--key", key, "--state-root", stateRoot], io);
  assert.equal(code, 0, err.join(""));
}

async function writeCustomProviders(stateRoot: string): Promise<void> {
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  await writeFile(
    join(stateRoot, "runtime", "providers.json"),
    `${JSON.stringify(
      {
        version: 1,
        enabled: [],
        customProviders: [
          { id: "keyless", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m1" }] },
          {
            id: "gateway",
            baseUrl: "http://127.0.0.1:9/v1",
            envVar: "SPARKLE_TEST_GATEWAY_KEY",
            models: [{ id: "m1" }]
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

test("the login modes are mutually exclusive and no combination writes a credential", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv(), async () => {
      const combinations = [
        ["--key", ROTATED_KEY, "--from-env"],
        ["--key", ROTATED_KEY, "--oauth"],
        ["--from-env", "--oauth"],
        ["--key", ROTATED_KEY, "--from-env", "--oauth"]
      ];
      for (const flags of combinations) {
        const { io, err } = capture();
        const code = await main(
          ["auth", "login", "openai", ...flags, "--state-root", stateRoot],
          io
        );
        assert.equal(code, 1, `${flags.join(" ")} must be refused`);
        const text = err.join("");
        assert.match(text, /takes one of --key, --from-env, --oauth/);
        assert.equal(text.includes(ROTATED_KEY), false, "a refusal must not echo the key");
      }
      assert.equal(await exists(authStorePath(stateRoot)), false);
    });
  });
});

test("a --key rotation combined with --from-env is refused instead of silently dropped", async () => {
  // The dangerous case: this used to take the --from-env branch, report the
  // *old* stored credential as success, and never write the new key.
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv({ OPENAI_API_KEY: ENV_KEY }), async () => {
      await storeKey(stateRoot, "openai", STORED_KEY);

      const { io, out, err } = capture();
      const code = await main(
        ["auth", "login", "openai", "--key", ROTATED_KEY, "--from-env", "--state-root", stateRoot],
        io
      );
      assert.equal(code, 1);
      assert.equal(out.join(""), "", "a refused rotation must not print success");
      assert.match(err.join(""), /nothing was stored/);

      const raw = await readFile(authStorePath(stateRoot), "utf8");
      assert.equal(raw.includes(ROTATED_KEY), false, "the rejected key must not be stored");
      assert.match(raw, new RegExp(STORED_KEY), "the existing credential must survive");
    });
  });
});

test("--from-env fails closed when only a stored credential configures the provider", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv(), async () => {
      await storeKey(stateRoot, "openai", STORED_KEY);
      const before = await readFile(authStorePath(stateRoot), "utf8");

      const { io, out, err } = capture();
      const code = await main(["auth", "login", "openai", "--from-env", "--state-root", stateRoot], io);
      assert.equal(code, 1, "a stored credential is not an environment");
      assert.equal(out.join(""), "");
      const text = err.join("");
      assert.match(text, /not configured in the environment/);
      assert.match(text, /environment variables only/);
      assert.equal(text.includes(STORED_KEY), false);

      assert.equal(await readFile(authStorePath(stateRoot), "utf8"), before);
    });
  });
});

test("--from-env succeeds off the environment, names the variable, and writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv({ OPENAI_API_KEY: ENV_KEY }), async () => {
      const { io, out, err } = capture();
      const code = await main(["auth", "login", "openai", "--from-env", "--state-root", stateRoot], io);
      assert.equal(code, 0, err.join(""));
      const text = out.join("");
      assert.match(text, /configured by the environment via OPENAI_API_KEY/);
      assert.match(text, /nothing written to auth\.json/);
      assert.equal(text.includes(ENV_KEY), false, "the value never leaves the environment");
      assert.equal(await exists(authStorePath(stateRoot)), false);
    });
  });
});

test("--from-env discloses a stored credential that outranks the environment", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv({ OPENAI_API_KEY: ENV_KEY }), async () => {
      await storeKey(stateRoot, "openai", STORED_KEY);

      const { io, out, err } = capture();
      const code = await main(["auth", "login", "openai", "--from-env", "--state-root", stateRoot], io);
      assert.equal(code, 0, err.join(""));
      const text = out.join("");
      assert.match(text, /configured by the environment via OPENAI_API_KEY/);
      assert.match(text, new RegExp(`stored credential for openai in ${authStorePath(stateRoot)}`));
      assert.match(text, /wins over the environment/);
      assert.match(text, /auth logout openai/);
      assert.equal(text.includes(STORED_KEY), false);
      assert.equal(text.includes(ENV_KEY), false);
    });
  });
});

test("--from-env on custom providers checks their configured variable, or refuses when there is none", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await withEnv({ SPARKLE_TEST_GATEWAY_KEY: undefined }, async () => {
      const keyless = capture();
      assert.equal(
        await main(["auth", "login", "keyless", "--from-env", "--state-root", stateRoot], keyless.io),
        1,
        "a provider with no envVar has nothing to check"
      );
      assert.match(keyless.err.join(""), /no envVar in providers\.json/);

      const unset = capture();
      assert.equal(
        await main(["auth", "login", "gateway", "--from-env", "--state-root", stateRoot], unset.io),
        1
      );
      assert.match(unset.err.join(""), /SPARKLE_TEST_GATEWAY_KEY is unset or empty/);
    });

    await withEnv({ SPARKLE_TEST_GATEWAY_KEY: ENV_KEY }, async () => {
      const set = capture();
      const code = await main(
        ["auth", "login", "gateway", "--from-env", "--state-root", stateRoot],
        set.io
      );
      assert.equal(code, 0, set.err.join(""));
      assert.match(set.out.join(""), /configured by the environment via SPARKLE_TEST_GATEWAY_KEY/);
      assert.equal(set.out.join("").includes(ENV_KEY), false);
    });
    assert.equal(await exists(authStorePath(stateRoot)), false);
  });
});

test("logout distinguishes a removal from a provider that was never stored", async () => {
  await withStateRoot(async (stateRoot) => {
    const missing = capture();
    assert.equal(
      await main(["auth", "logout", "openai", "--state-root", stateRoot], missing.io),
      0,
      "logging out twice has to stay safe"
    );
    assert.match(missing.out.join(""), /No stored credential for openai/);
    assert.match(missing.out.join(""), /nothing to remove/);
    assert.equal(await exists(authStorePath(stateRoot)), false, "logout must not create the file");

    await storeKey(stateRoot, "openai", STORED_KEY);
    const removal = capture();
    assert.equal(await main(["auth", "logout", "openai", "--state-root", stateRoot], removal.io), 0);
    assert.match(removal.out.join(""), /Removed stored credential for openai/);

    const again = capture();
    assert.equal(await main(["auth", "logout", "openai", "--state-root", stateRoot], again.io), 0);
    assert.match(again.out.join(""), /No stored credential for openai/);
  });
});

test("a damaged auth.json is named by every verb, called safe to move aside, and left on disk", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv(), async () => {
      const path = authStorePath(stateRoot);
      await mkdir(join(stateRoot, "runtime"), { recursive: true });
      await writeFile(path, "{not-json", "utf8");

      const invocations = [
        ["auth", "status", "--state-root", stateRoot],
        ["auth", "login", "openai", "--key", ROTATED_KEY, "--state-root", stateRoot],
        ["auth", "logout", "openai", "--state-root", stateRoot]
      ];
      for (const argv of invocations) {
        const { io, err } = capture();
        assert.equal(await main(argv, io), 1, `${argv[1] ?? ""} must fail closed`);
        const text = err.join("");
        assert.match(text, new RegExp(`auth\\.json at ${path} is unreadable`));
        assert.match(text, /safe to move aside/);
        assert.match(text, new RegExp(`next: move ${path} aside`));
        assert.match(text, /will not delete it for you/);
        assert.equal(text.includes(ROTATED_KEY), false);
      }

      // The remedy is the operator's to run: nothing here deletes a secret.
      assert.equal(await readFile(path, "utf8"), "{not-json");
    });
  });
});

test("auth --help names the file auth actually writes", async () => {
  const { io, out, err } = capture();
  assert.equal(await main(["auth", "--help"], io), 0, err.join(""));
  const text = out.join("");
  const stateRoot = join(tmpdir(), "sparkle-usage-probe");
  const relative = authStorePath(stateRoot).slice(stateRoot.length);
  assert.ok(
    text.includes(`<state-root>${relative}`),
    `usage must name <state-root>${relative}, got: ${text}`
  );
  assert.match(text, /login takes exactly one mode/);
  assert.match(text, /--from-env\nstores nothing/);
});
