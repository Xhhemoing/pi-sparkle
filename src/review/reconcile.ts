import type { PairwiseResult } from "./pairwise.js";

export interface ReconciliationResult {
  readonly consensus: "a" | "b" | "tie" | "uncertain";
  readonly dissentCount: number;
  readonly causalDefects: string[];
}

export function reconcileReviews(
  results: readonly PairwiseResult[]
): ReconciliationResult {
  if (results.length === 0) {
    return { consensus: "tie", dissentCount: 0, causalDefects: [] };
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
    dissentCount: dissent.length,
    causalDefects,
  };
}
