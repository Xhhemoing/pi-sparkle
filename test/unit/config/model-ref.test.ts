import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainValidationError } from "../../../src/domain/errors.js";
import { formatModelRef, parseModelRef, tryParseModelRef } from "../../../src/config/model-ref.js";

test("formatModelRef joins provider and model with a single slash", () => {
  assert.equal(formatModelRef("openai", "gpt-4o-mini"), "openai/gpt-4o-mini");
});

test("parseModelRef splits on the first slash so model ids may contain slashes", () => {
  assert.deepEqual(parseModelRef("openai/gpt-4o-mini"), {
    providerId: "openai",
    modelId: "gpt-4o-mini"
  });
  assert.deepEqual(parseModelRef("fireworks/accounts/fireworks/models/foo"), {
    providerId: "fireworks",
    modelId: "accounts/fireworks/models/foo"
  });
});

test("tryParseModelRef returns undefined for aliases without a slash", () => {
  assert.equal(tryParseModelRef("cheap"), undefined);
  assert.equal(tryParseModelRef("premium"), undefined);
});

test("parseModelRef rejects empty provider or model segments", () => {
  assert.throws(() => parseModelRef(""), DomainValidationError);
  assert.throws(() => parseModelRef("openai"), DomainValidationError);
  assert.throws(() => parseModelRef("/gpt-4o-mini"), DomainValidationError);
  assert.throws(() => parseModelRef("openai/"), DomainValidationError);
});
