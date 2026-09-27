import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));

test("packaged native contract schema is optional, bounded and cannot supply authority or commands", async () => {
  const { loadExtensions } = await import(loaderUrl.href);
  const loaded = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], process.cwd());
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  assert.deepEqual(new Set(extension.tools.keys()), new Set(["sparkle_delegate", "sparkle_apply_candidate"]));
  const schema = extension.tools.get("sparkle_delegate")!.definition.parameters;
  const tasks = schema.properties.tasks;
  assert.equal(tasks.maxItems, 4);
  assert.equal(tasks.items.required.includes("contract"), false);
  const contract = tasks.items.properties.contract;
  assert.equal(contract.additionalProperties, false);
  assert.deepEqual(Object.keys(contract.properties).sort(), ["acceptanceCriteria", "deliverables", "prohibitions", "scope", "sourceRefs"]);
  for (const value of Object.values(contract.properties) as { maxItems: number }[]) assert.equal(value.maxItems, 8);
  assert.equal(contract.properties.acceptanceCriteria.items.additionalProperties, false);
  assert.equal(contract.properties.sourceRefs.items.additionalProperties, false);
});
