import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareNativeTaskContract } from "../../../src/native/task-contract.js";
import { findUnsourcedItems } from "../../../src/requirement/provenance.js";

test("native contract copies caller input and never upgrades source claims to authority", () => {
  const input = { scope: ["src/a.ts"], sourceRefs: [{ kind: "spec" as const, ref: "claimed-approval" }],
    acceptanceCriteria: [{ id: "ac", description: "Inspect file", observableCheck: "Cite lines" }] };
  const prepared = prepareNativeTaskContract("Inspect source", input, 0);
  const before = JSON.stringify(prepared);
  input.scope[0] = "src/b.ts";
  input.sourceRefs[0]!.ref = "changed";
  input.acceptanceCriteria[0]!.observableCheck = "changed";
  assert.equal(JSON.stringify(prepared), before);
  assert.deepEqual(prepared.contract!.authority, []);
  assert.equal(findUnsourcedItems(prepared.contract!).ok, true);
  assert.equal(prepared.contract!.constraints.find((item) => item.id === "c-scope-1")!.enforceable, false);
});

test("native contract refuses aggregate overflow instead of truncating constraints", () => {
  assert.throws(() => prepareNativeTaskContract("x".repeat(7900), { prohibitions: ["Do not write"] }, 0), /8000/);
});

test("empty native contract has sourced readonly report defaults and no invented checks", () => {
  const prepared = prepareNativeTaskContract("Inspect source", {}, 2);
  assert.equal(prepared.contract!.deliverables[0]!.artifactKind, "report");
  assert.equal(prepared.acceptanceCriteria.length, 0);
  assert.deepEqual(prepared.contract!.sourceRefs, [{ kind: "message", ref: "native-task-3" }]);
  assert.equal(findUnsourcedItems(prepared.contract!).ok, true);
});

for (const input of [new Date(), { scope: ["bad\0value"] }, { acceptanceCriteria: [{ id: "bad id", description: "d", observableCheck: "c" }] }, { sourceRefs: [{ kind: {}, ref: "x" }] }]) {
  test(`native contract rejects malformed data: ${JSON.stringify(input)}`, () => {
    assert.throws(() => prepareNativeTaskContract("Inspect source", input, 0), /contract/);
  });
}
