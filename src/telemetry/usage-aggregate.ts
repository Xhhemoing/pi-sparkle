import type { ModelInvocation } from "./model-invocation.js";

/**
 * Cost aggregation over invocation records.
 *
 * A failed call still produces a record: the provider's error payload carries
 * a zeroed usage block, and a partially streamed response reports only what
 * arrived before the failure. Folding either into a cost total invents spend
 * that never happened, and — worse for calibration — drags the per-token
 * averages toward zero (2026-08-22 weak-area report §1.2). Only calls whose
 * terminal outcome is `ok` are eligible.
 *
 * Records written before `callOutcome` existed carry no outcome at all. They
 * are treated conservatively: excluded, and counted separately so a caller can
 * see the difference between "this call failed" and "this record predates
 * outcome attribution".
 */

/** A call the provider completed, so its reported usage can be billed. */
export function isCostEligible(invocation: ModelInvocation): boolean {
  return invocation.callOutcome === "ok";
}

/** A record with no terminal outcome — legacy, not a known failure. */
export function isUnattributed(invocation: ModelInvocation): boolean {
  return invocation.callOutcome === undefined;
}

export function costEligibleInvocations(
  invocations: readonly ModelInvocation[]
): ModelInvocation[] {
  return invocations.filter(isCostEligible);
}

export interface UsageTotals {
  /** Cost-eligible records that were summed. */
  readonly invocations: number;
  /** Summed input tokens; undefined when no eligible record reported any. */
  readonly tokensIn: number | undefined;
  /** Summed output tokens; undefined when no eligible record reported any. */
  readonly tokensOut: number | undefined;
  /** Eligible records that reported at least one usage count. */
  readonly withUsage: number;
  /** Eligible records the provider reported no usage for. */
  readonly missingUsage: number;
  /** Records dropped because their terminal outcome was not `ok`. */
  readonly excludedNotOk: number;
  /** Records dropped because they carry no terminal outcome at all. */
  readonly excludedUnattributed: number;
}

/**
 * Sum usage across cost-eligible invocations. Totals stay undefined rather
 * than collapsing to zero when nothing reported usage, so "no data" never
 * reads as "no tokens".
 */
export function sumUsage(invocations: readonly ModelInvocation[]): UsageTotals {
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let eligible = 0;
  let withUsage = 0;
  let excludedNotOk = 0;
  let excludedUnattributed = 0;
  for (const invocation of invocations) {
    if (!isCostEligible(invocation)) {
      if (isUnattributed(invocation)) excludedUnattributed += 1;
      else excludedNotOk += 1;
      continue;
    }
    eligible += 1;
    const reportedIn = usableCount(invocation.tokensIn);
    const reportedOut = usableCount(invocation.tokensOut);
    if (reportedIn === undefined && reportedOut === undefined) continue;
    withUsage += 1;
    if (reportedIn !== undefined) tokensIn = (tokensIn ?? 0) + reportedIn;
    if (reportedOut !== undefined) tokensOut = (tokensOut ?? 0) + reportedOut;
  }
  return {
    invocations: eligible,
    tokensIn,
    tokensOut,
    withUsage,
    missingUsage: eligible - withUsage,
    excludedNotOk,
    excludedUnattributed
  };
}

/** Mirrors the invocation validator: usage is a non-negative integer or nothing. */
function usableCount(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}
