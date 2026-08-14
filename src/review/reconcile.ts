import type { PairwiseResult } from "./pairwise.js";

export interface ReconciliationResult {
  readonly consensus: "a" | "b" | "tie" | "uncertain";
  /** Full dissenting results, preserved for downstream attribution. */
  readonly dissent: PairwiseResult[];
  readonly dissentCount: number;
  /** Deduplicated defect rationales across the dissent. */
  readonly causalDefects: string[];
}

/**
 * Reconciles repeated pairwise comparisons: equal win counts yield
 * uncertainty (position-sensitive disagreement is never resolved silently),
 * otherwise the majority wins and the full dissent is preserved while its
 * causal defects are deduplicated.
 */
export function reconcileReviews(
  results: readonly PairwiseResult[]
): ReconciliationResult {
  if (results.length === 0) {
    return { consensus: "tie", dissent: [], dissentCount: 0, causalDefects: [] };
  }

  const aWins = results.filter((r) => r.winner === "a").length;
  const bWins = results.filter((r) => r.winner === "b").length;

  let consensus: "a" | "b" | "tie" | "uncertain";
  if (aWins === bWins) {
    consensus = "uncertain";
  } else {
    consensus = aWins > bWins ? "a" : "b";
  }

  const dissent = results.filter(
    (r) => r.winner !== consensus && r.winner !== "tie"
  );

  const causalDefects = Array.from(new Set(dissent.map((d) => d.rationale)));

  return {
    consensus,
    dissent,
    dissentCount: dissent.length,
    causalDefects,
  };
}
