import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCliErrorJson } from "../../../src/cli/errors.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import { authStorePath, FileCredentialStore } from "../../../src/pi-adapter/file-credential-store.js";

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
const OAUTH_ACCESS = "oauth-access-do-not-log-6d15";
const OAUTH_REFRESH = "oauth-refresh-do-not-log-9e33";
const CORRUPT_STORE = "{not-json";

/** Every variable Pi consults for openai, plus the compatibility override. */
const OPENAI_ENV = ["OPENAI_API_KEY", "PI_API_KEY"] as const;

/**
 * Every variable Pi consults for anthropic. The oauth cases use anthropic
 * because it is a provider that accepts both an OAuth session and an
 * environment API key, which is what separates the two stored-oauth rows.
 */
const ANTHROPIC_ENV = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "PI_API_KEY"
] as const;

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

/**
 * The variables the process itself needs; every other one is removed for the
 * duration of the case. `status --all` asks whether *anything* configures
 * *any* provider, and the answer has to be a fact about the test rather than
 * about the developer machine it runs on — a stray key in the shell would
 * otherwise decide whether the empty-state notice is reachable.
 */
const ENV_KEPT_BY_EMPTY_ENVIRONMENT = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "ComSpec",
  "windir",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_V8_COVERAGE"
]);

async function withEmptyEnvironment(run: () => Promise<void>): Promise<void> {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (!ENV_KEPT_BY_EMPTY_ENVIRONMENT.has(key)) delete process.env[key];
  }
  try {
    await run();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

function withoutOpenAiEnv(
  extra: Readonly<Record<string, string | undefined>> = {}
): Record<string, string | undefined> {
  return { ...Object.fromEntries(OPENAI_ENV.map((key) => [key, undefined])), ...extra };
}

function withoutAnthropicEnv(
  extra: Readonly<Record<string, string | undefined>> = {}
): Record<string, string | undefined> {
  return { ...Object.fromEntries(ANTHROPIC_ENV.map((key) => [key, undefined])), ...extra };
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

/**
 * A real oauth-shaped credential, written through the file store rather than
 * through `auth login --oauth`: the login flow performs a token exchange, and
 * nothing here goes near the network.
 */
async function storeOauth(stateRoot: string, providerId: string): Promise<void> {
  await new FileCredentialStore(authStorePath(stateRoot)).modify(providerId, async () => ({
    type: "oauth",
    access: OAUTH_ACCESS,
    refresh: OAUTH_REFRESH,
    expires: Date.now() + 3_600_000
  }));
}

async function writeCorruptStore(stateRoot: string): Promise<string> {
  const path = authStorePath(stateRoot);
  await mkdir(join(stateRoot, "runtime"), { recursive: true });
  await writeFile(path, CORRUPT_STORE, "utf8");
  return path;
}

async function writeCustomProviders(
  stateRoot: string,
  extra: readonly Record<string, unknown>[] = []
): Promise<void> {
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
          },
          ...extra
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
      // The refusal describes what the probe actually accepts. It runs Pi's
      // own resolution against an empty store, so ambient sources beyond
      // environment variables count, and auth.json does not.
      assert.match(text, /ADC files or AWS profiles/);
      assert.match(text, /ignores auth\.json/);
      assert.doesNotMatch(text, /environment variables only/);
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

test("--from-env answers off the environment when auth.json cannot be parsed at all", async () => {
  // The probe runs against an empty store and never opens the file, so the
  // only thing a damaged auth.json can cost is the precedence note. It used to
  // cost the whole command: the note's `list()` threw under the success path
  // and the operator got exit 1 for a question the environment had answered.
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv({ OPENAI_API_KEY: ENV_KEY }), async () => {
      const path = await writeCorruptStore(stateRoot);

      const { io, out, err } = capture();
      const code = await main(["auth", "login", "openai", "--from-env", "--state-root", stateRoot], io);
      assert.equal(code, 0, err.join(""));

      const text = out.join("");
      assert.match(text, /configured by the environment via OPENAI_API_KEY/);
      assert.match(text, /nothing written to auth\.json/);
      assert.equal(text.includes(ENV_KEY), false, "the value never leaves the environment");
      // A file that cannot be parsed holds no stored credential to name, so
      // the note is withheld — and its absence is said out loud rather than
      // read as "nothing outranks the environment".
      assert.doesNotMatch(text, /wins over the environment/);
      const warning = err.join("");
      assert.match(warning, new RegExp(`warning: ${path} could not be read`));
      assert.match(warning, /outranks the environment is unknown/);

      // A check does not repair, rewrite or move a credential file.
      assert.equal(await readFile(path, "utf8"), CORRUPT_STORE);
    });
  });
});

test("--from-env treats a stored oauth session as a file, not as an environment", async () => {
  // The row that would catch a source-sentinel shortcut: an implementation
  // that filtered `checkAuth().source` instead of emptying the store could see
  // an oauth credential resolve and call the environment configured.
  await withStateRoot(async (stateRoot) => {
    await storeOauth(stateRoot, "anthropic");
    const before = await readFile(authStorePath(stateRoot), "utf8");

    await withEnv(withoutAnthropicEnv(), async () => {
      const { io, out, err } = capture();
      const code = await main(
        ["auth", "login", "anthropic", "--from-env", "--state-root", stateRoot],
        io
      );
      assert.equal(code, 1, "an oauth session on disk is not an environment");
      assert.equal(out.join(""), "");
      const text = err.join("");
      assert.match(text, /not configured in the environment/);
      assert.equal(text.includes(OAUTH_ACCESS), false);
      assert.equal(text.includes(OAUTH_REFRESH), false);
    });

    assert.equal(await readFile(authStorePath(stateRoot), "utf8"), before);
  });
});

test("--from-env passes behind a stored oauth session when the environment also configures the provider", async () => {
  await withStateRoot(async (stateRoot) => {
    await storeOauth(stateRoot, "anthropic");

    await withEnv(withoutAnthropicEnv({ ANTHROPIC_API_KEY: ENV_KEY }), async () => {
      const { io, out, err } = capture();
      const code = await main(
        ["auth", "login", "anthropic", "--from-env", "--state-root", stateRoot],
        io
      );
      assert.equal(code, 0, err.join(""));
      const text = out.join("");
      assert.match(text, /configured by the environment via ANTHROPIC_API_KEY/);
      // The oauth session still outranks the key, so the operator is told.
      assert.match(text, new RegExp(`stored credential for anthropic in ${authStorePath(stateRoot)}`));
      assert.match(text, /wins over the environment/);
      assert.equal(text.includes(ENV_KEY), false);
      assert.equal(text.includes(OAUTH_ACCESS), false);
      assert.equal(text.includes(OAUTH_REFRESH), false);
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

test("a keyless custom provider refuses every login mode that would store a key", async () => {
  // `--from-env` is refused elsewhere; these are the modes that write. The
  // resolver the runtime builds for a custom provider with no envVar returns
  // without consulting the credential Pi hands it, so what login would leave
  // behind is a secret this provider never asks for — and an operator who
  // believes it is configured.
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await storeKey(stateRoot, "openai", STORED_KEY);
    const before = await readFile(authStorePath(stateRoot), "utf8");

    const invocations = [
      ["auth", "login", "keyless", "--key", ROTATED_KEY, "--state-root", stateRoot],
      ["auth", "login", "keyless", "--oauth", "--state-root", stateRoot],
      ["auth", "login", "keyless", "--state-root", stateRoot]
    ];
    for (const argv of invocations) {
      const { io, out, err } = capture();
      assert.equal(await main(argv, io), 1, `${argv.join(" ")} must be refused`);
      assert.equal(out.join(""), "", "a refusal must not print a success line");
      const text = err.join("");
      assert.match(text, /provider keyless is a custom provider with no envVar in providers\.json/);
      assert.match(text, /its request resolver ignores auth\.json; auth login cannot configure it/);
      assert.match(text, /add envVar to providers\.json and use that variable or stored login/);
      assert.match(
        text,
        /per-run PI_API_KEY compatibility override for the selected default provider/
      );
      // The refusal is about auth.json, and it may not overreach into a claim
      // about the wire: PI_API_KEY is forwarded as the request key for the
      // selected default provider, so these requests can carry a key — just
      // never one that came from a login. Nor may it say "remove the flag",
      // which only routes the operator into the interactive mode this same
      // guard refuses.
      assert.doesNotMatch(text, /requests are sent with no key/);
      assert.doesNotMatch(text, /remove the flag/);
      assert.equal(text.includes(ROTATED_KEY), false, "a refusal must not echo the key");
    }

    // Not "no new entry": the file the operator already had is untouched.
    assert.equal(await readFile(authStorePath(stateRoot), "utf8"), before);
  });
});

test("a custom provider that does name an envVar still logs in normally", async () => {
  // The guard has to separate "keyless" from "self-configured", not refuse
  // every custom provider.
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    const { io, out, err } = capture();
    const code = await main(
      ["auth", "login", "gateway", "--key", STORED_KEY, "--state-root", stateRoot],
      io
    );
    assert.equal(code, 0, err.join(""));
    assert.match(out.join(""), /Stored api_key credential for gateway/);
    assert.equal(out.join("").includes(STORED_KEY), false);
    assert.match(await readFile(authStorePath(stateRoot), "utf8"), /"gateway"/);
  });
});

test("status --all names the empty state instead of printing nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEmptyEnvironment(async () => {
      const { io, out, err } = capture();
      const code = await main(["auth", "status", "--all", "--state-root", stateRoot], io);
      assert.equal(code, 0, err.join(""));
      const text = out.join("");
      // Both halves: --all used to suppress the stored-credential notice *and*
      // print no environment rows, which is a command that exits 0 having said
      // nothing at all about either plane.
      assert.match(text, /No stored credentials\./);
      assert.match(text, /\(no environment-configured providers found\)/);
    });
  });
});

test("status --all labels each row by what actually resolved the provider", async () => {
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await withEnv(
      withoutOpenAiEnv({ OPENAI_API_KEY: ENV_KEY, SPARKLE_TEST_GATEWAY_KEY: ENV_KEY }),
      async () => {
        const { io, out, err } = capture();
        const code = await main(["auth", "status", "--all", "--state-root", stateRoot], io);
        assert.equal(code, 0, err.join(""));
        const text = out.join("");
        // The source column starts at the same offset on every row: the label
        // is derived, the layout is not. `keyless (no key)` is not a variable
        // and used to be printed under a hardcoded `env`.
        assert.match(text, /^keyless {22}ambient {3}keyless \(no key\)$/m);
        assert.match(text, /^gateway {22}env {7}SPARKLE_TEST_GATEWAY_KEY$/m);
        assert.match(text, /^openai {23}env {7}OPENAI_API_KEY$/m);
        assert.equal(text.includes(ENV_KEY), false, "the value never leaves the environment");
      }
    );
  });
});

test("a custom row is labelled env by its configured envVar, not by a matching variable", async () => {
  // The hole in "does this source name a variable that is set": a custom
  // provider's source is under the operator's control through its id, so a
  // variable that happens to be spelled like one would relabel a row that no
  // environment variable configures. `providers.json` is what decides.
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot);
    await withEnv({ "keyless (no key)": ENV_KEY, SPARKLE_TEST_GATEWAY_KEY: undefined }, async () => {
      const { io, out, err } = capture();
      const code = await main(["auth", "status", "--all", "--state-root", stateRoot], io);
      assert.equal(code, 0, err.join(""));
      assert.match(out.join(""), /^keyless {22}ambient {3}keyless \(no key\)$/m);
    });
  });
});

/** Configured with the spaces intact, and looked up under that exact key. */
const PADDED_ENV_VAR = " SPARKLE_TEST_PADDED_KEY ";

test("a custom row is env when the configured envVar that resolved it carries spaces", async () => {
  // `providers.json` keeps `envVar` exactly as written and the runtime hands
  // those same bytes to the resolver as the lookup key, so this variable — the
  // padded one, not its trimmed spelling — is what configures the provider,
  // and Pi reports it back unchanged. Comparing a trimmed copy of the
  // configured name against that source labelled the row `ambient` while it
  // was resolving through the variable the operator had configured.
  await withStateRoot(async (stateRoot) => {
    await writeCustomProviders(stateRoot, [
      {
        id: "padded",
        baseUrl: "http://127.0.0.1:9/v1",
        envVar: PADDED_ENV_VAR,
        models: [{ id: "m1" }]
      }
    ]);
    await withEnv(
      {
        [PADDED_ENV_VAR]: ENV_KEY,
        SPARKLE_TEST_PADDED_KEY: undefined,
        SPARKLE_TEST_GATEWAY_KEY: undefined
      },
      async () => {
        const { io, out, err } = capture();
        const code = await main(["auth", "status", "--all", "--state-root", stateRoot], io);
        assert.equal(code, 0, err.join(""));
        const text = out.join("");
        // Seven spaces pad `env` to the source column; the eighth belongs to
        // the source itself, which is the configured name spaces and all.
        assert.match(text, /^padded {23}env {7} SPARKLE_TEST_PADDED_KEY $/m);
        assert.equal(text.includes(ENV_KEY), false, "the value never leaves the environment");
      }
    );
  });
});

test("a builtin whose source names no single variable stays ambient, understating the environment", async () => {
  // Pinned as the cost of the heuristic, not as the desired reading. Pi
  // returns `AWS access keys` only after both AWS_ACCESS_KEY_ID and
  // AWS_SECRET_ACCESS_KEY resolve, so this row *is* configured by the
  // environment and still prints `ambient` — the source is a phrase, not a
  // variable name, and hardcoding the pair here would re-derive the variable
  // lists Pi keeps inside its resolvers. Pinned so that trade-off cannot move
  // without a test saying so, and so the column is never documented as
  // separating environment from non-environment sources.
  await withStateRoot(async (stateRoot) => {
    await withEmptyEnvironment(async () => {
      await withEnv(
        { AWS_ACCESS_KEY_ID: "AKIA-do-not-log-2f60", AWS_SECRET_ACCESS_KEY: ENV_KEY },
        async () => {
          const { io, out, err } = capture();
          const code = await main(["auth", "status", "--all", "--state-root", stateRoot], io);
          assert.equal(code, 0, err.join(""));
          const text = out.join("");
          assert.match(text, /^amazon-bedrock {15}ambient {3}AWS access keys$/m);
          assert.equal(text.includes(ENV_KEY), false, "the value never leaves the environment");
        }
      );
    });
  });
});

test("login and logout report a missing <provider> in the structured error dialect", async () => {
  for (const [verb, argv] of [
    ["auth login", ["auth", "login"]],
    ["auth logout", ["auth", "logout"]]
  ] as const) {
    const { io, out, err } = capture();
    assert.equal(await main([...argv], io), 1);
    assert.equal(out.join(""), "");
    const report = parseCliErrorJson(err.join(""));
    assert.ok(report !== undefined, `${verb} must emit a parseable report`);
    assert.equal(report.command, verb);
    assert.equal(report.stage, "parse-args");
    assert.equal(report.message, `${verb} requires <provider>`);
    assert.equal(report.next, "run pi-sparkle auth --help");
  }
});

test("login keeps echoing usage before its report; logout does not invent one", async () => {
  const login = capture();
  assert.equal(await main(["auth", "login"], login.io), 1);
  const loginText = login.err.join("");
  assert.ok(
    loginText.indexOf("Usage:") < loginText.indexOf("error: auth login requires"),
    "the usage echo comes before the report"
  );

  const logout = capture();
  assert.equal(await main(["auth", "logout"], logout.io), 1);
  assert.doesNotMatch(logout.err.join(""), /Usage:/);
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

test("a damaged auth.json is named by every verb that needs it, called safe to move aside, and left on disk", async () => {
  // "Every verb that needs it" is the whole surface except one: `--from-env`
  // with a live environment key answers without the file and exits 0, which
  // the test above pins. Everything here has to read or write auth.json to do
  // its job, so there is nothing honest to report but the failure.
  await withStateRoot(async (stateRoot) => {
    await withEnv(withoutOpenAiEnv(), async () => {
      const path = await writeCorruptStore(stateRoot);

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
