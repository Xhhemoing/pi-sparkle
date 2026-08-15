import type { EpisodeId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import { createEventId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";

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
