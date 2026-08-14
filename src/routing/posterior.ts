import type { OutcomeObservation } from "./outcomes.js";
import { outcomeKey } from "./outcomes.js";

export interface BetaPosterior {
  readonly alpha: number;
  readonly beta: number;
}

export interface PosteriorConfig {
  readonly priorAlpha: number;
  readonly priorBeta: number;
  /** Half-life for exponential recency decay, in ms. */
  readonly halfLifeMs: number;
  /** Minimum weighted samples before an estimate is trusted. */
  readonly minSamples: number;
  /** Z-score for the lower confidence bound. */
  readonly lcbZ: number;
}

export const DEFAULT_POSTERIOR_CONFIG: PosteriorConfig = {
  priorAlpha: 1,
  priorBeta: 1,
  halfLifeMs: 24 * 60 * 60 * 1000,
  minSamples: 5,
  lcbZ: 1.96,
};

/**
 * Weighted Beta-Bernoulli update. Only informative outcomes (PASS/FAIL)
 * contribute; each observation is decayed by its age relative to `nowMs`,
 * making the posterior fully deterministic under fake time.
 */
export function updatePosterior(
  config: PosteriorConfig,
  observations: readonly OutcomeObservation[],
  nowMs: number
): BetaPosterior {
  let alpha = config.priorAlpha;
  let beta = config.priorBeta;
  for (const observation of observations) {
    if (observation.outcome === "ABSTAIN" || observation.outcome === "UNOBSERVED") continue;
    const ageMs = Math.max(0, nowMs - observation.occurredAtMs);
    const weight = Math.pow(2, -ageMs / config.halfLifeMs);
    if (observation.outcome === "PASS") alpha += weight;
    else beta += weight;
  }
  return { alpha, beta };
}

export function posteriorMean(posterior: BetaPosterior): number {
  const total = posterior.alpha + posterior.beta;
  return total > 0 ? posterior.alpha / total : 0;
}

export function posteriorVariance(posterior: BetaPosterior): number {
  const total = posterior.alpha + posterior.beta;
  if (total <= 0) return 0;
  return (posterior.alpha * posterior.beta) / (total * total * (total + 1));
}

export function lowerConfidenceBound(config: PosteriorConfig, posterior: BetaPosterior): number {
  const mean = posteriorMean(posterior);
  const sd = Math.sqrt(posteriorVariance(posterior));
  return Math.max(0, mean - config.lcbZ * sd);
}

export function weightedSampleSize(config: PosteriorConfig, posterior: BetaPosterior): number {
  return posterior.alpha + posterior.beta - config.priorAlpha - config.priorBeta;
}

export function isWellSampled(config: PosteriorConfig, posterior: BetaPosterior): boolean {
  return weightedSampleSize(config, posterior) >= config.minSamples;
}

/** Observations filtered to a single (family, role, modelVersion, featureVersion) key. */
export function observationsForKey(
  observations: readonly OutcomeObservation[],
  parts: {
    readonly taskFamily: string;
    readonly role: string;
    readonly modelVersion: string;
    readonly featureVersion: string;
  }
): OutcomeObservation[] {
  const key = outcomeKey(parts);
  return observations.filter((o) => outcomeKey(o) === key);
}

export { outcomeKey };
