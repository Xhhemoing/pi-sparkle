import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";
import { nowIso } from "../domain/timestamp.js";

export interface DatasetManifest {
  readonly manifestVersion: 1;
  readonly datasetId: string;
  /** Frozen episode hashes — the dataset is immutable. */
  readonly episodeHashes: readonly string[];
  /** Hashes excluded from every split (privacy/contamination holds). */
  readonly exclusions: readonly string[];
  readonly split: {
    readonly train: readonly string[];
    readonly eval: readonly string[];
    /**
     * Phase C Task 7: sealed holdout. Optional on pre-Phase-C manifests;
     * `undefined` means no holdout exists and a sealed evaluation claim is
     * impossible.
     */
    readonly holdout?: readonly string[] | undefined;
  };
  /** Set by markHoldoutCompromised; compromised holdouts fail closed. */
  readonly compromised?: boolean | undefined;
  /** Resource versions (models, features) frozen for the dataset. */
  readonly resourceVersions: Record<string, string>;
  /** Environment facts frozen for the dataset. */
  readonly environment: Record<string, string>;
  readonly seed: number;
  readonly createdAt: string;
}

/** Deterministic canonical serialization: keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(",")}}`;
}

export function manifestHash(manifest: DatasetManifest): string {
  return `mh_${hash32(stableStringify(manifest))}`;
}

export function validateManifest(manifest: DatasetManifest): void {
  if (manifest.manifestVersion !== 1) {
    throw new DomainValidationError(`unsupported manifest version: ${manifest.manifestVersion}`);
  }
  if (!Number.isInteger(manifest.seed)) {
    throw new DomainValidationError("manifest seed must be an integer");
  }
  const all = new Set(manifest.episodeHashes);
  if (all.size !== manifest.episodeHashes.length) {
    throw new DomainValidationError("duplicate episode hashes in manifest");
  }
  for (const excluded of manifest.exclusions) {
    if (!all.has(excluded)) {
      throw new DomainValidationError(`exclusion references unknown episode: ${excluded}`);
    }
  }
  const train = new Set(manifest.split.train);
  const evalSet = new Set(manifest.split.eval);
  const holdoutList = manifest.split.holdout ?? [];
  const holdoutSet = new Set(holdoutList);
  if (
    train.size !== manifest.split.train.length ||
    evalSet.size !== manifest.split.eval.length ||
    holdoutSet.size !== holdoutList.length
  ) {
    throw new DomainValidationError("split lists contain duplicates");
  }
  for (const hash of manifest.split.train) {
    if (evalSet.has(hash) || holdoutSet.has(hash)) {
      throw new DomainValidationError(`episode in both splits: ${hash}`);
    }
    if (!all.has(hash)) {
      throw new DomainValidationError(`split references unknown episode: ${hash}`);
    }
  }
  for (const hash of manifest.split.eval) {
    if (holdoutSet.has(hash)) {
      throw new DomainValidationError(`episode in both splits: ${hash}`);
    }
    if (!all.has(hash)) {
      throw new DomainValidationError(`split references unknown episode: ${hash}`);
    }
  }
  for (const hash of holdoutList) {
    if (!all.has(hash)) {
      throw new DomainValidationError(`split references unknown episode: ${hash}`);
    }
  }
  for (const excluded of manifest.exclusions) {
    if (train.has(excluded) || evalSet.has(excluded) || holdoutSet.has(excluded)) {
      throw new DomainValidationError(`excluded episode appears in a split: ${excluded}`);
    }
  }
}

/**
 * Phase C Task 7: seal a holdout after any optimization-side access. A
 * compromised manifest can never back a sealed-evaluation claim.
 */
export function markHoldoutCompromised(
  manifest: DatasetManifest,
  reason: string
): DatasetManifest {
  if ((manifest.split.holdout ?? []).length === 0) {
    throw new DomainValidationError("cannot compromise a manifest without a holdout");
  }
  return {
    ...manifest,
    compromised: true,
    environment: { ...manifest.environment, holdoutCompromiseReason: reason }
  };
}

/** Guard for any sealed evaluation path: refuse compromised or missing holdouts. */
export function assertHoldoutUsable(manifest: DatasetManifest): void {
  if (manifest.compromised === true) {
    throw new DomainValidationError(
      `holdout is compromised: ${manifest.environment["holdoutCompromiseReason"] ?? "unknown reason"}`
    );
  }
  if ((manifest.split.holdout ?? []).length === 0) {
    throw new DomainValidationError("manifest has no sealed holdout; sealed evaluation is impossible");
  }
}

export function createManifest(
  partial: Omit<DatasetManifest, "manifestVersion" | "createdAt">
): DatasetManifest {
  const manifest: DatasetManifest = {
    manifestVersion: 1,
    createdAt: nowIso(),
    ...partial,
  };
  validateManifest(manifest);
  return manifest;
}
