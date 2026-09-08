import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeFile, mkdir } from "node:fs/promises";
import { enableModel, setDefaultModels } from "../../../src/config/providers-config.js";
import {
  buildLiveCatalogConfig,
  UnknownCatalogModelError
} from "../../../src/cli/model-catalog.js";
import { commandFailureNext } from "../../../src/cli/main.js";
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
    assert.equal(cheap?.privacyClass, "cloud-general");
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
test("an unknown default names the provider status: builtin provider, missing model", async () => {
  await withStateRoot(async (stateRoot) => {
    await setDefaultModels(stateRoot, { primary: "openai/not-a-real-model" });
    const failure = await buildLiveCatalogConfig(stateRoot).then(
      () => undefined,
      (error: unknown) => error
    );
    assert.ok(failure instanceof UnknownCatalogModelError);
    assert.equal(failure.message, 'unknown model "openai/not-a-real-model"');
    assert.equal(failure.providerId, "openai");
    assert.equal(failure.providerStatus, "builtin");
  });
});

test("an unknown model under a registered custom provider reports status custom", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      join(stateRoot, "runtime", "providers.json"),
      `${JSON.stringify({
        version: 1,
        enabled: ["local/ghost"],
        customProviders: [
          { id: "local", baseUrl: "http://127.0.0.1:9/v1", models: [{ id: "m1" }] }
        ]
      })}\n`,
      "utf8"
    );
    const failure = await buildLiveCatalogConfig(stateRoot).then(
      () => undefined,
      (error: unknown) => error
    );
    assert.ok(failure instanceof UnknownCatalogModelError);
    assert.equal(failure.providerStatus, "custom");
  });
});

test("an unknown model whose provider is registered nowhere reports status unregistered", async () => {
  await withStateRoot(async (stateRoot) => {
    await mkdir(join(stateRoot, "runtime"), { recursive: true });
    await writeFile(
      join(stateRoot, "runtime", "providers.json"),
      `${JSON.stringify({ version: 1, enabled: ["ghost/m1"], customProviders: [] })}\n`,
      "utf8"
    );
    const failure = await buildLiveCatalogConfig(stateRoot).then(
      () => undefined,
      (error: unknown) => error
    );
    assert.ok(failure instanceof UnknownCatalogModelError);
    assert.equal(failure.providerStatus, "unregistered");
  });
});

test("commandFailureNext routes an unknown builtin-provider model to that provider's catalog page", () => {
  const next = commandFailureNext(
    new UnknownCatalogModelError("openai/not-a-real-model", "openai", "builtin"),
    ["run"]
  );
  assert.match(next, /models list --available --provider openai/);
  assert.match(next, /models enable/);
});

test("commandFailureNext names providers.json when the custom provider lists no such model", () => {
  const next = commandFailureNext(
    new UnknownCatalogModelError("local/ghost", "local", "custom"),
    ["run"]
  );
  assert.match(next, /providers\.json customProviders/);
  assert.match(next, /--provider local/);
});

test("commandFailureNext names registration when the provider exists nowhere", () => {
  const next = commandFailureNext(
    new UnknownCatalogModelError("ghost/m1", "ghost", "unregistered"),
    ["run"]
  );
  assert.match(next, /register/);
  assert.match(next, /models list --available/);
});

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
