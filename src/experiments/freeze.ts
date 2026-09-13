import { createHash } from "node:crypto";
import { DomainValidationError } from "../domain/errors.js";
import { isRecord } from "../domain/record.js";
import type { ModelDescriptor } from "../routing/capability-registry.js";
import { stableStringify } from "./manifest.js";

/**
 * PS-P4 experiment freeze: config, catalog, dirs, build provenance, and an
 * injectable clock instant. Empty freezes and empty provenance record sets
 * fail closed — they must not produce evaluable samples.
 */

export interface BuildProvenanceRecord {
  readonly kind: string;
  readonly id: string;
  readonly digest?: string | undefined;
}

export interface BuildProvenance {
  readonly commitSha: string;
  readonly packageVersion?: string | undefined;
  /** When provided, must be non-empty — empty sets fail closed. */
  readonly records?: readonly BuildProvenanceRecord[] | undefined;
}

export interface ExperimentFreezeDirs {
  readonly stateRoot: string;
  readonly evidenceRoot: string;
  readonly worktreeRoot?: string | undefined;
  readonly catalogPath?: string | undefined;
  readonly configPath?: string | undefined;
}

export interface ExperimentFreeze {
  readonly version: 1;
  readonly clockInstantMs: number;
  readonly configHash: string;
  readonly catalogHash: string;
  readonly catalogSnapshot: readonly ModelDescriptor[];
  readonly dirs: ExperimentFreezeDirs;
  readonly buildProvenance: BuildProvenance;
  /** Provider/default config blob that was hashed into configHash. */
  readonly hasProviderConfig: boolean;
  readonly hasDefaultConfig: boolean;
}

export interface CreateExperimentFreezeInput {
  readonly nowMs: number;
  readonly config: unknown;
  readonly catalog: readonly ModelDescriptor[];
  readonly dirs: ExperimentFreezeDirs;
  readonly buildProvenance: BuildProvenance;
  readonly hasProviderConfig: boolean;
  readonly hasDefaultConfig: boolean;
}

export function hashFreezePayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

export function createExperimentFreeze(input: CreateExperimentFreezeInput): ExperimentFreeze {
  if (!Number.isFinite(input.nowMs)) {
    throw new DomainValidationError("freeze requires injectable finite nowMs");
  }
  if (!input.hasProviderConfig || !input.hasDefaultConfig) {
    throw new DomainValidationError(
      "empty state root without frozen provider/default config cannot produce evaluable samples"
    );
  }
  if (input.catalog.length === 0) {
    throw new DomainValidationError("freeze catalogSnapshot must be non-empty");
  }
  const freeze: ExperimentFreeze = {
    version: 1,
    clockInstantMs: input.nowMs,
    configHash: hashFreezePayload(input.config),
    catalogHash: hashFreezePayload(input.catalog),
    catalogSnapshot: input.catalog,
    dirs: input.dirs,
    buildProvenance: input.buildProvenance,
    hasProviderConfig: input.hasProviderConfig,
    hasDefaultConfig: input.hasDefaultConfig
  };
  validateExperimentFreeze(freeze);
  return freeze;
}

export function validateExperimentFreeze(freeze: ExperimentFreeze): void {
  if (freeze.version !== 1) {
    throw new DomainValidationError(`unsupported freeze version: ${freeze.version}`);
  }
  if (!Number.isFinite(freeze.clockInstantMs)) {
    throw new DomainValidationError("freeze.clockInstantMs must be finite");
  }
  if (freeze.configHash.trim() === "" || freeze.catalogHash.trim() === "") {
    throw new DomainValidationError("freeze configHash/catalogHash must be non-empty");
  }
  if (freeze.catalogSnapshot.length === 0) {
    throw new DomainValidationError("freeze catalogSnapshot is empty; fail closed");
  }
  if (freeze.dirs.stateRoot.trim() === "" || freeze.dirs.evidenceRoot.trim() === "") {
    throw new DomainValidationError("freeze dirs.stateRoot and evidenceRoot are required");
  }
  if (freeze.buildProvenance.commitSha.trim() === "") {
    throw new DomainValidationError("freeze buildProvenance.commitSha is required");
  }
  if (freeze.buildProvenance.records !== undefined && freeze.buildProvenance.records.length === 0) {
    throw new DomainValidationError(
      "provenance validation fail closed: empty record set cannot pass"
    );
  }
  if (!freeze.hasProviderConfig || !freeze.hasDefaultConfig) {
    throw new DomainValidationError(
      "freeze without provider/default config cannot produce evaluable samples"
    );
  }
}

/** Empty freeze object / missing fields fail closed. */
export function parseExperimentFreeze(value: unknown): ExperimentFreeze {
  if (!isRecord(value)) {
    throw new DomainValidationError("experiment freeze must be an object");
  }
  if (value.version !== 1) {
    throw new DomainValidationError("empty or unsupported freeze; fail closed");
  }
  if (!Array.isArray(value.catalogSnapshot) || value.catalogSnapshot.length === 0) {
    throw new DomainValidationError("freeze catalogSnapshot empty; fail closed");
  }
  if (!isRecord(value.dirs) || !isRecord(value.buildProvenance)) {
    throw new DomainValidationError("freeze dirs/buildProvenance required");
  }
  const freeze = value as unknown as ExperimentFreeze;
  validateExperimentFreeze(freeze);
  return freeze;
}

export function freezeAllowsEvaluation(freeze: ExperimentFreeze): boolean {
  try {
    validateExperimentFreeze(freeze);
    return true;
  } catch {
    return false;
  }
}
