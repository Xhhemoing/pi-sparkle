import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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

test("enableModel rejects ids that are not provider/model", async () => {
  await withStateRoot(async (stateRoot) => {
    await assert.rejects(() => enableModel(stateRoot, "cheap"), DomainValidationError);
  });
});
