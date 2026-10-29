import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyProvidersConfig, type ProvidersConfig } from "../../../src/config/providers-config.js";
import { resolveCliPiExecutorOptions } from "../../../src/cli/executor-factory.js";

// Dynamic import keeps the first RED an explicit missing-feature assertion.
const api = await import("../../../src/cli/task-model-selection.js").catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return undefined;
  throw error;
});
function implementation() { assert.ok(api, "bounded task model selection is not implemented"); return api; }
const selection = { providerId: "saved", modelId: "fixed", thinkingLevel: "max" as const };
const authority = { authorityRef: "owner-approved synthetic profiles", approvedSelections: [selection] };
const config: ProvidersConfig = { ...emptyProvidersConfig(), enabled: ["saved/primary", "saved/fixed", "saved/fast", "other/fixed"],
  primary: "saved/primary", fast: "saved/fast", customProviders: [{ id: "saved", baseUrl: "https://example.invalid/v1", models: [
    { id: "primary", inputCostPerMTok: 1, outputCostPerMTok: 2 }, { id: "fixed", inputCostPerMTok: 3, outputCostPerMTok: 4,
      cacheReadCostPerMTok: 0.5, cacheWriteCostPerMTok: 2, costTiers: [{ inputTokensAbove: 272000, input: 6, output: 8, cacheRead: 1, cacheWrite: 4 }] }
  ] }] };
const input = { stateRoot: "/unused-state", config, env: {}, selection, authority };

test("approved fixed selection uses original options, preserves prices and omits fast fallback without mutation", () => {
  const before = structuredClone(input);
  const options = implementation().resolveTaskModelSelectionOptions(input);
  assert.equal(options.providerId, "saved"); assert.equal(options.modelId, "fixed"); assert.equal(options.thinkingLevel, "max");
  assert.equal(options.fallbackModels, undefined);
  assert.deepEqual(options.aliases, { cheap: { providerId: "saved", modelId: "fixed" }, premium: { providerId: "saved", modelId: "fixed" } });
  assert.equal(options.customProviders, config.customProviders, "original catalog and SDK prices pass through unchanged");
  assert.equal(Object.hasOwn(options, "apiKey"), false); assert.deepEqual(input, before);
  const ordinary = resolveCliPiExecutorOptions({ stateRoot: input.stateRoot, config, env: {} });
  assert.equal(ordinary.modelId, "primary"); assert.equal(ordinary.thinkingLevel, "off");
  assert.deepEqual(ordinary.fallbackModels, [{ providerId: "saved", modelId: "fast" }]);
});

test("fixed profile overrides ambient model and thinking while retaining same-provider existing credential handling", () => {
  const env = { PI_PROVIDER: "saved", PI_MODEL: "ambient", PI_THINKING_LEVEL: "invalid-ambient", PI_API_KEY: "synthetic-only-key" };
  const before = { ...env };
  const options = implementation().resolveTaskModelSelectionOptions({ ...input, env });
  assert.equal(options.modelId, "fixed"); assert.equal(options.thinkingLevel, "max");
  assert.equal(options.apiKey, "synthetic-only-key"); assert.equal(options.fallbackModels, undefined); assert.deepEqual(env, before);
});

test("fixed profile refuses unapproved exact triples, disabled models and cross-provider credential reuse", () => {
  const { resolveTaskModelSelectionOptions: resolve } = implementation();
  assert.throws(() => resolve({ ...input, selection: { ...selection, thinkingLevel: "high" } }), /approved|authority/i);
  assert.throws(() => resolve({ ...input, config: { ...config, enabled: ["saved/primary"] } }), /enabled/i);
  const other = { ...selection, providerId: "other" };
  assert.throws(() => resolve({ ...input, selection: other, authority: { ...authority, approvedSelections: [other] } }), /provider/i);
  assert.throws(() => resolve({ ...input, env: { PI_PROVIDER: "other", PI_MODEL: "ambient", PI_API_KEY: "synthetic-only-key" } }), /provider/i);
});

test("selection parser accepts only exact plain data triples and snapshots them", () => {
  const { parseTaskModelSelection: parse } = implementation();
  const original = { ...selection }, parsed = parse(original);
  original.modelId = "changed"; assert.equal(parsed.modelId, "fixed"); assert.ok(Object.isFrozen(parsed));
  for (const invalid of [null, [], { ...selection, thinkingLevel: "ultra" }, { ...selection, thinkingLevel: null },
    { ...selection, providerId: "saved/other" }, { ...selection, modelId: " fixed" }, { ...selection, modelId: "fixed\0" },
    { providerId: "saved", modelId: "fixed" }, { ...selection, apiKey: "SENSITIVE_SELECTION_MARKER" },
    { ...selection, baseUrl: "https://example.invalid" }, { ...selection, rules: [] }, { ...selection, maxCostUsd: 100 }]) {
    assert.throws(() => parse(invalid), error => error instanceof Error && !error.message.includes("SENSITIVE_SELECTION_MARKER"));
  }
  let accessed = false;
  assert.throws(() => parse(Object.defineProperty({ ...selection }, "modelId", { get() { accessed = true; return "fixed"; } })));
  assert.equal(accessed, false);
  assert.throws(() => parse(new Proxy(selection, {})));
});

test("authority parser requires exact nonempty bounded whitelist and rejects credential or rule fields", () => {
  const { parseTaskModelSelectionAuthority: parse } = implementation();
  const original = { authorityRef: authority.authorityRef, approvedSelections: [{ ...selection }] };
  const parsed = parse(original); original.approvedSelections[0]!.modelId = "changed";
  assert.equal(parsed.approvedSelections[0]!.modelId, "fixed"); assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.approvedSelections));
  for (const invalid of [null, [], { ...authority, authorityRef: " " }, { ...authority, approvedSelections: [] },
    { ...authority, approvedSelections: [selection, selection] }, { ...authority, approvedSelections: [{ ...selection, thinkingLevel: "bad" }] },
    { ...authority, credentials: "SENSITIVE_AUTHORITY_MARKER" }, { ...authority, rules: [] }, { ...authority, env: {} }]) {
    assert.throws(() => parse(invalid), error => error instanceof Error && !error.message.includes("SENSITIVE_AUTHORITY_MARKER"));
  }
});

test("fixed resolver refuses additional auth settings instead of treating resource content as executor options", () => {
  const { resolveTaskModelSelectionOptions: resolve } = implementation();
  assert.throws(() => resolve({ ...input, apiKey: "SENSITIVE_EXTRA_MARKER" } as typeof input),
    error => error instanceof Error && !error.message.includes("SENSITIVE_EXTRA_MARKER"));
});
