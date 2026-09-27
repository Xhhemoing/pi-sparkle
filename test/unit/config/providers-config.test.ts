import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  disableModel,
  emptyProvidersConfig,
  enableModel,
  loadProvidersConfig,
  parseProvidersConfig,
  providersConfigPath,
  saveProvidersConfig,
  setDefaultModels
} from "../../../src/config/providers-config.js";
import { applyConfigMutation, installConfigIoBarrier, type ConfigMutation } from "./providers-config-concurrency.js";

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-providers-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("missing providers.json loads as empty config", async () => {
  await withStateRoot(async (stateRoot) => {
    assert.deepEqual(await loadProvidersConfig(stateRoot), emptyProvidersConfig());
  });
});

test("enableModel writes provider/model ids without secrets and can set defaults", async () => {
  await withStateRoot(async (stateRoot) => {
    await enableModel(stateRoot, "openai/gpt-4o-mini");
    await enableModel(stateRoot, "anthropic/claude-sonnet-4-5");
    const config = await setDefaultModels(stateRoot, {
      primary: "anthropic/claude-sonnet-4-5",
      fast: "openai/gpt-4o-mini"
    });
    assert.deepEqual(config.enabled, ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4-5"]);
    assert.equal(config.primary, "anthropic/claude-sonnet-4-5");
    assert.equal(config.fast, "openai/gpt-4o-mini");
    const raw = await readFile(providersConfigPath(stateRoot), "utf8");
    assert.equal(raw.includes("sk-"), false);
    assert.equal(raw.toLowerCase().includes("api_key"), false);
  });
});

test("disableModel removes an enabled id", async () => {
  await withStateRoot(async (stateRoot) => {
    await enableModel(stateRoot, "openai/gpt-4o-mini");
    await enableModel(stateRoot, "anthropic/claude-sonnet-4-5");
    const config = await disableModel(stateRoot, "openai/gpt-4o-mini");
    assert.deepEqual(config.enabled, ["anthropic/claude-sonnet-4-5"]);
  });
});

test("saveProvidersConfig preserves bytes and leaves a legacy fixed temp untouched", async () => {
  await withStateRoot(async (stateRoot) => {
    const path = providersConfigPath(stateRoot);
    const legacyTemp = `${path}.tmp`;
    await saveProvidersConfig(stateRoot, emptyProvidersConfig());
    await writeFile(legacyTemp, "stale-writer-bytes", "utf8");

    await saveProvidersConfig(stateRoot, {
      version: 1,
      enabled: ["openai/gpt-4o-mini"],
      primary: "openai/gpt-4o-mini",
      customProviders: []
    });

    assert.equal(
      await readFile(path, "utf8"),
      '{\n  "version": 1,\n  "enabled": [\n    "openai/gpt-4o-mini"\n  ],\n  "customProviders": [],\n  "primary": "openai/gpt-4o-mini"\n}\n'
    );
    assert.equal(await readFile(legacyTemp, "utf8"), "stale-writer-bytes");
  });
});

test("providers config delegates publishing to the shared atomic writer", async () => {
  const source = await readFile("src/config/providers-config.ts", "utf8");
  assert.match(source, /import \{ writeFileAtomic \} from "\.\.\/persist\/atomic-file\.js";/);
  assert.match(source, /await writeFileAtomic\(/);
  assert.doesNotMatch(source, /\b(?:open|rename|unlink)\(/);
  assert.doesNotMatch(source, /tempPath|`[^`]*\.tmp`/);
});

test("enableModel rejects ids that are not provider/model", async () => {
  await withStateRoot(async (stateRoot) => {
    await assert.rejects(() => enableModel(stateRoot, "cheap"), DomainValidationError);
  });
});

test("invalid saves preserve existing config and release the transaction lock", async () => {
  await withStateRoot(async (stateRoot) => {
    const original = await enableModel(stateRoot, "test/old");
    const bytes = await readFile(providersConfigPath(stateRoot), "utf8");
    await assert.rejects(() => saveProvidersConfig(stateRoot, {
      ...original,
      customProviders: [{ id: "custom", baseUrl: "https://example.test", models: [{ id: "model", maxTokens: 0 }] }]
    }), DomainValidationError);
    assert.equal(await readFile(providersConfigPath(stateRoot), "utf8"), bytes);
    assert.deepEqual((await enableModel(stateRoot, "test/new")).enabled, ["test/old", "test/new"]);
  });
});

const concurrentMutations: readonly {
  readonly name: string;
  readonly first: ConfigMutation;
  readonly second: ConfigMutation;
  readonly enabled: readonly string[];
  readonly defaults?: { readonly primary: string; readonly fast: string };
}[] = [
  {
    name: "whole-config replacement and enable",
    first: { kind: "replace", enabled: ["test/replacement"] },
    second: { kind: "enable", id: "test/new" },
    enabled: ["test/new", "test/replacement"]
  },
  {
    name: "enable and enable",
    first: { kind: "enable", id: "test/first" },
    second: { kind: "enable", id: "test/second" },
    enabled: ["test/first", "test/old", "test/second"]
  },
  {
    name: "enable and disable",
    first: { kind: "enable", id: "test/new" },
    second: { kind: "disable", id: "test/old" },
    enabled: ["test/new"]
  },
  {
    name: "disable and set defaults",
    first: { kind: "disable", id: "test/old" },
    second: { kind: "defaults", primary: "test/primary", fast: "test/fast" },
    enabled: ["test/fast", "test/primary"],
    defaults: { primary: "test/primary", fast: "test/fast" }
  },
  {
    name: "set defaults and enable",
    first: { kind: "defaults", primary: "test/primary", fast: "test/fast" },
    second: { kind: "enable", id: "test/new" },
    enabled: ["test/fast", "test/new", "test/old", "test/primary"],
    defaults: { primary: "test/primary", fast: "test/fast" }
  }
];

function startConfigWorker(stateRoot: string, mutation: ConfigMutation, mode: "pause" | "observe") {
  const child = fork(fileURLToPath(new URL("./providers-config-concurrency.ts", import.meta.url)),
    ["providers-config-worker", stateRoot, JSON.stringify(mutation), mode],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (data: string) => { stderr += data; });
  const messages = new Set<string>();
  const waiters = new Map<string, () => void>();
  child.on("message", (message) => {
    if (typeof message === "string") {
      messages.add(message);
      waiters.get(message)?.();
    }
  });
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`config worker exit ${code}: ${stderr}`));
    });
  });
  // Attach a rejection handler while the parent is waiting for an IPC milestone.
  void completed.catch(() => undefined);
  return {
    child,
    completed,
    async waitFor(message: string): Promise<void> {
      if (messages.has(message)) return;
      await Promise.race([
        new Promise<void>((resolve) => { waiters.set(message, resolve); }),
        completed.then(() => { throw new Error(`config worker exited before ${message}: ${stderr}`); })
      ]);
    }
  };
}

for (const scenario of concurrentMutations) {
  test(`same-process ${scenario.name} preserves both committed updates`, { timeout: 15_000 }, async () => {
    await withStateRoot(async (stateRoot) => {
      await enableModel(stateRoot, "test/old");
      const barrier = installConfigIoBarrier(stateRoot, true);
      const first = applyConfigMutation(stateRoot, scenario.first);
      let second: Promise<void> | undefined;
      try {
        await barrier.staged;
        const accessed = barrier.nextAccess();
        second = applyConfigMutation(stateRoot, scenario.second);
        await accessed;
        barrier.release();
        await Promise.all([first, second]);
      } finally {
        barrier.release();
        await Promise.allSettled([first, ...(second === undefined ? [] : [second])]);
        barrier.restore();
      }
      const config = await loadProvidersConfig(stateRoot);
      assert.deepEqual(config.enabled.toSorted(), scenario.enabled);
      if (scenario.defaults !== undefined) {
        assert.equal(config.primary, scenario.defaults.primary);
        assert.equal(config.fast, scenario.defaults.fast);
      }
    });
  });

  test(`two-process ${scenario.name} preserves both committed updates`, { timeout: 15_000 }, async () => {
    await withStateRoot(async (stateRoot) => {
      await enableModel(stateRoot, "test/old");
      const first = startConfigWorker(stateRoot, scenario.first, "pause");
      let second: ReturnType<typeof startConfigWorker> | undefined;
      try {
        await first.waitFor("staged");
        second = startConfigWorker(stateRoot, scenario.second, "observe");
        await second.waitFor("accessed");
        first.child.send("release");
        await Promise.all([first.completed, second.completed]);
      } finally {
        for (const worker of [first, ...(second === undefined ? [] : [second])]) {
          if (worker.child.exitCode === null) worker.child.kill();
        }
        await Promise.allSettled([first.completed, ...(second === undefined ? [] : [second.completed])]);
      }
      const config = await loadProvidersConfig(stateRoot);
      assert.deepEqual(config.enabled.toSorted(), scenario.enabled);
      if (scenario.defaults !== undefined) {
        assert.equal(config.primary, scenario.defaults.primary);
        assert.equal(config.fast, scenario.defaults.fast);
      }
    });
  });
}

function configWithModel(model: Record<string, unknown>) {
  return {
    version: 1,
    enabled: [],
    customProviders: [{ id: "custom", baseUrl: "https://example.test", models: [{ id: "model", ...model }] }]
  };
}

for (const field of ["contextWindow", "maxTokens"]) {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, "100", null, true]) {
    test(`providers config rejects ${field}=${String(value)}`, () => {
      assert.throws(() => parseProvidersConfig(configWithModel({ [field]: value })), DomainValidationError);
    });
  }
}

for (const field of ["inputCostPerMTok", "outputCostPerMTok"]) {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1", null, true]) {
    test(`providers config rejects ${field}=${String(value)}`, () => {
      assert.throws(() => parseProvidersConfig(configWithModel({ [field]: value })), DomainValidationError);
    });
  }
}

test("providers config preserves zero prices, positive safe token limits and missing prices", () => {
  const config = parseProvidersConfig(configWithModel({
    contextWindow: Number.MAX_SAFE_INTEGER,
    maxTokens: 1,
    inputCostPerMTok: 0,
    outputCostPerMTok: 0.5,
    reasoning: false,
    compat: { supportsReasoningEffort: false }
  }));
  assert.deepEqual(config.customProviders[0]!.models[0], {
    id: "model", contextWindow: Number.MAX_SAFE_INTEGER, maxTokens: 1,
    inputCostPerMTok: 0, outputCostPerMTok: 0.5, reasoning: false,
    compat: { supportsReasoningEffort: false }
  });
  assert.deepEqual(parseProvidersConfig(configWithModel({})).customProviders[0]!.models[0], { id: "model" });
});

for (const [field, value] of [["name", 42], ["reasoning", "true"], ["reasoning", null], ["compat", []], ["compat", null]] as const) {
  test(`providers config rejects explicitly invalid model ${field}=${String(value)}`, () => {
    assert.throws(() => parseProvidersConfig(configWithModel({ [field]: value })), DomainValidationError);
  });
}

for (const [field, value] of [["name", 42], ["envVar", false], ["envVar", null]] as const) {
  test(`providers config rejects explicitly invalid provider ${field}=${String(value)}`, () => {
    const config = configWithModel({});
    assert.throws(() => parseProvidersConfig({
      ...config, customProviders: [{ ...config.customProviders[0], [field]: value }]
    }), DomainValidationError);
  });
}

test("providers config rejects non-string default ids without coercion", () => {
  for (const field of ["primary", "fast"]) {
    assert.throws(() => parseProvidersConfig({
      ...emptyProvidersConfig(), [field]: { toString: () => "custom/model" }
    }), DomainValidationError);
  }
});

test("providers config rejects duplicate normalized provider and model ids", () => {
  const config = configWithModel({});
  const provider = config.customProviders[0]!;
  assert.throws(() => parseProvidersConfig({
    ...config, customProviders: [provider, { ...provider, id: " custom " }]
  }), /duplicate.*provider/i);
  assert.throws(() => parseProvidersConfig({
    ...config, customProviders: [{ ...provider, models: [{ id: "model" }, { id: " model " }] }]
  }), /duplicate.*model/i);
  assert.equal(parseProvidersConfig({
    ...config, customProviders: [provider, { ...provider, id: "other" }]
  }).customProviders.length, 2);
});
