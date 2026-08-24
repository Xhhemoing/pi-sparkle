import type { R0Decision } from "./r0.js";
import { observationsForR1, type OutcomeObservation } from "./outcomes.js";
import type { PosteriorConfig } from "./posterior.js";
import {
  DEFAULT_POSTERIOR_CONFIG,
  groupObservationsByKey,
  isWellSampled,
  lowerConfidenceBound,
  outcomeKey,
  posteriorMean,
  updatePosterior,
  weightedSampleSize,
} from "./posterior.js";
import type { ModelDescriptor } from "./capability-registry.js";

/** Versioned R1 quality floor. Live must not adapt this number. */
export const DEFAULT_QUALITY_FLOOR = 0.55;
/** Stay on the previous above-floor model until a cheaper one clears floor + margin. */
export const DEFAULT_HYSTERESIS_MARGIN = 0.02;

export interface R1Input {
  readonly r0: R0Decision;
  readonly role: string;
  readonly featureVersion: string;
  /** Eligible models, same source as R0 — no hidden global registry state. */
  readonly models: readonly ModelDescriptor[];
  readonly observations: readonly OutcomeObservation[];
  readonly config?: Partial<PosteriorConfig> | undefined;
  readonly nowMs: number;
  readonly qualityFloor?: number | undefined;
  readonly hysteresisMargin?: number | undefined;
  readonly previousModelId?: string | undefined;
}

export interface R1Estimate {
  readonly modelId: string;
  readonly key: string;
  readonly alpha: number;
  readonly beta: number;
  readonly mean: number;
  readonly lcb: number;
  readonly samples: number;
  readonly wellSampled: boolean;
}

export interface R1Decision {
  readonly selection: string | undefined;
  readonly estimates: readonly R1Estimate[];
  readonly reason: string;
  /** R1 is estimate-gated, never exploratory. */
  readonly exploratory: false;
  /** True when sparse estimates or no model above the floor forced the conservative baseline. */
  readonly fallback: boolean;
}

/**
 * Deterministic R1: keeps R0's hard-constraint eligibility gate, then among
 * well-sampled models with LCB >= quality floor picks the cheapest. Sparse
 * estimates and "none above the floor" both fall back to the approved R0
 * baseline — never the noisiest max-LCB arm.
 *
 * Shadow-only: live ModelRouter must not call this.
 */
export function routeR1(input: R1Input): R1Decision {
  const config: PosteriorConfig = { ...DEFAULT_POSTERIOR_CONFIG, ...input.config };
  const qualityFloor = input.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
  const hysteresisMargin = input.hysteresisMargin ?? DEFAULT_HYSTERESIS_MARGIN;
  const request = input.r0.request;
  const observations = observationsForR1(input.observations);

  if (input.r0.selection === undefined) {
    return {
      selection: undefined,
      estimates: [],
      reason: "no eligible model; R0 refused",
      exploratory: false,
      fallback: false,
    };
  }

  const tierIds = [input.r0.selection, ...input.r0.fallbacks];
  const estimates: R1Estimate[] = [];
  const modelsById = new Map(input.models.map((m) => [m.modelId, m]));
  const observationsByKey = groupObservationsByKey(observations);

  for (const modelId of tierIds) {
    const model = modelsById.get(modelId);
    const key = outcomeKey({
      taskFamily: request.taskFamily,
      role: input.role,
      modelVersion: model?.version ?? modelId,
      featureVersion: input.featureVersion,
    });
    const keyed = observationsByKey.get(key) ?? [];
    const posterior = updatePosterior(config, keyed, input.nowMs);
    estimates.push({
      modelId,
      key,
      alpha: posterior.alpha,
      beta: posterior.beta,
      mean: posteriorMean(posterior),
      lcb: lowerConfidenceBound(config, posterior),
      samples: weightedSampleSize(config, posterior),
      wellSampled: isWellSampled(config, posterior),
    });
  }

  const sampled = estimates.filter((e) => e.wellSampled);
  if (sampled.length === 0) {
    return {
      selection: input.r0.selection,
      estimates,
      reason: "no well-sampled estimate; conservative R0 baseline selected",
      exploratory: false,
      fallback: true,
    };
  }

  const aboveFloor = sampled.filter((e) => e.lcb >= qualityFloor);
  if (aboveFloor.length === 0) {
    return {
      selection: input.r0.selection,
      estimates,
      reason: "no well-sampled model above quality floor; conservative R0 baseline selected",
      exploratory: false,
      fallback: true,
    };
  }

  const cheapest = aboveFloor.reduce((acc, current) =>
    cheaperEstimate(acc, current, input.r0)
  );
  const previous = aboveFloor.find((e) => e.modelId === input.previousModelId);
  if (
    previous !== undefined &&
    previous.modelId !== cheapest.modelId &&
    cheapest.lcb < qualityFloor + hysteresisMargin
  ) {
    return {
      selection: previous.modelId,
      estimates,
      reason: `r1-hysteresis: previous selection still above floor (${previous.lcb.toFixed(4)})`,
      exploratory: false,
      fallback: false,
    };
  }

  return {
    selection: cheapest.modelId,
    estimates,
    reason: `cheapest above quality floor ${qualityFloor} (LCB ${cheapest.lcb.toFixed(4)})`,
    exploratory: false,
    fallback: false,
  };
}

function cheaperEstimate(left: R1Estimate, right: R1Estimate, r0: R0Decision): R1Estimate {
  const leftCost = costOf(r0, left.modelId);
  const rightCost = costOf(r0, right.modelId);
  if (rightCost < leftCost) return right;
  if (rightCost > leftCost) return left;
  const leftIndex = tierIndex(r0, left.modelId);
  const rightIndex = tierIndex(r0, right.modelId);
  return rightIndex < leftIndex ? right : left;
}

function costOf(r0: R0Decision, modelId: string): number {
  return r0.candidates.find((row) => row.modelId === modelId)?.estimatedCostUsd ?? Number.POSITIVE_INFINITY;
}

function tierIndex(r0: R0Decision, modelId: string): number {
  if (r0.selection === modelId) return 0;
  const fallback = r0.fallbacks.indexOf(modelId);
  return fallback === -1 ? Number.MAX_SAFE_INTEGER : fallback + 1;
}
