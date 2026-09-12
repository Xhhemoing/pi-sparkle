import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createExperimentFreeze,
  parseExperimentFreeze,
  validateExperimentFreeze
} from "../../../src/experiments/freeze.js";
import type { ModelDescriptor } from "../../../src/routing/capability-registry.js";

const model: ModelDescriptor = {
  modelId: "cheap",
  providerId: "fake",
  version: "v1",
  capabilities: [],
  providerPolicy: "approved",
  inputCostPerMTok: 0.1,
  outputCostPerMTok: 0.2,
  latencyMsPer1K: 100,
  privacyClass: "cloud-general"
};

describe("PS-P4 experiment freeze", () => {
  it("creates a freeze with config/catalog/dirs/provenance/clock", () => {
    const freeze = createExperimentFreeze({
      nowMs: 12345,
      config: { provider: "x", defaultModel: "cheap" },
      catalog: [model],
      dirs: { stateRoot: "/tmp/state", evidenceRoot: "/tmp/evidence" },
      buildProvenance: {
        commitSha: "abc123",
        records: [{ kind: "git", id: "abc123", digest: "abc123" }]
      },
      hasProviderConfig: true,
      hasDefaultConfig: true
    });
    assert.equal(freeze.clockInstantMs, 12345);
    assert.ok(freeze.configHash.length > 10);
    assert.ok(freeze.catalogHash.length > 10);
    assert.equal(freeze.catalogSnapshot.length, 1);
  });

  it("fails closed without provider/default config", () => {
    assert.throws(
      () =>
        createExperimentFreeze({
          nowMs: 1,
          config: {},
          catalog: [model],
          dirs: { stateRoot: "/s", evidenceRoot: "/e" },
          buildProvenance: { commitSha: "x" },
          hasProviderConfig: false,
          hasDefaultConfig: true
        }),
      /provider\/default config/
    );
  });

  it("fails closed on empty provenance record sets", () => {
    assert.throws(
      () =>
        createExperimentFreeze({
          nowMs: 1,
          config: { a: 1 },
          catalog: [model],
          dirs: { stateRoot: "/s", evidenceRoot: "/e" },
          buildProvenance: { commitSha: "x", records: [] },
          hasProviderConfig: true,
          hasDefaultConfig: true
        }),
      /empty record set/
    );
  });

  it("fails closed on empty freeze / empty catalog", () => {
    assert.throws(() => parseExperimentFreeze({}), /fail closed|unsupported/);
    assert.throws(
      () =>
        validateExperimentFreeze({
          version: 1,
          clockInstantMs: 1,
          configHash: "h",
          catalogHash: "c",
          catalogSnapshot: [],
          dirs: { stateRoot: "/s", evidenceRoot: "/e" },
          buildProvenance: { commitSha: "x" },
          hasProviderConfig: true,
          hasDefaultConfig: true
        }),
      /catalogSnapshot is empty/
    );
  });
});
