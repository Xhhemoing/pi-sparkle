import assert from "node:assert/strict";
import { test } from "node:test";
import { ResourceRegistry } from "../../../src/lab/adaptation/registry.js";
import { materializeTaskResources, parseTaskResourceContent, taskResourceIdentity, taskResourceTopic, verifyMaterializedTaskResources } from "../../../src/lab/adaptation/task-resources.js";
import { snapshotDevelopmentTaskSpec } from "../../../src/development/task-spec.js";

const selection = { providerId: "approved", modelId: "small", thinkingLevel: "xhigh" };
const sourceRevision = "a".repeat(40), projectRoot = "/synthetic/project";
const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: "Repair the original task", context: [], write: { allow: ["value.txt"], protect: ["checks"], require: ["value.txt"] }, prepare: [], checks: [{ id: "unit", command: "node", args: ["checks/unit.mjs"], verifierVersion: "1", protectedPaths: ["checks"], expect: { baseline: "pass" } }], worker: { model: "inherit", maxAttempts: 1 }, budget: { totalSeconds: 60, prepareSeconds: 10, workerSeconds: 20, checkSeconds: 20, usd: 1 } });
const content = (selected: unknown = selection) => JSON.stringify({ topic: "model-thinking", selection: selected, sourceRefs: ["private/failure.json"], expectedEffect: "Measure a fixed authorized alternative; no benefit is presumed" });
function setup() {
  const registry = new ResourceRegistry(), topic = taskResourceTopic("model-thinking"), identity = taskResourceIdentity(projectRoot, topic);
  registry.registerBaseline({ identity, content: content(), author: { kind: "human", identity: "owner" } });
  const materialized = materializeTaskResources({ registry, projectRoot, logicalTaskId: "P-fixed", sourceRevision, spec, topics: [topic] });
  return { registry, materialized, identity };
}

test("a fixed model-thinking recipe materializes without changing TaskSpec authority or objective", () => {
  const { materialized, identity } = setup();
  assert.equal(identity.kind, "workflow-template");
  assert.deepEqual((materialized as unknown as { modelSelection: unknown }).modelSelection, selection);
  assert.deepEqual(materialized.spec, spec);
  assert.deepEqual(materialized.baseSpec, spec);
  assert.deepEqual(materialized.hostGuidance, []);
});

test("materialized fixed selection is reconstructed from its existing immutable resource version", () => {
  const { registry, materialized } = setup();
  assert.deepEqual(verifyMaterializedTaskResources(registry, materialized), materialized);
  for (const modelSelection of [undefined, { ...selection, modelId: "other" }, { ...selection, apiKey: "forbidden" }]) {
    assert.throws(() => verifyMaterializedTaskResources(registry, { ...materialized, modelSelection }), /model|binding|materialized/i);
  }
});

test("fixed recipes reject conditional routing, credentials and unknown selection fields", () => {
  for (const value of [{ ...selection, thinkingLevel: "extra high" }, { ...selection, baseUrl: "https://invalid.example" }, { ...selection, modelId: "" }, { ...selection, rules: [] }]) {
    assert.throws(() => parseTaskResourceContent(content(value)));
  }
  assert.throws(() => parseTaskResourceContent(JSON.stringify({ topic: "model-thinking", selection, sourceRefs: ["private/a"], expectedEffect: "test", autoPromote: true })));
});
