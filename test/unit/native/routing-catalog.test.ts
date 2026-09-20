import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNativeRoutingCatalog, type NativeCatalogModelInput } from "../../../src/native/routing-catalog.js";

test("host models become catalog rows with declared versions and unpriced defaults", () => {
  const models: readonly NativeCatalogModelInput[] = [
    { ref: "xhh/gpt-5.6-luna-fast", preferred: true, contextWindow: 200_000, maxOutputTokens: 16_384 },
    { ref: "xhh/cursor-grok-4.6-fast", contextWindow: 200_000, maxOutputTokens: 16_384 }
  ];
  const catalog = buildNativeRoutingCatalog(models, { primary: "xhh/gpt-5.6-luna-fast", fast: "xhh/cursor-grok-4.6-fast" });
  const ids = catalog.config.models.map((model) => model.id);
  // Host refs plus the cheap/premium aliases buildLiveCatalogConfig emits so
  // policies referencing the aliases resolve against host models too.
  assert.deepEqual(
    [...ids].sort(),
    ["cheap", "premium", "xhh/cursor-grok-4.6-fast", "xhh/gpt-5.6-luna-fast"]
  );
  for (const model of catalog.config.models) {
    assert.ok(typeof model.version === "string" && model.version.length > 0, "catalog version is mandatory");
    assert.ok(Number.isFinite(model.estimatedCostUsd));
  }
  const primary = catalog.config.models.find((model) => model.id === "xhh/gpt-5.6-luna-fast");
  assert.ok(primary, "primary model present");
  assert.deepEqual([...primary.roles].sort(), ["actor", "critic", "judge", "router"]);
  assert.equal(primary.maxComplexity, "HIGH");
  const fast = catalog.config.models.find((model) => model.id === "xhh/cursor-grok-4.6-fast");
  assert.equal(fast?.maxComplexity, "MEDIUM");
  assert.deepEqual(catalog.primary, "xhh/gpt-5.6-luna-fast");
  assert.deepEqual(catalog.fast, "xhh/cursor-grok-4.6-fast");
});

test("duplicate refs and malformed refs are refused", () => {
  assert.throws(
    () => buildNativeRoutingCatalog(
      [
        { ref: "xhh/m", preferred: true },
        { ref: "xhh/m" }
      ],
      { primary: "xhh/m" }
    ),
    /duplicate/i
  );
  assert.throws(
    () => buildNativeRoutingCatalog([{ ref: "no-slash", preferred: true }], { primary: "no-slash" }),
    /provider\/model|ref/i
  );
  assert.throws(
    () => buildNativeRoutingCatalog([{ ref: "xhh/m" }], {}),
    /primary/i,
    "no explicit primary and no preferred flag must fail closed"
  );
});

test("empty eligible set fails closed", () => {
  assert.throws(() => buildNativeRoutingCatalog([], { primary: "xhh/m" }), /at least one/i);
});
