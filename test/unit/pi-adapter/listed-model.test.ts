import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSparkleModel, listSparkleModels } from "../../../src/pi-adapter/listed-model.js";

test("describeSparkleModel copies Pi catalog price and context without secrets", () => {
  const listed = describeSparkleModel("openai", "gpt-4o-mini");
  assert.ok(listed);
  assert.equal(listed.catalogId, "openai/gpt-4o-mini");
  assert.equal(listed.providerId, "openai");
  assert.equal(listed.modelId, "gpt-4o-mini");
  assert.ok(listed.inputCostPerMTok >= 0);
  assert.ok(listed.contextWindow > 0);
  assert.ok(listed.capabilities.includes("tool-use"));
  assert.equal(JSON.stringify(listed).toLowerCase().includes("sk-"), false);
});

test("describeSparkleModel returns undefined for unknown models", () => {
  assert.equal(describeSparkleModel("openai", "not-a-real-model-zzz"), undefined);
});

test("listSparkleModels can list one provider from the builtin catalog", () => {
  const listed = listSparkleModels("openai");
  assert.ok(listed.some((model) => model.modelId === "gpt-4o-mini"));
  assert.ok(listed.every((model) => model.providerId === "openai"));
});
