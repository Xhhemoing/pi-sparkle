/**
 * Iteration-1 equivalence & performance simulation.
 *
 * Compares the round-0 (commit fb71432) implementations — embedded below,
 * verbatim, as the frozen CONTROL — against the current production code for:
 *
 *   C1  beta-quantile LCB with lnBeta hoisted out of the bisection loop
 *   A2  prepared observation index (filter+group once per shadow report)
 *   B1  per-key estimate memo guarded by a (nowMs, config) fingerprint
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings. The script never touches production state; it only
 * imports pure functions. Run with: npx tsx scripts/iter1-equivalence-sim.ts
 */

import {
  DEFAULT_POSTERIOR_CONFIG,
  betaQuantileLcb,
  groupObservationsByKey,
  isWellSampled,
  outcomeKey,
  posteriorMean,
  posteriorVariance,
  prepareR1Observations,
  updatePosterior,
  weightedSampleSize,
  type BetaPosterior,
  type LcbKind,
  type PosteriorConfig,
} from "../src/routing/posterior.js";
import { observationsForR1, type OutcomeObservation } from "../src/routing/outcomes.js";
import { routeR0, type R0Config, type R0Decision } from "../src/routing/r0.js";
import {
  DEFAULT_HYSTERESIS_MARGIN,
  DEFAULT_QUALITY_FLOOR,
  routeR1,
  type R1Decision,
  type R1Estimate,
} from "../src/routing/r1.js";
import {
  buildR1ShadowReport,
  type FrozenR1ShadowEpisode,
  type R1ShadowReportInput,
} from "../src/routing/r1-shadow-report.js";
import {
  DEFAULT_COMPARISON_REPORT_CONFIG,
  type ComparisonReportConfig,
  type PairedEvaluationRecord,
} from "../src/experiments/comparison-report.js";
import {
  gatedComparisonReport,
  stripImprovementClaims,
} from "../src/experiments/gated-comparison.js";
import type { ModelDescriptor } from "../src/routing/capability-registry.js";
import type { RouteRequest } from "../src/routing/policy.js";

/* ------------------------------------------------------------------ */
/* Frozen round-0 reference (control). Verbatim from commit fb71432.  */
/* Only the pieces the iteration-1 change touched are copied; helpers */
/* that did not change (updatePosterior, groupObservationsByKey, ...) */
/* are imported from production so the diff under test stays minimal. */
/* ------------------------------------------------------------------ */

const counters = {
  refLnGammaCalls: 0,
  refObservationRowsScanned: 0,
};

function refLnGamma(z: number): number {
  counters.refLnGammaCalls += 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - refLnGamma(1 - z);
  }
  const x = z - 1;
  let a = c[0]!;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function refBetacf(a: number, b: number, x: number): number {
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

/** Round-0: lnBeta recomputed on every bisection iteration. */
function refRegularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBeta = refLnGamma(a) + refLnGamma(b) - refLnGamma(a + b);
  const prefix = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (prefix * refBetacf(a, b, x)) / a;
  }
  return 1 - (prefix * refBetacf(b, a, 1 - x)) / b;
}

function refInverseRegularizedIncompleteBeta(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (refRegularizedIncompleteBeta(mid, a, b) > p) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function refBetaQuantileLcb(posterior: BetaPosterior, p = 0.05): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? 0 : 1;
  if (posterior.alpha <= 0 || posterior.beta <= 0) return 0;
  return refInverseRegularizedIncompleteBeta(p, posterior.alpha, posterior.beta);
}

function refLowerConfidenceBound(
  config: PosteriorConfig,
  posterior: BetaPosterior,
  kind: LcbKind = config.lcbKind
): number {
  if (kind === "beta-quantile") {
    return refBetaQuantileLcb(posterior, 0.05);
  }
  const mean = posteriorMean(posterior);
  const sd = Math.sqrt(posteriorVariance(posterior));
  return Math.max(0, mean - config.lcbZ * sd);
}

interface RefR1Input {
  readonly r0: R0Decision;
  readonly role: string;
  readonly featureVersion: string;
  readonly models: readonly ModelDescriptor[];
  readonly observations: readonly OutcomeObservation[];
  readonly config?: Partial<PosteriorConfig> | undefined;
  readonly nowMs: number;
  readonly qualityFloor?: number | undefined;
  readonly hysteresisMargin?: number | undefined;
  readonly previousModelId?: string | undefined;
}

/** Round-0 routeR1: per-call filter + group, per-model posterior + LCB. */
function refRouteR1(input: RefR1Input): R1Decision {
  const config: PosteriorConfig = { ...DEFAULT_POSTERIOR_CONFIG, ...input.config };
  const qualityFloor = input.qualityFloor ?? DEFAULT_QUALITY_FLOOR;
  const hysteresisMargin = input.hysteresisMargin ?? DEFAULT_HYSTERESIS_MARGIN;
  const request = input.r0.request;
  counters.refObservationRowsScanned += input.observations.length;
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
  counters.refObservationRowsScanned += observations.length;
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
      lcb: refLowerConfidenceBound(config, posterior),
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

  const cheapest = aboveFloor.reduce((acc, current) => refCheaperEstimate(acc, current, input.r0));
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

function refCheaperEstimate(left: R1Estimate, right: R1Estimate, r0: R0Decision): R1Estimate {
  const leftCost = refCostOf(r0, left.modelId);
  const rightCost = refCostOf(r0, right.modelId);
  if (rightCost < leftCost) return right;
  if (rightCost > leftCost) return left;
  const leftIndex = refTierIndex(r0, left.modelId);
  const rightIndex = refTierIndex(r0, right.modelId);
  return rightIndex < leftIndex ? right : left;
}

function refCostOf(r0: R0Decision, modelId: string): number {
  return (
    r0.candidates.find((row) => row.modelId === modelId)?.estimatedCostUsd ??
    Number.POSITIVE_INFINITY
  );
}

function refTierIndex(r0: R0Decision, modelId: string): number {
  if (r0.selection === modelId) return 0;
  const fallback = r0.fallbacks.indexOf(modelId);
  return fallback === -1 ? Number.MAX_SAFE_INTEGER : fallback + 1;
}

const REF_SIMULATION_COMPARISON_CONFIG: ComparisonReportConfig = {
  ...DEFAULT_COMPARISON_REPORT_CONFIG,
  evidenceClass: "simulation",
};
const REF_SIMULATION_CLAIM = "仿真证据";

/** Round-0 shadow report: shared observations re-concatenated per episode. */
function refBuildR1ShadowReport(input: R1ShadowReportInput): {
  comparison: ReturnType<typeof gatedComparisonReport>;
  pairs: unknown[];
} {
  if (input.episodes.length === 0) {
    throw new Error("R1 shadow report requires at least one frozen episode");
  }

  const pairs: unknown[] = [];
  const records: PairedEvaluationRecord[] = [];
  const sharedObservations = input.observations ?? [];

  for (const episode of input.episodes) {
    if (episode.episodeHash.trim() === "" || episode.taskFamily.trim() === "") {
      throw new Error("frozen episode requires episodeHash and taskFamily");
    }
    const request: RouteRequest = {
      ...episode.request,
      taskFamily: episode.taskFamily,
    };
    const r0 = routeR0(input.r0Config, input.models, request);
    counters.refObservationRowsScanned += sharedObservations.length;
    const observations = [...sharedObservations, ...(episode.observations ?? [])];
    const r1 = refRouteR1({
      r0,
      role: episode.role,
      featureVersion: input.featureVersion,
      models: input.models,
      observations,
      nowMs: input.nowMs,
      qualityFloor: input.qualityFloor,
      hysteresisMargin: input.hysteresisMargin,
      previousModelId: input.previousModelId,
    });
    if (r0.exploratory !== false || r1.exploratory !== false) {
      throw new Error("R1 shadow report forbids exploratory routing");
    }
    pairs.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily,
      r0ModelId: r0.selection,
      r1ModelId: r1.selection,
      r1Fallback: r1.fallback,
      invoked: false,
    });

    if (episode.taskSuccess !== "PASS" && episode.taskSuccess !== "FAIL") {
      continue;
    }
    if (r0.selection === undefined || r1.selection === undefined) {
      continue;
    }
    const utility = episode.taskSuccess === "PASS" ? 1 : 0;
    records.push({
      episodeHash: episode.episodeHash,
      taskFamily: episode.taskFamily,
      baselineUtility: utility,
      candidateUtility: utility,
      baselineCostUsd: refSelectedCost(r0, r0.selection),
      candidateCostUsd: refSelectedCost(r0, r1.selection),
    });
  }

  if (records.length === 0) {
    throw new Error("R1 shadow report requires at least one episode with recorded PASS or FAIL");
  }

  return {
    comparison: gatedComparisonReport({
      records,
      claims: stripImprovementClaims(input.claims ?? [REF_SIMULATION_CLAIM]),
      config: REF_SIMULATION_COMPARISON_CONFIG,
      difficultyTier: "simulation",
    }),
    pairs,
  };
}

function refSelectedCost(r0: R0Decision, modelId: string): number {
  const row = r0.candidates.find((candidate) => candidate.modelId === modelId);
  if (row === undefined) {
    throw new Error(`selected model ${modelId} is not in the R0 catalog`);
  }
  return row.estimatedCostUsd;
}

/* ------------------------------------------------------------------ */
/* Deterministic fixture generators                                   */
/* ------------------------------------------------------------------ */

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

const FAMILIES = ["bugfix", "edit", "test", "review", "plan"] as const;
const ROLES = ["engineer", "reviewer", "tester"] as const;
const VERSIONS = ["v1", "v2", "v3"] as const;
const FEATURE = "feat-sim-1";

function randomModels(rng: () => number): ModelDescriptor[] {
  const count = 2 + Math.floor(rng() * 4);
  const models: ModelDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    models.push({
      modelId: `m${i}`,
      providerId: "acme",
      // Shared versions across models exercise the same-key memo path.
      version: pick(rng, VERSIONS),
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
      capabilities: rng() < 0.9 ? ["tool-use"] : [],
      privacyClass: "cloud-approved",
      providerPolicy: rng() < 0.95 ? "approved" : "forbidden",
      inputCostPerMTok: 0.1 + rng() * 3,
      outputCostPerMTok: 0.3 + rng() * 9,
      latencyMsPer1K: 50 + rng() * 100,
      ...(rng() < 0.5 ? { approvedForHighRisk: true } : {}),
    });
  }
  return models;
}

function randomObservation(
  rng: () => number,
  models: readonly ModelDescriptor[],
  nowMs: number
): OutcomeObservation {
  const model = pick(rng, models);
  const criterion = rng() < 0.75 ? "taskSuccess" : pick(rng, ["policyCompliance", "userAcceptance", "cost"] as const);
  const outcome =
    rng() < 0.55 ? "PASS" : rng() < 0.8 ? "FAIL" : pick(rng, ["ABSTAIN", "UNOBSERVED"] as const);
  const source =
    rng() < 0.85 ? ("deterministic-check" as const) : pick(rng, ["human", "peer"] as const);
  const failureClass =
    rng() < 0.8 ? ("model" as const) : pick(rng, ["contract", "tool", "environment"] as const);
  return {
    taskFamily: pick(rng, FAMILIES),
    role: pick(rng, ROLES),
    modelId: model.modelId,
    modelVersion: rng() < 0.8 ? model.version : pick(rng, VERSIONS),
    featureVersion: rng() < 0.9 ? FEATURE : "feat-old",
    criterion,
    outcome,
    // Some observations sit in the future relative to nowMs (age clamps to 0).
    occurredAtMs: nowMs - Math.floor(rng() * 3 * 24 * 60 * 60 * 1000) + Math.floor(rng() * 1000),
    source,
    failureClass,
  };
}

function randomRequest(rng: () => number, taskFamily: string): RouteRequest {
  return {
    taskFamily,
    privacyRequired: "cloud-approved",
    requiredCapabilities: rng() < 0.9 ? ["tool-use"] : ["image-gen"],
    contextNeeded: 50_000 + Math.floor(rng() * 100_000),
    outputNeeded: 2_000 + Math.floor(rng() * 8_000),
    budgetUsd: 10,
    deadlineMs: 600_000,
    highRisk: rng() < 0.2,
  };
}

const R0_CONFIG: R0Config = { confidenceGate: 0.7, cascade: true, policyVersion: "r0-v1" };

/* ------------------------------------------------------------------ */
/* Bitwise deep equality                                              */
/* ------------------------------------------------------------------ */

function assertBitEqual(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number" || typeof actual === "number") {
    if (!Object.is(actual, expected)) {
      throw new Error(`bit mismatch at ${path}: ${String(actual)} !== ${String(expected)}`);
    }
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`array shape mismatch at ${path}`);
    }
    for (let i = 0; i < expected.length; i++) {
      assertBitEqual(actual[i], expected[i], `${path}[${i}]`);
    }
    return;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") {
      throw new Error(`object shape mismatch at ${path}`);
    }
    const expectedKeys = Object.keys(expected as Record<string, unknown>).sort();
    const actualKeys = Object.keys(actual as Record<string, unknown>).sort();
    if (expectedKeys.join(",") !== actualKeys.join(",")) {
      throw new Error(
        `key mismatch at ${path}: [${actualKeys.join(",")}] !== [${expectedKeys.join(",")}]`
      );
    }
    for (const key of expectedKeys) {
      assertBitEqual(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`
      );
    }
    return;
  }
  if (actual !== expected) {
    throw new Error(`value mismatch at ${path}: ${String(actual)} !== ${String(expected)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Scenario 1: C1 — beta quantile LCB bitwise equality                */
/* ------------------------------------------------------------------ */

function scenarioBetaQuantile(): number {
  let checked = 0;
  const rng = mulberry32(11);
  const grid = [0.5, 1, 1.5, 2, 5, 10, 42.25, 100, 512.125];
  for (const alpha of grid) {
    for (const beta of grid) {
      for (const p of [0.01, 0.05, 0.5, 0.95]) {
        assertBitEqual(
          betaQuantileLcb({ alpha, beta }, p),
          refBetaQuantileLcb({ alpha, beta }, p),
          `betaQuantileLcb(${alpha},${beta},${p})`
        );
        checked += 1;
      }
    }
  }
  for (let i = 0; i < 2000; i++) {
    const alpha = rng() * 200 + 0.01;
    const beta = rng() * 200 + 0.01;
    const p = rng();
    assertBitEqual(
      betaQuantileLcb({ alpha, beta }, p),
      refBetaQuantileLcb({ alpha, beta }, p),
      `betaQuantileLcb(${alpha},${beta},${p})`
    );
    checked += 1;
  }
  // Degenerate guards: p outside (0,1), non-positive parameters.
  for (const [alpha, beta, p] of [
    [1, 1, 0],
    [1, 1, 1],
    [1, 1, -0.5],
    [0, 3, 0.05],
    [3, 0, 0.05],
    [-1, 2, 0.05],
  ] as const) {
    assertBitEqual(
      betaQuantileLcb({ alpha, beta }, p),
      refBetaQuantileLcb({ alpha, beta }, p),
      `betaQuantileLcb-degenerate(${alpha},${beta},${p})`
    );
    checked += 1;
  }
  return checked;
}

/* ------------------------------------------------------------------ */
/* Scenario 2: routeR1 raw path + prepared path + memo reuse          */
/* ------------------------------------------------------------------ */

function scenarioRouteR1(): number {
  const rng = mulberry32(23);
  let checked = 0;
  for (let caseIndex = 0; caseIndex < 500; caseIndex++) {
    const models = randomModels(rng);
    const nowMs = 1_700_000_000_000 + Math.floor(rng() * 1_000_000);
    const observationCount = Math.floor(rng() * 120);
    const observations = Array.from({ length: observationCount }, () =>
      randomObservation(rng, models, nowMs)
    );
    const taskFamily = pick(rng, FAMILIES);
    const role = pick(rng, ROLES);
    const r0 = routeR0(R0_CONFIG, models, randomRequest(rng, taskFamily));
    const config: Partial<PosteriorConfig> | undefined =
      rng() < 0.5
        ? undefined
        : {
            lcbKind: rng() < 0.5 ? "normal" : "beta-quantile",
            minSamples: 1 + Math.floor(rng() * 8),
            halfLifeMs: (1 + Math.floor(rng() * 48)) * 60 * 60 * 1000,
          };
    const shared = {
      r0,
      role,
      featureVersion: rng() < 0.9 ? FEATURE : "feat-old",
      models,
      nowMs,
      qualityFloor: rng() < 0.3 ? 0.4 + rng() * 0.3 : undefined,
      hysteresisMargin: rng() < 0.3 ? rng() * 0.3 : undefined,
      previousModelId: rng() < 0.4 ? pick(rng, models).modelId : undefined,
      config,
    };

    const expected = refRouteR1({ ...shared, observations });
    const rawPath = routeR1({ ...shared, observations });
    assertBitEqual(rawPath, expected, `case${caseIndex}.rawPath`);

    const prepared = prepareR1Observations(observations);
    const preparedPath = routeR1({ ...shared, observations: prepared });
    assertBitEqual(preparedPath, expected, `case${caseIndex}.preparedPath`);

    // Reuse the same prepared index (memo warm) — must stay bitwise identical.
    const preparedAgain = routeR1({ ...shared, observations: prepared });
    assertBitEqual(preparedAgain, expected, `case${caseIndex}.preparedMemoReuse`);

    // Fingerprint guard: same prepared index, different nowMs and config
    // must recompute, matching a fresh reference run.
    const shiftedNowMs = nowMs + 12 * 60 * 60 * 1000;
    const shiftedConfig: Partial<PosteriorConfig> = { lcbKind: "normal", minSamples: 2 };
    const expectedShifted = refRouteR1({
      ...shared,
      observations,
      nowMs: shiftedNowMs,
      config: shiftedConfig,
    });
    const shifted = routeR1({
      ...shared,
      observations: prepared,
      nowMs: shiftedNowMs,
      config: shiftedConfig,
    });
    assertBitEqual(shifted, expectedShifted, `case${caseIndex}.fingerprintInvalidation`);
    checked += 4;
  }
  return checked;
}

/* ------------------------------------------------------------------ */
/* Scenario 3: full shadow report equivalence                         */
/* ------------------------------------------------------------------ */

function randomEpisodes(
  rng: () => number,
  models: readonly ModelDescriptor[],
  nowMs: number
): FrozenR1ShadowEpisode[] {
  const count = 1 + Math.floor(rng() * 40);
  return Array.from({ length: count }, (_, i) => {
    const taskFamily = pick(rng, FAMILIES);
    const taskSuccess =
      rng() < 0.45 ? ("PASS" as const) : rng() < 0.8 ? ("FAIL" as const) : ("UNOBSERVED" as const);
    const ownCount = rng() < 0.3 ? Math.floor(rng() * 6) : 0;
    const own = Array.from({ length: ownCount }, () => randomObservation(rng, models, nowMs));
    return {
      episodeHash: `ep-${i}`,
      taskFamily,
      role: pick(rng, ROLES),
      request: randomRequest(rng, taskFamily),
      taskSuccess,
      ...(own.length > 0 ? { observations: own } : {}),
    };
  });
}

function scenarioShadowReport(): number {
  const rng = mulberry32(37);
  let checked = 0;
  for (let caseIndex = 0; caseIndex < 60; caseIndex++) {
    const models = randomModels(rng);
    const nowMs = 1_700_000_000_000 + Math.floor(rng() * 1_000_000);
    const sharedCount = Math.floor(rng() * 800);
    const sharedObservations = Array.from({ length: sharedCount }, () =>
      randomObservation(rng, models, nowMs)
    );
    const episodes = randomEpisodes(rng, models, nowMs);
    const input: R1ShadowReportInput = {
      episodes,
      models,
      r0Config: R0_CONFIG,
      featureVersion: FEATURE,
      nowMs,
      observations: sharedObservations,
      ...(rng() < 0.3 ? { claims: ["仿真证据", "candidate improves quality"] } : {}),
      ...(rng() < 0.3 ? { qualityFloor: 0.45 + rng() * 0.2 } : {}),
      ...(rng() < 0.3 ? { hysteresisMargin: rng() * 0.2 } : {}),
      ...(rng() < 0.3 ? { previousModelId: pick(rng, models).modelId } : {}),
    };

    let expected: unknown;
    let expectedError: string | undefined;
    try {
      expected = refBuildR1ShadowReport(input);
    } catch (error) {
      expectedError = error instanceof Error ? error.message : String(error);
    }
    let actual: unknown;
    let actualError: string | undefined;
    try {
      actual = buildR1ShadowReport(input);
    } catch (error) {
      actualError = error instanceof Error ? error.message : String(error);
    }
    if (expectedError !== undefined || actualError !== undefined) {
      if (expectedError !== actualError) {
        throw new Error(
          `case${caseIndex}: error mismatch: "${actualError}" !== "${expectedError}"`
        );
      }
    } else {
      assertBitEqual(actual, expected, `case${caseIndex}.report`);
    }
    checked += 1;
  }
  return checked;
}

/* ------------------------------------------------------------------ */
/* Scenario 4: hot-path cost — wall time + operation counts           */
/* ------------------------------------------------------------------ */

function scenarioPerformance(): void {
  const rng = mulberry32(53);
  const models = randomModels(mulberry32(7)); // fixed catalog for the timing run
  const nowMs = 1_700_000_000_000;
  const sharedObservations = Array.from({ length: 20_000 }, () =>
    randomObservation(rng, models, nowMs)
  );
  const episodes: FrozenR1ShadowEpisode[] = Array.from({ length: 200 }, (_, i) => {
    const taskFamily = pick(rng, FAMILIES);
    return {
      episodeHash: `perf-${i}`,
      taskFamily,
      role: pick(rng, ROLES),
      request: { ...randomRequest(rng, taskFamily), requiredCapabilities: ["tool-use"], highRisk: false },
      taskSuccess: rng() < 0.5 ? "PASS" : "FAIL",
    };
  });
  const input: R1ShadowReportInput = {
    episodes,
    models,
    r0Config: R0_CONFIG,
    featureVersion: FEATURE,
    nowMs,
    observations: sharedObservations,
  };

  // Equivalence on the perf fixture first.
  const expected = refBuildR1ShadowReport(input);
  const actual = buildR1ShadowReport(input);
  assertBitEqual(actual, expected, "perfFixture.report");

  const timing = (label: string, run: () => void): number => {
    run(); // warm-up
    const runs = 5;
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = process.hrtime.bigint();
      run();
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(runs / 2)]!;
    print(`  ${label}: median ${median.toFixed(1)} ms (min ${samples[0]!.toFixed(1)}, max ${samples[runs - 1]!.toFixed(1)})`);
    return median;
  };

  print("perf fixture: E=200 episodes, N=20000 shared observations, M=" + models.length);

  counters.refLnGammaCalls = 0;
  counters.refObservationRowsScanned = 0;
  const refMedian = timing("round-0 reference buildR1ShadowReport", () => {
    refBuildR1ShadowReport(input);
  });
  print(
    `  round-0 ops per run: ~${Math.round(counters.refObservationRowsScanned / 6).toLocaleString()} observation-row scans, ` +
      `~${Math.round(counters.refLnGammaCalls / 6).toLocaleString()} lnGamma calls`
  );

  const newMedian = timing("iteration-1 production buildR1ShadowReport", () => {
    buildR1ShadowReport(input);
  });
  print(
    `  speedup: ${(refMedian / newMedian).toFixed(1)}x on this fixture ` +
      "(analytic: row scans O(E*N) -> O(N); lnGamma per quantile 240 -> 3; quantiles per report E*M -> distinct keys)"
  );
}

/* ------------------------------------------------------------------ */

function main(): void {
  const s1 = scenarioBetaQuantile();
  print(`scenario 1 (C1 lnBeta hoist, beta-quantile LCB): ${s1} bitwise checks passed`);
  const s2 = scenarioRouteR1();
  print(`scenario 2 (routeR1 raw/prepared/memo/fingerprint): ${s2} bitwise checks passed`);
  const s3 = scenarioShadowReport();
  print(`scenario 3 (full shadow report old vs new): ${s3} report comparisons passed`);
  scenarioPerformance();
  print("ALL EQUIVALENCE CHECKS PASSED");
}

main();
