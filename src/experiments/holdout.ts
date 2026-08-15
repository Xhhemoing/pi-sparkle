import { randomUUID } from "node:crypto";
import { DomainValidationError } from "../domain/errors.js";
import { nowIso } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

/**
 * M6-T2 audited holdout lifecycle. Every evaluation access is recorded with a
 * declared purpose; a compromised holdout is sealed and replaced with a fresh
 * one — it is never silently reused.
 */

export interface HoldoutAccessEntry {
  readonly accessId: string;
  readonly datasetId: string;
  readonly purpose: string;
  readonly accessedAt: IsoTimestamp;
}

export interface HoldoutState {
  readonly datasetId: string;
  readonly status: "open" | "sealed";
  readonly sealedReason: string | undefined;
  readonly replacedBy: string | undefined;
  readonly audit: readonly HoldoutAccessEntry[];
}

export interface HoldoutVaultOptions {
  readonly now?: () => IsoTimestamp;
  readonly generateId?: () => string;
}

export class HoldoutVault {
  private readonly now: () => IsoTimestamp;
  private readonly generateId: () => string;
  private readonly datasets = new Map<string, HoldoutState>();

  constructor(options: HoldoutVaultOptions = {}) {
    this.now = options.now ?? nowIso;
    this.generateId = options.generateId ?? (() => `ha_${randomUUID()}`);
  }

  register(datasetId: string): void {
    if (datasetId.trim() === "") {
      throw new DomainValidationError("datasetId is required");
    }
    if (this.datasets.has(datasetId)) {
      throw new DomainValidationError(`holdout ${datasetId} is already registered`);
    }
    this.datasets.set(datasetId, {
      datasetId,
      status: "open",
      sealedReason: undefined,
      replacedBy: undefined,
      audit: [],
    });
  }

  /** Record an audited access. Sealed holdouts reject every access. */
  access(datasetId: string, purpose: string): readonly HoldoutAccessEntry[] {
    const state = this.requireDataset(datasetId);
    if (purpose.trim() === "") {
      throw new DomainValidationError("holdout access requires a declared purpose");
    }
    if (state.status === "sealed") {
      throw new DomainValidationError(
        `holdout ${datasetId} is sealed (${state.sealedReason ?? "no reason recorded"}); access rejected`
      );
    }
    const entry: HoldoutAccessEntry = {
      accessId: this.generateId(),
      datasetId,
      purpose,
      accessedAt: this.now(),
    };
    const updated: HoldoutState = {
      ...state,
      audit: [...state.audit, entry],
    };
    this.datasets.set(datasetId, updated);
    return updated.audit;
  }

  /** Seal a compromised holdout. Idempotence is NOT allowed: double seal fails. */
  seal(datasetId: string, reason: string): void {
    const state = this.requireDataset(datasetId);
    if (reason.trim() === "") {
      throw new DomainValidationError("sealing requires a recorded reason");
    }
    if (state.status === "sealed") {
      throw new DomainValidationError(`holdout ${datasetId} is already sealed`);
    }
    this.datasets.set(datasetId, { ...state, status: "sealed", sealedReason: reason });
  }

  /**
   * Point a sealed holdout at a fresh, open replacement and record the
   * handover in the old holdout's audit trail. The old dataset stays sealed.
   */
  replace(datasetId: string, replacementDatasetId: string, reason: string): void {
    const state = this.requireDataset(datasetId);
    if (state.status !== "sealed") {
      throw new DomainValidationError(
        `cannot replace unsealed holdout ${datasetId}: seal it first`
      );
    }
    const replacement = this.datasets.get(replacementDatasetId);
    if (replacement === undefined) {
      throw new DomainValidationError(`replacement holdout ${replacementDatasetId} is unregistered`);
    }
    if (replacement.status !== "open") {
      throw new DomainValidationError(`replacement holdout ${replacementDatasetId} is not open`);
    }
    if (reason.trim() === "") {
      throw new DomainValidationError("replacement requires a recorded reason");
    }
    const handover: HoldoutAccessEntry = {
      accessId: this.generateId(),
      datasetId,
      purpose: `replaced by ${replacementDatasetId}: ${reason}`,
      accessedAt: this.now(),
    };
    this.datasets.set(datasetId, {
      ...state,
      replacedBy: replacementDatasetId,
      audit: [...state.audit, handover],
    });
  }

  state(datasetId: string): HoldoutState {
    return this.requireDataset(datasetId);
  }

  private requireDataset(datasetId: string): HoldoutState {
    const state = this.datasets.get(datasetId);
    if (state === undefined) {
      throw new DomainValidationError(`holdout ${datasetId} is unregistered`);
    }
    return state;
  }
}
