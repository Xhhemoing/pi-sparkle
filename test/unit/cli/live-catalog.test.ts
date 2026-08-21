import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { enableModel, setDefaultModels } from "../../../src/config/providers-config.js";
import { buildLiveCatalogConfig } from "../../../src/cli/model-catalog.js";
import { DEFAULT_FAST_MODEL_ID, DEFAULT_PRIMARY_MODEL_ID } from "../../../src/routing/primary-catalog.js";

async function withStateRoot(run: (stateRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-live-cat-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

test("empty providers.json keeps the fake cheap/premium catalog", async () => {
  await withStateRoot(async (stateRoot) => {
    const catalog = await buildLiveCatalogConfig(stateRoot);
    assert.deepEqual(
      catalog.models.map((model) => model.id),
      [DEFAULT_FAST_MODEL_ID, DEFAULT_PRIMARY_MODEL_ID]
    );
  });
});

test("enabled models join the live catalog and alias cheap/premium", async () => {
  await withStateRoot(async (stateRoot) => {
    await enableModel(stateRoot, "openai/gpt-4o-mini");
    await setDefaultModels(stateRoot, {
      primary: "openai/gpt-4o",
      fast: "openai/gpt-4o-mini"
    });
    const catalog = await buildLiveCatalogConfig(stateRoot);
    const ids = catalog.models.map((model) => model.id);
    assert.ok(ids.includes("openai/gpt-4o-mini"));
    assert.ok(ids.includes("openai/gpt-4o"));
    assert.ok(ids.includes("cheap"));
    assert.ok(ids.includes("premium"));
    const cheap = catalog.models.find((model) => model.id === "cheap");
    assert.equal(cheap?.providerId, "openai");
    assert.ok((cheap?.inputCostPerMTok ?? 0) >= 0);
  });
});
