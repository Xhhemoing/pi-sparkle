import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFlowchartModelsInCatalog, cliCatalogModelIds, createCliModelRouter } from "../../../src/cli/model-catalog.js";
import { collectSelectedActionIds, parseChildNodeResults } from "../../../src/cli/flowchart-io.js";
import { validateFlowchart } from "../../../src/domain/flowchart.js";

const tinyFlowchart = validateFlowchart({
  id: "catalog",
  nodes: [
    {
      id: "only",
      taskId: "tsk_only",
      role: "actor",
      objective: "Do the work",
      modelPolicy: { allowedModels: ["cheap"] },
      confidenceThreshold: 0.7,
      approvalRequired: false
    }
  ],
  edges: []
});

test("CLI catalog is cheap and premium", () => {
  assert.deepEqual([...cliCatalogModelIds()], ["cheap", "premium"]);
  const router = createCliModelRouter();
  assert.equal(router.config.policyVersion, "router-v1");
});

test("flowchart models outside the CLI catalog fail closed", () => {
  const flowchart = validateFlowchart({
    ...tinyFlowchart,
    nodes: [{ ...tinyFlowchart.nodes[0]!, modelPolicy: { allowedModels: ["mystery"] } }]
  });
  assert.throws(() => assertFlowchartModelsInCatalog(flowchart), /unavailable model "mystery"/);
});

test("collectSelectedActionIds merges flags and csv without inventing ids", () => {
  assert.equal(collectSelectedActionIds(undefined, undefined), undefined);
  assert.deepEqual(collectSelectedActionIds(["work"], undefined), ["work"]);
  assert.deepEqual(collectSelectedActionIds(undefined, "pathA,pathB"), ["pathA", "pathB"]);
  assert.deepEqual(collectSelectedActionIds(["work"], "work,extra"), ["work", "extra"]);
  assert.deepEqual(collectSelectedActionIds(undefined, ""), []);
});

test("parseChildNodeResults maps nodeId to fake results", () => {
  const parsed = parseChildNodeResults({
    work: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_work"] }
  });
  assert.equal(parsed.work?.outcome, "SUCCESS");
  assert.equal(parsed.work?.confidence, 0.9);
  assert.deepEqual(parsed.work?.evidenceIds, ["evd_work"]);
});
