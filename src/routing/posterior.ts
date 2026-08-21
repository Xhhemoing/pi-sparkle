import type { OutcomeObservation } from "./outcomes.js";
import { isInformativeOutcome, outcomeKey } from "./outcomes.js";

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
  /** Z-score for the normal-approximation lower confidence bound. */
  readonly lcbZ: number;
  /** Production R1 default. The other kind stays available for contrast reports. */
  readonly lcbKind: LcbKind;
}

export type LcbKind = "normal" | "beta-quantile";

export const DEFAULT_POSTERIOR_CONFIG: PosteriorConfig = {
  priorAlpha: 1,
  priorBeta: 1,
  halfLifeMs: 24 * 60 * 60 * 1000,
  minSamples: 5,
  lcbZ: 1.96,
  lcbKind: "beta-quantile"
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
    if (!isInformativeOutcome(observation)) continue;
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

export function lowerConfidenceBound(
  config: PosteriorConfig,
  posterior: BetaPosterior,
  kind: LcbKind = config.lcbKind
): number {
  if (kind === "beta-quantile") {
    return betaQuantileLcb(posterior, oneSidedTail(config.lcbZ));
  }
  const mean = posteriorMean(posterior);
  const sd = Math.sqrt(posteriorVariance(posterior));
  return Math.max(0, mean - config.lcbZ * sd);
}

/** Effective observation count; prior strength is subtracted and cannot impersonate samples. */
export function nObsEff(config: PosteriorConfig, posterior: BetaPosterior): number {
  return weightedSampleSize(config, posterior);
}

export function weightedSampleSize(config: PosteriorConfig, posterior: BetaPosterior): number {
  return posterior.alpha + posterior.beta - config.priorAlpha - config.priorBeta;
}

export function isWellSampled(config: PosteriorConfig, posterior: BetaPosterior): boolean {
  return nObsEff(config, posterior) >= config.minSamples;
}

/**
 * One-sided lower quantile of Beta(alpha, beta). p is the left tail
 * (0.05 ≈ 95% one-sided). Independent of prior labeling: uses posterior parameters as-is.
 */
export function betaQuantileLcb(posterior: BetaPosterior, p = 0.05): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? 0 : 1;
  if (posterior.alpha <= 0 || posterior.beta <= 0) return 0;
  return inverseRegularizedIncompleteBeta(p, posterior.alpha, posterior.beta);
}

function oneSidedTail(_z: number): number {
  // Production one-sided 95% uses 0.05. lcbZ stays on the normal contrast path.
  return 0.05;
}

function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  const x = z - 1;
  let a = c[0]!;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const maxIt = 200;
  const eps = 3e-12;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIt; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const prefix = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (prefix * betacf(a, b, x)) / a;
  }
  return 1 - (prefix * betacf(b, a, 1 - x)) / b;
}

function inverseRegularizedIncompleteBeta(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) > p) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
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
