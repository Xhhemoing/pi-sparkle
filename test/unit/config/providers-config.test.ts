import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  disableModel,
  emptyProvidersConfig,
  enableModel,
  loadProvidersConfig,
  providersConfigPath,
  saveProvidersConfig,
  setDefaultModels
} from "../../../src/config/providers-config.js";

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
