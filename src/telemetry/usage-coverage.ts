import { isDeepStrictEqual } from "node:util";
import type { InvocationId } from "../domain/ids.js";
import type { ModelInvocation } from "./model-invocation.js";

export type UsageCoverageOutcome = "ok" | "error" | "timeout" | "cancelled" | "unknown";

export interface UsageFieldCoverage {
  readonly reportedInvocations: number;
  readonly missingInvocations: number;
  readonly invalidInvocations: number;
}

export interface ReportedTokenCoverage extends UsageFieldCoverage {
  /** Sum of valid reported counts only; absent for no reports or unsafe arithmetic. */
  readonly tokens: number | undefined;
  readonly overflow: boolean;
  /** Every recorded identity has a valid count on this side; false for empty input. */
  readonly complete: boolean;
}

export interface ReportedCostCoverage {
  /** Only rows with BOTH valid usage counts and BOTH valid snapshot prices. */
  readonly pricedInvocations: number;
  /** USD for that whole-invocation subset; never a provider bill or partial-side estimate. */
  readonly knownUsd: number | undefined;
  /** Same estimate only when every recorded identity is covered; empty input is undefined. */
  readonly completeUsd: number | undefined;
  /** A token sum, per-row cost, or aggregate cost exceeded safe/finite arithmetic. */
  readonly overflow: boolean;
}

export interface InvocationUsageCoverage {
  /** Non-conflicting unique invocation identities, across all outcomes. */
  readonly invocations: number;
  readonly input: ReportedTokenCoverage;
  readonly output: ReportedTokenCoverage;
  readonly inputPrice: UsageFieldCoverage;
  readonly outputPrice: UsageFieldCoverage;
  readonly cost: ReportedCostCoverage;
}

export interface UsageIdentityConflict {
  readonly id: InvocationId;
  /** Raw rows, including duplicate copies, for this excluded identity. */
  readonly records: number;
  readonly variants: number;
}

export interface UsageCoverageSummary {
  readonly totalRecords: number;
  /** Includes conflicting identities. */
  readonly uniqueIdentities: number;
  /** Exact structural copies after the first, including copies within conflicts. */
  readonly duplicateRecords: number;
  /** Sorted by identity; no variant is selected or included in numeric coverage. */
  readonly conflicts: readonly UsageIdentityConflict[];
  readonly overall: InvocationUsageCoverage;
  readonly byOutcome: Readonly<Record<UsageCoverageOutcome, InvocationUsageCoverage>>;
}

/**
 * Pure reported-telemetry projection, not settlement or evidence that every call
 * was recorded. Unlike success-only calibration, all outcomes retain usage.
 * Duplicate equality covers the entire invocation row, independent of key order.
 * Conflicts exclude all variants and prevent complete totals in every outcome:
 * even the conflicting outcome itself cannot be assigned safely.
 * Prices come only from each row's snapshot; unknown fields are never guessed.
 */
export function summarizeUsageCoverage(invocations: readonly ModelInvocation[]): UsageCoverageSummary {
  const identities = new Map<InvocationId, { records: number; variants: ModelInvocation[] }>();
  let duplicateRecords = 0;
  for (const row of invocations) {
    const group = identities.get(row.id);
    if (group === undefined) {
      identities.set(row.id, { records: 1, variants: [row] });
    } else {
      group.records++;
      if (group.variants.some((variant) => isDeepStrictEqual(variant, row))) duplicateRecords++;
      else group.variants.push(row);
    }
  }

  const rows: ModelInvocation[] = [];
  const conflicts: UsageIdentityConflict[] = [];
  // Stable summation order also makes floating-point USD independent of input order.
  for (const [id, group] of [...identities].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (group.variants.length > 1) conflicts.push({ id, records: group.records, variants: group.variants.length });
    else rows.push(group.variants[0]!);
  }
  const hasConflicts = conflicts.length > 0;
  const byOutcome = {} as Record<UsageCoverageOutcome, InvocationUsageCoverage>;
  for (const outcome of ["ok", "error", "timeout", "cancelled", "unknown"] as const) {
    byOutcome[outcome] = summarizeRows(rows.filter((row) => outcomeOf(row) === outcome), hasConflicts);
  }
  return {
    totalRecords: invocations.length,
    uniqueIdentities: identities.size,
    duplicateRecords,
    conflicts,
    overall: summarizeRows(rows, hasConflicts),
    byOutcome
  };
}

function outcomeOf(row: ModelInvocation): UsageCoverageOutcome {
  switch (row.callOutcome) {
    case "ok": case "error": case "timeout": case "cancelled": return row.callOutcome;
    default: return "unknown";
  }
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function tokenCoverage(rows: readonly ModelInvocation[], side: "tokensIn" | "tokensOut", hasConflicts: boolean): ReportedTokenCoverage {
  let reportedInvocations = 0;
  let missingInvocations = 0;
  let invalidInvocations = 0;
  let sum = 0;
  let overflow = false;
  for (const row of rows) {
    const value = row[side];
    if (value === undefined) missingInvocations++;
    else if (!validCount(value)) invalidInvocations++;
    else {
      reportedInvocations++;
      sum += value;
      if (!Number.isSafeInteger(sum)) overflow = true;
    }
  }
  return {
    reportedInvocations, missingInvocations, invalidInvocations,
    tokens: reportedInvocations > 0 && !overflow ? sum : undefined,
    overflow,
    complete: rows.length > 0 && reportedInvocations === rows.length && !overflow && !hasConflicts
  };
}

type PriceSide = "inputUsdPerMTok" | "outputUsdPerMTok";

function validSnapshot(row: ModelInvocation): boolean {
  return typeof row.pricing?.catalogVersion === "string" && row.pricing.catalogVersion.trim() !== "";
}

function priceCoverage(rows: readonly ModelInvocation[], side: PriceSide): UsageFieldCoverage {
  let reportedInvocations = 0;
  let missingInvocations = 0;
  let invalidInvocations = 0;
  for (const row of rows) {
    const value = row.pricing?.[side];
    if (value === undefined) missingInvocations++;
    else if (validRate(value) && validSnapshot(row)) reportedInvocations++;
    else invalidInvocations++;
  }
  return { reportedInvocations, missingInvocations, invalidInvocations };
}

function summarizeRows(rows: readonly ModelInvocation[], hasConflicts: boolean): InvocationUsageCoverage {
  const input = tokenCoverage(rows, "tokensIn", hasConflicts);
  const output = tokenCoverage(rows, "tokensOut", hasConflicts);
  let pricedInvocations = 0;
  let sum = 0;
  let overflow = input.overflow || output.overflow;
  for (const row of rows) {
    const inputRate = row.pricing?.inputUsdPerMTok;
    const outputRate = row.pricing?.outputUsdPerMTok;
    if (!validCount(row.tokensIn) || !validCount(row.tokensOut) ||
      !validRate(inputRate) || !validRate(outputRate) || !validSnapshot(row)) continue;
    // Divide before multiplying, avoiding unnecessary intermediate overflow.
    const amount = row.tokensIn / 1_000_000 * inputRate + row.tokensOut / 1_000_000 * outputRate;
    if (!Number.isFinite(amount)) overflow = true;
    else {
      pricedInvocations++;
      sum += amount;
      if (!Number.isFinite(sum)) overflow = true;
    }
  }
  const knownUsd = pricedInvocations > 0 && !overflow ? sum : undefined;
  return {
    invocations: rows.length,
    input,
    output,
    inputPrice: priceCoverage(rows, "inputUsdPerMTok"),
    outputPrice: priceCoverage(rows, "outputUsdPerMTok"),
    cost: {
      pricedInvocations,
      knownUsd,
      completeUsd: rows.length > 0 && pricedInvocations === rows.length && !hasConflicts ? knownUsd : undefined,
      overflow
    }
  };
}
