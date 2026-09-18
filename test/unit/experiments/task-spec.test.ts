import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";
import {
  compileEquivalentArms,
  modelDescriptorsFromPriceTable,
  validateHoldoutTaskSpec
} from "../../../src/experiments/task-spec.js";

function catalog(): ModelDescriptor[] {
  return [
    {
      modelId: "cheap",
      providerId: "fake",
      version: "cheap-v1",
      capabilities: [],
      providerPolicy: "approved",
      inputCostPerMTok: 0.1,
      outputCostPerMTok: 0.3,
      latencyMsPer1K: 500,
      approvedForHighRisk: true,
      privacyClass: "cloud-general"
    },
    {
      modelId: "premium",
      providerId: "fake",
      version: "premium-v1",
      capabilities: [],
      providerPolicy: "approved",
      inputCostPerMTok: 1,
      outputCostPerMTok: 3,
      latencyMsPer1K: 1000,
      approvedForHighRisk: true,
      privacyClass: "cloud-general"
    }
  ];
}

const multiTaskSpec = {
  $schema: "f6-taskSpec-v1",
  id: "spec_impl_001",
  family: "implementation",
  tasks: [
    {
      id: "tsk_impl_a",
      role: "implementer",
      objective: "Implement feature A"
    },
    {
      id: "tsk_impl_b",
      role: "tester",
      objective: "Test feature A",
      dependsOn: ["tsk_impl_a"]
    }
  ],
  allowedModels: ["cheap", "premium"]
};

describe("PS-P4 holdout taskSpec compile", () => {
  it("rejects fixed fake taskFamily 'holdout'", () => {
    assert.throws(
      () =>
        validateHoldoutTaskSpec({
          ...multiTaskSpec,
          family: "holdout"
        }),
      /fake 'holdout'/
    );
  });

  it("compiles full multi-task flowchart for R0 and R1 (not tasks[0]-only)", () => {
    const spec = validateHoldoutTaskSpec(multiTaskSpec);
    const compiled = compileEquivalentArms({
      spec,
      catalog: catalog(),
      nowMs: 1_700_000_000_000
    });
    assert.equal(compiled.shared.tasks.length, 2);
    assert.equal(compiled.r0.flowchart.nodes.length, 2);
    assert.equal(compiled.r1.flowchart.nodes.length, 2);
    assert.equal(compiled.shared.taskFamily, "implementation");
    assert.equal(compiled.shared.routeRequest.taskFamily, "implementation");
    assert.equal(compiled.shared.nowMs, 1_700_000_000_000);
    const ids = compiled.r1.flowchart.nodes.map((n) => n.taskId).sort();
    assert.deepEqual(ids, ["tsk_impl_a", "tsk_impl_b"]);
  });

  it("requires injectable nowMs (no Date.now default)", () => {
    const spec = validateHoldoutTaskSpec(multiTaskSpec);
    assert.throws(
      () =>
        compileEquivalentArms({
          spec,
          catalog: catalog(),
          nowMs: Number.NaN
        }),
      /injectable finite nowMs/
    );
  });

  it("fails closed when catalog price is missing (no placeholder)", () => {
    const spec = validateHoldoutTaskSpec(multiTaskSpec);
    assert.throws(
      () =>
        compileEquivalentArms({
          spec,
          catalog: catalog().filter((m) => m.modelId === "cheap"),
          nowMs: 42
        }),
      /catalog price missing.*premium/
    );
  });

  it("modelDescriptorsFromPriceTable fails closed on missing entry", () => {
    assert.throws(
      () =>
        modelDescriptorsFromPriceTable(["missing-model"], {
          models: { cheap: { inputPerMTok: 0.1, outputPerMTok: 0.2 } }
        }),
      /price table missing/
    );
  });

  it("R0 and R1 share the same compiled task nodes and family", () => {
    const spec = validateHoldoutTaskSpec(multiTaskSpec);
    const compiled = compileEquivalentArms({
      spec,
      catalog: catalog(),
      nowMs: 99
    });
    assert.deepEqual(
      compiled.r0.flowchart.nodes.map((n) => n.taskId),
      compiled.r1.flowchart.nodes.map((n) => n.taskId)
    );
    assert.equal(compiled.shared.taskFamily, spec.family);
  });
});
