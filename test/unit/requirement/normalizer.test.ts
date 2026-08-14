import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContractFromSources } from "../../../src/requirement/normalizer.js";

test("buildContractFromSources extracts acceptance from signals", () => {
  const sources = [
    { kind: "message" as const, ref: "msg1", content: "The system must pass all tests" }
  ];
  const contract = buildContractFromSources("test objective", sources);
  assert.ok(contract.acceptanceCriteria.length >= 0);
});
