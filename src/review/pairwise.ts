import type { EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { createEventId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { reconcileReviews, type ReconciliationResult } from "./reconcile.js";

export interface PairwiseInput {
  readonly episodeId: EpisodeId;
  readonly aId: string;
  readonly bId: string;
  readonly aScore: number;
  readonly bScore: number;
  readonly aComment: string;
  readonly bComment: string;
}

export interface PairwiseResult {
  readonly id: string;
  readonly episodeId: EpisodeId;
  readonly aId: string;
  readonly bId: string;
  readonly winner: "a" | "b" | "tie";
  readonly rationale: string;
  readonly createdAt: IsoTimestamp;
  readonly orderSwapped?: boolean;
}

export function blindPairwiseCompare(input: PairwiseInput, swapOrder = false): PairwiseResult {
  let winner: "a" | "b" | "tie";
  let rationale: string;

  if (input.aScore === input.bScore) {
    winner = "tie";
    rationale = "scores equal; position bias avoided";
  } else if (input.aScore > input.bScore) {
    winner = "a";
    rationale = swapOrder ? "a higher after swap" : "a higher on first presentation";
  } else {
    winner = "b";
    rationale = swapOrder ? "b higher after swap" : "b higher on first presentation";
  }

  return {
    id: createEventId(),
    episodeId: input.episodeId,
    aId: input.aId,
    bId: input.bId,
    winner,
    rationale,
    createdAt: nowIso(),
    orderSwapped: swapOrder,
  };
}

export type PresentationOrder = "ab" | "ba";

export interface BlindPairwisePairOptions {
  /**
   * When true, `aScore`/`bScore` bind to presentation slots (left/right)
   * rather than candidate identities. A position-biased judge that always
   * prefers the first slot will disagree across the swapped presentation.
   */
  readonly bindScoresToSlots?: boolean | undefined;
}

export interface BlindPairwisePairResult {
  readonly first: PairwiseResult;
  readonly swapped: PairwiseResult;
  readonly reconciliation: ReconciliationResult;
  readonly initialOrder: PresentationOrder;
}

/**
 * Randomize initial left/right presentation, compare, then repeat with the
 * opposite order. Identity-stable scores agree; slot-bound (position-biased)
 * scores become `uncertain` via `reconcileReviews`.
 *
 * `rng()` draws the initial order: values `< 0.5` present A-then-B, otherwise
 * B-then-A. The material comparison always runs twice.
 */
export function runBlindPairwisePair(
  input: PairwiseInput,
  rng: () => number,
  options?: BlindPairwisePairOptions | undefined
): BlindPairwisePairResult {
  const bindScoresToSlots = options?.bindScoresToSlots === true;
  const initialOrder: PresentationOrder = rng() < 0.5 ? "ab" : "ba";
  const swappedOrder: PresentationOrder = initialOrder === "ab" ? "ba" : "ab";

  const first = comparePresented(input, initialOrder, false, bindScoresToSlots);
  const swapped = comparePresented(input, swappedOrder, true, bindScoresToSlots);
  const reconciliation = reconcileReviews([first, swapped]);

  return { first, swapped, reconciliation, initialOrder };
}

function comparePresented(
  input: PairwiseInput,
  order: PresentationOrder,
  orderSwapped: boolean,
  bindScoresToSlots: boolean
): PairwiseResult {
  const presented = presentInput(input, order, bindScoresToSlots);
  const raw = blindPairwiseCompare(presented, orderSwapped);
  return remapToOriginalIds(input, raw, order);
}

function presentInput(
  input: PairwiseInput,
  order: PresentationOrder,
  bindScoresToSlots: boolean
): PairwiseInput {
  if (order === "ab") return input;
  return {
    episodeId: input.episodeId,
    aId: input.bId,
    bId: input.aId,
    aScore: bindScoresToSlots ? input.aScore : input.bScore,
    bScore: bindScoresToSlots ? input.bScore : input.aScore,
    aComment: input.bComment,
    bComment: input.aComment,
  };
}

function remapToOriginalIds(
  original: PairwiseInput,
  presented: PairwiseResult,
  order: PresentationOrder
): PairwiseResult {
  if (order === "ab") {
    return { ...presented, aId: original.aId, bId: original.bId };
  }
  const winner: PairwiseResult["winner"] =
    presented.winner === "tie" ? "tie" : presented.winner === "a" ? "b" : "a";
  return {
    ...presented,
    aId: original.aId,
    bId: original.bId,
    winner,
  };
}
