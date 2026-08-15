import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSealedDatasetManifest,
  rotateHoldout,
  sealedManifestHash,
  validateSealedDatasetManifest,
} from "../../../src/experiments/dataset.js";
import type { SealedDatasetManifest } from "../../../src/experiments/dataset.js";
import type { IsoTimestamp } from "../../../src/domain/timestamp.js";

const NOW = "2026-08-14T00:00:00.000Z" as IsoTimestamp;

function manifest(overrides: Partial<SealedDatasetManifest> = {}): SealedDatasetManifest {
  return createSealedDatasetManifest({
    datasetId: "ds-1",
    episodeHashes: ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "h10"],
    splits: {
      train: ["h1", "h2", "h3"],
      validation: ["h4"],
      holdout: ["h5", "h6"],
    },
    exclusions: ["h7"],
    rotation: 0,
    previousHoldout: undefined,
    resourceVersions: { model: "v2", features: "feat-1" },
    createdAt: NOW,
    ...overrides,
  });
}

describe("M6-T2: sealed dataset manifest", () => {
  it("accepts a disjoint three-way split and hashes deterministically", () => {
    const a = manifest();
    const b = manifest();
    assert.equal(sealedManifestHash(a), sealedManifestHash(b));
  });

  it("rejects overlapping splits as contamination", () => {
    assert.throws(
      () => manifest({ splits: { train: ["h1", "h2"], validation: ["h2"], holdout: ["h5"] } }),
      /appears in more than one split/
    );
  });

  it("rejects split hashes outside the frozen episode universe", () => {
    assert.throws(
      () => manifest({ splits: { train: ["h1"], validation: ["h99"], holdout: ["h5"] } }),
      /unknown episode/
    );
  });

  it("rejects exclusions that appear in any split", () => {
    assert.throws(
      () => manifest({ exclusions: ["h1"] }),
      /exclusion .+ appears in the .+ split/
    );
  });

  it("rejects duplicate hashes inside a split and inside the universe", () => {
    assert.throws(
      () => manifest({ splits: { train: ["h1", "h1"], validation: [], holdout: ["h5"] } }),
      /duplicate/
    );
    assert.throws(() => manifest({ episodeHashes: ["h1", "h1", "h3"] }), /duplicate/);
  });

  it("requires a previous-holdout snapshot once rotation starts, with continuity", () => {
    assert.throws(
      () => manifest({ rotation: 1 }),
      /previous holdout snapshot is required/
    );
    // A snapshot from rotation 0 for a rotation-1 manifest is contiguous and valid...
    assert.doesNotThrow(() =>
      manifest({
        rotation: 1,
        previousHoldout: { datasetId: "ds-1", rotation: 0, episodeHashes: ["h5"] },
      })
    );
    // ...but skipping a rotation or switching datasets fails closed.
    assert.throws(
      () =>
        manifest({
          rotation: 1,
          previousHoldout: { datasetId: "ds-1", rotation: 2, episodeHashes: ["h5"] },
        }),
      /previous holdout must be the immediately preceding rotation/
    );
    assert.throws(
      () =>
        manifest({
          rotation: 1,
          previousHoldout: { datasetId: "ds-9", rotation: 0, episodeHashes: ["h5"] },
        }),
      /same dataset/
    );
  });

  it("rotates the holdout: old holdout folds into train and the frozen split is preserved", () => {
    const initial = manifest();
    const rotated = rotateHoldout(initial, ["h8", "h9"], NOW);
    assert.equal(rotated.rotation, 1);
    assert.deepEqual(rotated.splits.train, ["h1", "h2", "h3", "h5", "h6"]);
    assert.deepEqual(rotated.splits.holdout, ["h8", "h9"]);
    assert.deepEqual(rotated.splits.validation, ["h4"]);
    assert.deepEqual(rotated.previousHoldout, {
      datasetId: "ds-1",
      rotation: 0,
      episodeHashes: ["h5", "h6"],
    });
    assert.notEqual(sealedManifestHash(initial), sealedManifestHash(rotated));
  });

  it("rejects a rotated holdout that overlaps the folded train set", () => {
    const initial = manifest();
    // h5 was the old holdout and is now in train; reusing it in the new holdout must fail closed.
    assert.throws(() => rotateHoldout(initial, ["h5"], NOW), /appears in more than one split/);
  });

  it("rejects unsupported manifest versions", () => {
    assert.throws(
      () => validateSealedDatasetManifest({ ...manifest(), manifestVersion: 2 as 1 }),
      /unsupported manifest version/
    );
  });
});
