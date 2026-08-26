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

/**
 * A single primary and no fast model is the `models set-default --primary`
 * path, and the pi executor resolves both aliases to that one model. The
 * catalog has to say the same thing, or the shipped flowchart example (which
 * prefers `premium`) is refused on a state root that can run it. The list is
 * exact because the aliases must follow the concrete rows: selection keeps the
 * earliest catalog-order candidate on a tie, so prepending them would hand
 * every equal-cost assignment to an alias.
 */
test("a lone primary still exposes both cheap and premium aliases", async () => {
  await withStateRoot(async (stateRoot) => {
    await setDefaultModels(stateRoot, { primary: "openai/gpt-4o-mini" });
    const catalog = await buildLiveCatalogConfig(stateRoot);
    assert.deepEqual(
      catalog.models.map((model) => model.id),
      ["openai/gpt-4o-mini", DEFAULT_FAST_MODEL_ID, DEFAULT_PRIMARY_MODEL_ID]
    );
    const concrete = catalog.models.find((model) => model.id === "openai/gpt-4o-mini");
    assert.ok(concrete);
    for (const aliasId of [DEFAULT_FAST_MODEL_ID, DEFAULT_PRIMARY_MODEL_ID]) {
      const alias = catalog.models.find((model) => model.id === aliasId);
      assert.equal(alias?.providerId, "openai");
      assert.equal(alias?.estimatedCostUsd, concrete.estimatedCostUsd);
    }
  });
});
