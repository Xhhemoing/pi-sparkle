import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AuthPrompt } from "@earendil-works/pi-ai";
import {
  checkProviderAuth,
  checkProviderEnvAuth,
  cliAuthInteraction,
  deleteStoredCredential,
  isKnownProvider,
  listBuiltinProviderIds,
  listStoredCredentials,
  loginProviderInteractive,
  storeApiKeyCredential,
  type SparkleAuthIo
} from "../../../src/pi-adapter/auth-session.js";
import {
  authStorePath,
  FileCredentialStore
} from "../../../src/pi-adapter/file-credential-store.js";
import { DomainValidationError } from "../../../src/domain/errors.js";

/**
 * Offline by construction. Nothing here reaches the network: the only Pi flow
 * exercised is `api_key` login, which prompts and writes the credential store,
 * and stdin is replaced by an injected reader so no test can block on a TTY.
 * The OAuth flow is deliberately not covered — it performs a real token
 * exchange, so it belongs in a live smoke test, not a unit test.
 *
 * Secret hygiene: the fake key below is asserted *against* every string these
 * functions produce, and is never written to stdout by the test itself.
 */
const FAKE_KEY = "fake-key-do-not-log-2f9c";
const UNKNOWN_PROVIDER = "not-a-real-provider-xyz";

interface Recorder {
  readonly io: SparkleAuthIo;
  readonly out: string[];
  readonly asked: string[];
}

/** An io whose reader is a queue of canned answers, so nothing touches stdin. */
function recorder(answers: readonly string[] = []): Recorder {
  const out: string[] = [];
  const asked: string[] = [];
  const pending = [...answers];
  return {
    out,
    asked,
    io: {
      stdout(text: string) {
        out.push(text);
      },
      async question(prompt: string) {
        asked.push(prompt);
        const answer = pending.shift();
        if (answer === undefined) throw new Error(`unexpected prompt: ${prompt}`);
        return answer;
      }
    }
  };
}

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auth-session-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

/**
 * Every environment variable Pi consults for anthropic, so a developer machine
 * that already exports one cannot change what these tests observe.
 */
const ANTHROPIC_ENV = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

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

function clearedAnthropicEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ANTHROPIC_ENV.map((key) => [key, undefined]));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("a stored api key round-trips, and only its metadata is listable", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = await storeApiKeyCredential(stateRoot, "openai", FAKE_KEY);
    assert.equal(path, authStorePath(stateRoot));

    const listed = await listStoredCredentials(stateRoot);
    assert.deepEqual(listed, [{ providerId: "openai", type: "api_key" }]);
    assert.equal(JSON.stringify(listed).includes(FAKE_KEY), false, "list must not carry the key");

    // The key is on disk (that is the point of storing it) but nothing the
    // module returns hands it back.
    assert.match(await readFile(path, "utf8"), /openai/);
  });
});

test("storing a second provider does not disturb the first", async () => {
  await withStateRoot(async (stateRoot) => {
    await storeApiKeyCredential(stateRoot, "openai", FAKE_KEY);
    await storeApiKeyCredential(stateRoot, "anthropic", `${FAKE_KEY}-2`);
    assert.deepEqual(
      (await listStoredCredentials(stateRoot)).map((item) => item.providerId).toSorted(),
      ["anthropic", "openai"]
    );
  });
});

test("delete removes one provider and is idempotent on a missing one", async () => {
  await withStateRoot(async (stateRoot) => {
    await storeApiKeyCredential(stateRoot, "openai", FAKE_KEY);
    await storeApiKeyCredential(stateRoot, "anthropic", `${FAKE_KEY}-2`);

    await deleteStoredCredential(stateRoot, "openai");
    assert.deepEqual(
      (await listStoredCredentials(stateRoot)).map((item) => item.providerId),
      ["anthropic"]
    );
    assert.equal((await readFile(authStorePath(stateRoot), "utf8")).includes("openai"), false);

    // Logging out of a provider that was never stored succeeds and changes
    // nothing, so `auth logout` is safe to re-run.
    await deleteStoredCredential(stateRoot, "openai");
    await deleteStoredCredential(stateRoot, UNKNOWN_PROVIDER);
    assert.deepEqual(
      (await listStoredCredentials(stateRoot)).map((item) => item.providerId),
      ["anthropic"]
    );
  });
});

test("delete on an empty state root creates no credential file", async () => {
  await withStateRoot(async (stateRoot) => {
    await deleteStoredCredential(stateRoot, "openai");
    assert.deepEqual(await listStoredCredentials(stateRoot), []);
    assert.equal(await exists(authStorePath(stateRoot)), false);
  });
});

test("a blank provider id or key is refused instead of written", async () => {
  await withStateRoot(async (stateRoot) => {
    await assert.rejects(
      () => storeApiKeyCredential(stateRoot, "  ", FAKE_KEY),
      DomainValidationError
    );
    // An empty key would shadow a working environment variable with a
    // credential that fails at request time.
    await assert.rejects(() => storeApiKeyCredential(stateRoot, "openai", ""), DomainValidationError);
    await assert.rejects(() => storeApiKeyCredential(stateRoot, "openai", "   "), DomainValidationError);
    await assert.rejects(() => deleteStoredCredential(stateRoot, ""), DomainValidationError);

    assert.equal(await exists(authStorePath(stateRoot)), false);
    assert.deepEqual(await listStoredCredentials(stateRoot), []);
  });
});

test("unknown providers are not recognised, with or without custom providers", async () => {
  assert.equal(await isKnownProvider(UNKNOWN_PROVIDER), false);
  assert.equal(await isKnownProvider(""), false);
  assert.equal(await isKnownProvider("anthropic"), true);

  const custom = [{ id: "in-house", baseUrl: "http://127.0.0.1:9/v1", models: [] }];
  assert.equal(await isKnownProvider("in-house", custom), true);
  assert.equal(await isKnownProvider(UNKNOWN_PROVIDER, custom), false);

  // isKnownProvider is the CLI's gate, so it has to agree with the list the
  // CLI offers.
  const builtin = await listBuiltinProviderIds();
  assert.ok(builtin.includes("anthropic"));
  assert.equal(builtin.includes(UNKNOWN_PROVIDER), false);
});

test("logging in to an unknown provider fails closed and writes nothing", async () => {
  await withStateRoot(async (stateRoot) => {
    const cli = recorder([FAKE_KEY]);
    await assert.rejects(
      () => loginProviderInteractive(stateRoot, UNKNOWN_PROVIDER, "api_key", cli.io),
      /Unknown provider/
    );
    // Rejected before any prompt: a typo must not get as far as asking for a
    // key, let alone storing one.
    assert.deepEqual(cli.asked, []);
    assert.deepEqual(cli.out, []);
    assert.equal(await exists(authStorePath(stateRoot)), false);
    assert.deepEqual(await listStoredCredentials(stateRoot), []);

    await assert.rejects(
      () => loginProviderInteractive(stateRoot, "", "api_key", cli.io),
      DomainValidationError
    );
  });
});

test("an api-key login prompts through the injected reader and never echoes the key", async () => {
  await withStateRoot(async (stateRoot) => {
    const cli = recorder([FAKE_KEY]);
    const path = await loginProviderInteractive(stateRoot, "anthropic", "api_key", cli.io);
    assert.equal(path, authStorePath(stateRoot));

    assert.equal(cli.asked.length, 1, "exactly one prompt for an api-key login");
    assert.match(cli.asked[0] ?? "", /API key/i);
    assert.deepEqual(await listStoredCredentials(stateRoot), [
      { providerId: "anthropic", type: "api_key" }
    ]);

    // The entered secret goes to the credential store and nowhere else.
    assert.equal(cli.out.join("").includes(FAKE_KEY), false);
    assert.equal(cli.asked.join("").includes(FAKE_KEY), false);
  });
});

test("checkProviderAuth reports the environment source without the value", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv({ ...clearedAnthropicEnv(), ANTHROPIC_API_KEY: FAKE_KEY }, async () => {
      const check = await checkProviderAuth(stateRoot, "anthropic");
      assert.deepEqual(check, { type: "api_key", source: "ANTHROPIC_API_KEY" });
      assert.equal(JSON.stringify(check).includes(FAKE_KEY), false);
    });
  });
});

test("checkProviderAuth invents nothing for an unknown or unconfigured provider", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(clearedAnthropicEnv(), async () => {
      assert.equal(await checkProviderAuth(stateRoot, UNKNOWN_PROVIDER), undefined);
      assert.equal(await checkProviderAuth(stateRoot, "anthropic"), undefined);
      assert.equal(await exists(authStorePath(stateRoot)), false);
    });
  });
});

test("the env-only check ignores the credential store the ordinary check prefers", async () => {
  await withStateRoot(async (stateRoot) => {
    await storeApiKeyCredential(stateRoot, "anthropic", FAKE_KEY);

    await withEnv(clearedAnthropicEnv(), async () => {
      // Stored-wins is Pi's precedence and the default login path depends on
      // it, so the ordinary check must keep reporting the stored credential.
      assert.deepEqual(await checkProviderAuth(stateRoot, "anthropic"), {
        type: "api_key",
        source: "stored credential"
      });
      // `--from-env` asks the narrower question, and a file is not an
      // environment: with no variable set there is nothing to report.
      assert.equal(await checkProviderEnvAuth(stateRoot, "anthropic"), undefined);
    });

    await withEnv({ ...clearedAnthropicEnv(), ANTHROPIC_API_KEY: `${FAKE_KEY}-env` }, async () => {
      const env = await checkProviderEnvAuth(stateRoot, "anthropic");
      assert.deepEqual(env, { type: "api_key", source: "ANTHROPIC_API_KEY" });
      assert.equal(JSON.stringify(env).includes(FAKE_KEY), false);
      // The stored credential still owns the provider for everything else.
      assert.deepEqual(await checkProviderAuth(stateRoot, "anthropic"), {
        type: "api_key",
        source: "stored credential"
      });
    });

    // A check writes nothing: the store is exactly what login left behind.
    assert.deepEqual(await listStoredCredentials(stateRoot), [
      { providerId: "anthropic", type: "api_key" }
    ]);
  });
});

test("the env-only check is blind to a stored oauth session too", async () => {
  // An oauth credential resolves through a different Pi path than an api key,
  // so "the store is invisible" has to hold for both. A check that filtered a
  // reported source instead of emptying the store would pass the api-key case
  // above and fail here.
  await withStateRoot(async (stateRoot) => {
    await new FileCredentialStore(authStorePath(stateRoot)).modify("anthropic", async () => ({
      type: "oauth",
      access: `${FAKE_KEY}-access`,
      refresh: `${FAKE_KEY}-refresh`,
      expires: Date.now() + 3_600_000
    }));

    await withEnv(clearedAnthropicEnv(), async () => {
      assert.equal(await checkProviderEnvAuth(stateRoot, "anthropic"), undefined);
    });

    await withEnv({ ...clearedAnthropicEnv(), ANTHROPIC_API_KEY: `${FAKE_KEY}-env` }, async () => {
      const env = await checkProviderEnvAuth(stateRoot, "anthropic");
      assert.deepEqual(env, { type: "api_key", source: "ANTHROPIC_API_KEY" });
      assert.equal(JSON.stringify(env).includes(FAKE_KEY), false);
    });

    // The session is still on disk and still the type it was stored as.
    assert.deepEqual(await listStoredCredentials(stateRoot), [
      { providerId: "anthropic", type: "oauth" }
    ]);
  });
});

test("the env-only check invents nothing for an unknown provider", async () => {
  await withStateRoot(async (stateRoot) => {
    await withEnv(clearedAnthropicEnv(), async () => {
      assert.equal(await checkProviderEnvAuth(stateRoot, UNKNOWN_PROVIDER), undefined);
      assert.equal(await exists(authStorePath(stateRoot)), false);
    });
  });
});

test("logging out reports whether a credential was actually removed", async () => {
  await withStateRoot(async (stateRoot) => {
    assert.equal(await deleteStoredCredential(stateRoot, "openai"), false);
    await storeApiKeyCredential(stateRoot, "openai", FAKE_KEY);
    assert.equal(await deleteStoredCredential(stateRoot, "openai"), true);
    assert.equal(await deleteStoredCredential(stateRoot, "openai"), false);
  });
});

test("the select prompt lists options, resolves to an option id, and refuses a bad answer", async () => {
  const prompt: AuthPrompt = {
    type: "select",
    message: "Choose an auth method",
    options: [
      { id: "api_key", label: "API key" },
      { id: "oauth", label: "Sign in" }
    ]
  };

  const picked = recorder(["2"]);
  assert.equal(await cliAuthInteraction(picked.io).prompt(prompt), "oauth");
  const rendered = picked.out.join("");
  assert.match(rendered, /Choose an auth method/);
  assert.match(rendered, /1\. API key/);
  assert.match(rendered, /2\. Sign in/);

  // Out of range and non-numeric answers fail closed rather than defaulting to
  // an option the user did not choose.
  for (const answer of ["3", "0", "-1", "yes", ""]) {
    const bad = recorder([answer]);
    await assert.rejects(() => cliAuthInteraction(bad.io).prompt(prompt), DomainValidationError);
  }
});

test("consecutive prompts on one interaction both reach the reader", async () => {
  // The interaction used to open a single readline handle and close it after
  // the first prompt, so any two-step login answered its second question on a
  // closed stream.
  const cli = recorder(["chosen-value", FAKE_KEY]);
  const interaction = cliAuthInteraction(cli.io);
  assert.equal(await interaction.prompt({ type: "text", message: "Account" }), "chosen-value");
  assert.equal(await interaction.prompt({ type: "secret", message: "Enter API key" }), FAKE_KEY);
  assert.deepEqual(cli.asked, ["Account: ", "Enter API key: "]);
  assert.equal(cli.out.join("").includes(FAKE_KEY), false);
});

test("notify renders login events without inventing fields", () => {
  const cli = recorder();
  const interaction = cliAuthInteraction(cli.io);
  interaction.notify({ type: "auth_url", url: "https://example.test/authorize" });
  interaction.notify({ type: "device_code", userCode: "ABCD-1234", verificationUri: "https://example.test/device" });
  interaction.notify({ type: "info", message: "waiting" });
  interaction.notify({ type: "progress", message: "exchanging" });

  const text = cli.out.join("");
  assert.match(text, /Open this URL:\nhttps:\/\/example\.test\/authorize/);
  assert.match(text, /Open https:\/\/example\.test\/device and enter code ABCD-1234/);
  assert.match(text, /waiting/);
  assert.match(text, /exchanging/);
  // No instructions supplied, so none are printed.
  assert.equal(text.includes("undefined"), false);
});
