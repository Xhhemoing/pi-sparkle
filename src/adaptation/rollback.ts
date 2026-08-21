import { DomainValidationError } from "../domain/errors.js";
import { isResourceVersionId } from "../domain/ids.js";
import type { ResourceVersionId } from "../domain/ids.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import type { ResourceRegistry } from "./registry.js";
import { RESOURCE_KINDS } from "./resource.js";
import type { ResourceIdentity, ResourceVersion } from "./resource.js";

export const ROLLBACK_REASONS = ["guardrail", "degradation", "user"] as const;
export type RollbackReason = (typeof ROLLBACK_REASONS)[number];

export const ROLLBACK_LEDGER_KINDS = ["rolled-back", "rollback-proposed", "rollback-rejected"] as const;
export type RollbackLedgerKind = (typeof ROLLBACK_LEDGER_KINDS)[number];

export interface RollbackInput {
  readonly identity: ResourceIdentity;
  readonly expectedCurrentVersionId: ResourceVersionId;
  readonly targetVersionId: ResourceVersionId; // must already exist in versionsFor(identity)
  readonly reason: RollbackReason;
  readonly evidence: readonly string[];
  readonly automatic: boolean; // true only for guardrail
  /** When reason is degradation, confirm:true performs the CAS instead of proposing. */
  readonly confirm?: boolean | undefined;
}

export interface RollbackLedgerEntry {
  readonly kind: RollbackLedgerKind;
  readonly fromVersionId: ResourceVersionId;
  readonly toVersionId: ResourceVersionId;
  readonly reason: RollbackReason;
  readonly automatic: boolean;
  readonly evidence: readonly string[];
  readonly at: IsoTimestamp;
}

export interface RollbackResult {
  readonly ok: boolean;
  readonly active: ResourceVersion;
  readonly ledger: readonly RollbackLedgerEntry[];
}

/** Append-only rollback log. Crash restore replaces the in-memory copy; entries are never rewritten. */
export class RollbackLog {
  private readonly entries: RollbackLedgerEntry[] = [];

  append(entry: RollbackLedgerEntry): void {
    this.entries.push(entry);
  }

  list(): readonly RollbackLedgerEntry[] {
    return [...this.entries];
  }

  last(): RollbackLedgerEntry | undefined {
    return this.entries.at(-1);
  }

  restore(entries: readonly RollbackLedgerEntry[]): void {
    this.entries.length = 0;
    this.entries.push(...entries.map(copyRollbackLedgerEntry));
  }
}

/**
 * Restore or propose restoring a previous active pointer.
 * Guardrail rollbacks are automatic (no LLM, no approval). Degradation only
 * proposes unless `confirm` is true. User rollbacks CAS with automatic:false.
 */
export function rollbackActive(registry: ResourceRegistry, input: RollbackInput): RollbackResult {
  const applied = registry.rollback(input);
  return {
    ok: applied.ok,
    active: applied.active,
    ledger: registry.rollbackLedger()
  };
}

export function validateRollbackInput(input: RollbackInput): void {
  validateIdentity(input.identity);
  if (!isResourceVersionId(input.expectedCurrentVersionId)) {
    throw new DomainValidationError(
      `unknown expected version: ${String(input.expectedCurrentVersionId)}`
    );
  }
  if (!isResourceVersionId(input.targetVersionId)) {
    throw new DomainValidationError(`unknown rollback target: ${String(input.targetVersionId)}`);
  }
  if (!ROLLBACK_REASONS.includes(input.reason)) {
    throw new DomainValidationError(`invalid rollback reason: ${String(input.reason)}`);
  }
  if (typeof input.automatic !== "boolean") {
    throw new DomainValidationError("rollback automatic flag must be a boolean");
  }
  if (input.reason === "guardrail" && input.automatic !== true) {
    throw new DomainValidationError("guardrail rollback must be automatic");
  }
  if (input.reason !== "guardrail" && input.automatic) {
    throw new DomainValidationError("automatic rollback is only allowed for guardrail");
  }
  if (!Array.isArray(input.evidence)) {
    throw new DomainValidationError("rollback evidence must be an array of strings");
  }
  for (const item of input.evidence) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new DomainValidationError("rollback evidence entries must be non-empty strings");
    }
  }
}

export function parseRollbackLedgerEntry(value: unknown): RollbackLedgerEntry {
  const record = asRecord(value, "rollback ledger entry");
  if (typeof record.kind !== "string" || !isRollbackLedgerKind(record.kind)) {
    throw new DomainValidationError(`invalid rollback ledger kind: ${String(record.kind)}`);
  }
  if (!isResourceVersionId(record.fromVersionId)) {
    throw new DomainValidationError("rollback fromVersionId is invalid");
  }
  if (!isResourceVersionId(record.toVersionId)) {
    throw new DomainValidationError("rollback toVersionId is invalid");
  }
  if (typeof record.reason !== "string" || !isRollbackReason(record.reason)) {
    throw new DomainValidationError(`invalid rollback reason: ${String(record.reason)}`);
  }
  if (typeof record.automatic !== "boolean") {
    throw new DomainValidationError("rollback automatic must be a boolean");
  }
  if (!isIsoTimestamp(record.at)) {
    throw new DomainValidationError("rollback at must be an ISO timestamp");
  }
  return copyRollbackLedgerEntry({
    kind: record.kind,
    fromVersionId: record.fromVersionId,
    toVersionId: record.toVersionId,
    reason: record.reason,
    automatic: record.automatic,
    evidence: asStringArray(record.evidence, "rollback evidence"),
    at: record.at
  });
}

function isRollbackReason(value: string): value is RollbackReason {
  return (ROLLBACK_REASONS as readonly string[]).includes(value);
}

function isRollbackLedgerKind(value: string): value is RollbackLedgerKind {
  return (ROLLBACK_LEDGER_KINDS as readonly string[]).includes(value);
}

function copyRollbackLedgerEntry(entry: RollbackLedgerEntry): RollbackLedgerEntry {
  return {
    kind: entry.kind,
    fromVersionId: entry.fromVersionId,
    toVersionId: entry.toVersionId,
    reason: entry.reason,
    automatic: entry.automatic,
    evidence: [...entry.evidence],
    at: entry.at
  };
}

function validateIdentity(identity: ResourceIdentity): void {
  if (!RESOURCE_KINDS.includes(identity.kind)) {
    throw new DomainValidationError(`invalid resource kind: ${String(identity.kind)}`);
  }
  if (typeof identity.name !== "string" || identity.name.trim() === "") {
    throw new DomainValidationError("resource name is required");
  }
  if (identity.scope.kind !== "project" && identity.scope.kind !== "user-global") {
    throw new DomainValidationError("scope kind must be project or user-global");
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DomainValidationError(`${label} must be an array of strings`);
  }
  return value as string[];
}
