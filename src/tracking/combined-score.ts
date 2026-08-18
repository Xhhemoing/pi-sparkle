import type { HumanSignal } from "./types.js";
import { isMachineScore } from "./types.js";

export interface CombineScoreInput {
  readonly P: number;
  readonly human: HumanSignal;
  readonly obviousProblem: boolean;
}

/**
 * Combined analysis-gate score.
 * No human evaluation, or no obvious problem → P.
 * Else → 0.7 * min(H, P) + 0.3 * max(H, P).
 * Missing H stays UNOBSERVED and is never filled with 0.5.
 */
export function combineScore(input: CombineScoreInput): number {
  if (!isMachineScore(input.P)) {
    throw new TypeError("P must be a finite score on [0, 1]");
  }
  if (input.human.kind === "unobserved" || !input.obviousProblem) {
    return roundScore(input.P);
  }
  const H = input.human.H;
  return roundScore(0.7 * Math.min(H, input.P) + 0.3 * Math.max(H, input.P));
}

function roundScore(value: number): number {
  return Number(value.toFixed(4));
}
