import type { R0Decision } from "./r0.js";
import type { OutcomeObservation } from "./outcomes.js";
import type { PosteriorConfig } from "./posterior.js";
import {
  DEFAULT_POSTERIOR_CONFIG,
  isWellSampled,
  lowerConfidenceBound,
  observationsForKey,
  posteriorMean,
  updatePosterior,
  weightedSampleSize,
} from "./posterior.js";
import type { ModelDescriptor } from "./capability-registry.js";

export interface R1Input {
  readonly r0: R0Decision;
  readonly role: string;
  readonly featureVersion: string;
  /** Eligible models, same source as R0 — no hidden global registry state. */
  readonly models: readonly ModelDescriptor[];
  readonly observations: readonly OutcomeObservation[];
  readonly config?: Partial<PosteriorConfig> | undefined;
  readonly nowMs: number;
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
  /** True when sparse estimates forced the conservative baseline. */
  readonly fallback: boolean;
}

/**
 * Deterministic R1: keeps R0's hard-constraint eligibility gate, then chooses
 * among eligible models by lower confidence bound. Sparse or missing
 * estimates fall back to the conservative R0 baseline (cheapest eligible).
 */
export function routeR1(input: R1Input): R1Decision {
  const config: PosteriorConfig = { ...DEFAULT_POSTERIOR_CONFIG, ...input.config };
  const request = input.r0.request;

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

  for (const modelId of tierIds) {
    const model = input.models.find((m) => m.modelId === modelId);
    const parts = {
      taskFamily: request.taskFamily,
      role: input.role,
      modelVersion: model?.version ?? modelId,
      featureVersion: input.featureVersion,
    };
    const keyed = observationsForKey(input.observations, parts);
    const posterior = updatePosterior(config, keyed, input.nowMs);
    estimates.push({
      modelId,
      key: `${parts.taskFamily}|${parts.role}|${parts.modelVersion}|${parts.featureVersion}`,
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

  const best = sampled.reduce((acc, current) => {
    if (current.lcb > acc.lcb) return current;
    if (current.lcb === acc.lcb) {
      // Tie-break deterministically by R0 cost order (tier order): keep the
      // earlier tier instead of replacing it with an equally-scored later one.
      return acc;
    }
    return acc;
  });

  return {
    selection: best.modelId,
    estimates,
    reason: `highest lower-confidence-bound estimate (${best.lcb.toFixed(4)})`,
    exploratory: false,
    fallback: false,
  };
}
