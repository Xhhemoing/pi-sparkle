import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertHoldoutUsable,
  createManifest,
  markHoldoutCompromised,
  validateManifest,
  type DatasetManifest
} from "../../../src/experiments/manifest.js";

function validManifest(overrides: Partial<DatasetManifest> = {}): DatasetManifest {
  return createManifest({
    datasetId: "ds_phase_c",
    episodeHashes: ["h1", "h2", "h3"],
    exclusions: [],
    split: { train: ["h1"], eval: ["h2"], holdout: ["h3"] },
    resourceVersions: {},
    environment: {},
    seed: 7,
    ...overrides
  });
}

describe("three-way split and holdout contamination (spec case 21)", () => {
  it("accepts a disjoint train/eval/holdout split", () => {
    const manifest = validManifest();
    assert.deepEqual(manifest.split.holdout, ["h3"]);
    assert.doesNotThrow(() => validateManifest(manifest));
    assert.doesNotThrow(() => assertHoldoutUsable(manifest));
  });

  it("rejects a hash that appears in train and holdout", () => {
    assert.throws(() =>
      validManifest({ split: { train: ["h1"], eval: ["h2"], holdout: ["h1"] } })
    );
  });

  it("rejects an eval hash in the holdout", () => {
    assert.throws(() =>
      validManifest({ split: { train: ["h1"], eval: ["h2"], holdout: ["h2"] } })
    );
  });

  it("rejects an excluded hash appearing in the holdout", () => {
    assert.throws(() =>
      validManifest({
        exclusions: ["h3"],
        split: { train: ["h1"], eval: ["h2"], holdout: ["h3"] }
      })
    );
  });

  it("marks a holdout compromised after optimization access", () => {
    const sealed = markHoldoutCompromised(validManifest(), "used to tune threshold");
    assert.equal(sealed.compromised, true);
    assert.throws(() => assertHoldoutUsable(sealed));
  });

  it("cannot claim sealed evaluation without a holdout", () => {
    const legacy = validManifest({
      split: { train: ["h1"], eval: ["h2"] }
    });
    assert.throws(() => assertHoldoutUsable(legacy));
  });
});
