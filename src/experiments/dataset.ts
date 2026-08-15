import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { stableStringify } from "./manifest.js";

/**
 * M6-T2: immutable three-way sealed dataset manifest. Train, validation, and
 * holdout splits are frozen and contamination-checked; a hash over the whole
 * manifest makes any later tampering detectable.
 */

export interface SealedSplits {
  readonly train: readonly string[];
  readonly validation: readonly string[];
  readonly holdout: readonly string[];
}

/** The immediately preceding holdout split, preserved for comparability. */
export interface PreviousHoldoutSnapshot {
  readonly datasetId: string;
  readonly rotation: number;
  readonly episodeHashes: readonly string[];
}

export interface SealedDatasetManifest {
  readonly manifestVersion: 1;
  readonly datasetId: string;
  /** The frozen episode universe — every split and exclusion must live inside it. */
  readonly episodeHashes: readonly string[];
  readonly splits: SealedSplits;
  readonly exclusions: readonly string[];
  /** 0 = initial split; each rotation increments. */
  readonly rotation: number;
  readonly previousHoldout: PreviousHoldoutSnapshot | undefined;
  readonly resourceVersions: {
    readonly model: string;
    readonly features: string;
  };
  readonly createdAt: IsoTimestamp;
}

export const SUPPORTED_SEALED_MANIFEST_VERSION = 1;

export function sealedManifestHash(manifest: SealedDatasetManifest): string {
  return hash32(
    stableStringify({
      datasetId: manifest.datasetId,
      episodeHashes: manifest.episodeHashes,
      splits: manifest.splits,
      exclusions: manifest.exclusions,
      rotation: manifest.rotation,
      previousHoldout: manifest.previousHoldout,
      resourceVersions: manifest.resourceVersions,
    })
  );
}

function assertUniqueNonEmpty(hashes: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const hash of hashes) {
    if (hash.trim() === "") {
      throw new DomainValidationError(`${label} contains an empty episode hash`);
    }
    if (seen.has(hash)) {
      throw new DomainValidationError(`${label} contains a duplicate episode hash: ${hash}`);
    }
    seen.add(hash);
  }
}

export function validateSealedDatasetManifest(manifest: SealedDatasetManifest): void {
  if (manifest.manifestVersion !== SUPPORTED_SEALED_MANIFEST_VERSION) {
    throw new DomainValidationError(
      `unsupported manifest version: ${manifest.manifestVersion}`
    );
  }
  if (manifest.datasetId.trim() === "") {
    throw new DomainValidationError("datasetId is required");
  }
  if (manifest.episodeHashes.length === 0) {
    throw new DomainValidationError("episode universe must not be empty");
  }
  assertUniqueNonEmpty(manifest.episodeHashes, "episode universe");

  const { train, validation, holdout } = manifest.splits;
  assertUniqueNonEmpty(train, "train split");
  assertUniqueNonEmpty(validation, "validation split");
  assertUniqueNonEmpty(holdout, "holdout split");

  const universe = new Set(manifest.episodeHashes);
  const membership = new Map<string, string>();
  for (const [name, hashes] of [
    ["train", train],
    ["validation", validation],
    ["holdout", holdout],
  ] as const) {
    for (const hash of hashes) {
      if (!universe.has(hash)) {
        throw new DomainValidationError(`unknown episode ${hash} in ${name} split`);
      }
      const prior = membership.get(hash);
      if (prior !== undefined) {
        throw new DomainValidationError(
          `contamination: episode ${hash} appears in more than one split (${prior} and ${name})`
        );
      }
      membership.set(hash, name);
    }
  }

  assertUniqueNonEmpty(manifest.exclusions, "exclusions");
  for (const hash of manifest.exclusions) {
    if (!universe.has(hash)) {
      throw new DomainValidationError(`unknown episode ${hash} in exclusions`);
    }
    if (membership.has(hash)) {
      throw new DomainValidationError(
        `exclusion ${hash} appears in the ${membership.get(hash)} split`
      );
    }
  }

  if (!Number.isInteger(manifest.rotation) || manifest.rotation < 0) {
    throw new DomainValidationError("rotation must be a non-negative integer");
  }
  if (manifest.rotation === 0 && manifest.previousHoldout !== undefined) {
    throw new DomainValidationError(
      "previous holdout snapshot is only allowed after the first rotation"
    );
  }
  if (manifest.rotation > 0) {
    if (manifest.previousHoldout === undefined) {
      throw new DomainValidationError("previous holdout snapshot is required after rotation");
    }
    const prev = manifest.previousHoldout;
    if (prev.datasetId !== manifest.datasetId) {
      throw new DomainValidationError("previous holdout must belong to the same dataset");
    }
    if (prev.rotation !== manifest.rotation - 1) {
      throw new DomainValidationError(
        "previous holdout must be the immediately preceding rotation"
      );
    }
    if (prev.episodeHashes.length === 0) {
      throw new DomainValidationError("previous holdout snapshot must not be empty");
    }
    for (const hash of prev.episodeHashes) {
      if (!universe.has(hash)) {
        throw new DomainValidationError(`previous holdout references unknown episode ${hash}`);
      }
    }
  }

  if (manifest.resourceVersions.model.trim() === "" || manifest.resourceVersions.features.trim() === "") {
    throw new DomainValidationError("resource versions must not be empty");
  }
  if (!isIsoTimestamp(manifest.createdAt)) {
    throw new DomainValidationError("createdAt must be an ISO timestamp");
  }
}

export function createSealedDatasetManifest(
  partial: Omit<SealedDatasetManifest, "manifestVersion">
): SealedDatasetManifest {
  const manifest: SealedDatasetManifest = {
    manifestVersion: SUPPORTED_SEALED_MANIFEST_VERSION,
    ...partial,
  };
  validateSealedDatasetManifest(manifest);
  return manifest;
}

/**
 * Rotate the holdout on schedule: the old holdout folds into the training
 * split, the new holdout becomes the evaluation split, and the previous
 * holdout stays frozen in the manifest for comparability.
 */
export function rotateHoldout(
  manifest: SealedDatasetManifest,
  holdout: readonly string[],
  createdAt: IsoTimestamp
): SealedDatasetManifest {
  validateSealedDatasetManifest(manifest);
  if (holdout.length === 0) {
    throw new DomainValidationError("new holdout split must not be empty");
  }
  return createSealedDatasetManifest({
    datasetId: manifest.datasetId,
    episodeHashes: manifest.episodeHashes,
    splits: {
      train: [...manifest.splits.train, ...manifest.splits.holdout],
      validation: manifest.splits.validation,
      holdout,
    },
    exclusions: manifest.exclusions,
    rotation: manifest.rotation + 1,
    previousHoldout: {
      datasetId: manifest.datasetId,
      rotation: manifest.rotation,
      episodeHashes: [...manifest.splits.holdout],
    },
    resourceVersions: manifest.resourceVersions,
    createdAt,
  });
}
