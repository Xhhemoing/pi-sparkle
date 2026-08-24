/**
 * Round 2 / R2-C equivalence & performance simulation (offline routing slice).
 *
 * Compares the post-Round-1 production implementation of `fitLogitAdditive`
 * (the landed S1-C form, embedded below verbatim as the frozen CONTROL)
 * against the current production code for the R2-C candidate:
 *
 *   S2-C  canonical-row derived-quantity reuse: rows sharing the same
 *         (scenarioId, modelVersion, projectId) covariate triple have
 *         identical design vectors, so eta = dot(beta, x) and
 *         mu = sigmoid(eta) inside every IRLS iteration — and the per-row
 *         on-probability sigmoid(dot(coef, x)) — are the same pure-function
 *         double for all of them. Computing each once per canonical key per
 *         iteration (stamped scratch local to the fit, no state escapes)
 *         and copying the double is bitwise identical to recomputing it
 *         per position. This extends the landed S1-C (a) by-index artifact
 *         reuse from static inputs (vectors / supports) to per-coefficient
 *         derived quantities, and it compounds in bootstrap draws where
 *         resampling-with-replacement multiplies key duplication.
 *
 * The landed candidate applies the dedup at the hot per-IRLS-iteration
 * eta/mu site only. Three same-family add-ons are adjudicated as REJECTED
 * variants (kept here as evidence for the exclusion table, never landed;
 * each is built independently on top of the candidate so the bench isolates
 * its marginal gain):
 *
 *   S2-C-onprob       the same canonical-key dedup at the once-per-fit
 *                     on-probability site
 *   S2-C-virtual-apc  APC off dot with the contrast column virtually
 *                     zeroed (skips the per-pair O(p) slice allocation;
 *                     multiplies coef[c] by the same +0 the copied vector
 *                     holds, so every float op is unchanged)
 *   S2-C-delta-fuse   IRLS convergence delta computed in a fused loop
 *                     instead of map + reduce (drops one p-array per
 *                     iteration)
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings. The script never touches production state; it only
 * imports pure functions. betaQuantileLcb / solveSymmetric did not change
 * this round and are imported from production, so the diff under test stays
 * exactly the R2-C edit.
 * Run with: npx tsx scripts/round02-r2c-equivalence-sim.ts
 */

import { fitLogitAdditive } from "../src/routing/offline-logit.js";
import type {
  AttributionEffect,
  AttributionLabel,
  AttributionReport,
  OfflineRow,
} from "../src/routing/offline-types.js";
import { betaQuantileLcb } from "../src/routing/posterior.js";
import { solveSymmetric } from "../src/routing/lin-alg.js";

/* ------------------------------------------------------------------ */
/* Frozen post-Round-1 reference (control). Verbatim S1-C production. */
/* ------------------------------------------------------------------ */

const counters = {
  ctlEtaDots: 0,
  ctlIterations: 0,
  varEtaDots: 0,
  varIterations: 0,
};

const MAX_ITER_DEFAULT = 50;
const TOL = 1e-8;
const BOOTSTRAP_DEFAULT = 200;
const SEED_DEFAULT = 20260818;
const INTERACTION_MIN_N = 3;
const MIN_SUCCESSFUL_DRAWS = 20;
const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;

interface CtlDesign {
  readonly names: readonly string[];
  readonly columnIndex: ReadonlyMap<string, number>;
  build(row: CtlRow, skip?: string): number[];
  readonly referenceLevels: ReadonlyArray<{ factor: "a" | "u" | "v"; name: string }>;
}

interface CtlRow {
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
}

function ctlSigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function ctlRngFn(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctlBuildDesign(rows: readonly CtlRow[]): CtlDesign {
  const scenarios = [...new Set(rows.map((r) => r.scenarioId))];
  const models = [...new Set(rows.map((r) => r.modelVersion))];
  const projects = [...new Set(rows.map((r) => r.projectId))];
  const dropLast = (levels: readonly string[]): string[] =>
    levels.slice(0, Math.max(0, levels.length - 1));
  const scenarioLevels = dropLast(scenarios);
  const modelLevels = dropLast(models);
  const projectLevels = dropLast(projects);

  const pairCounts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.modelVersion}|${row.projectId}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const interactionPairs = [...pairCounts.entries()]
    .filter(([, n]) => n >= INTERACTION_MIN_N)
    .map(([key]) => key);

  const names = [
    "intercept",
    ...scenarioLevels.map((s) => `a:${s}`),
    ...modelLevels.map((m) => `u:${m}`),
    ...projectLevels.map((p) => `v:${p}`),
    ...interactionPairs.map((key) => `w:${key}`),
  ];
  const columnIndex = new Map(names.map((name, index) => [name, index] as const));
  const interactionPairSet = new Set(interactionPairs);

  const referenceLevels: Array<{ factor: "a" | "u" | "v"; name: string }> = [];
  const lastModel = models[models.length - 1];
  const lastProject = projects[projects.length - 1];
  if (lastModel !== undefined) referenceLevels.push({ factor: "u", name: lastModel });
  if (lastProject !== undefined) referenceLevels.push({ factor: "v", name: lastProject });

  return {
    names,
    columnIndex,
    referenceLevels,
    build(row: CtlRow, skip?: string): number[] {
      const vec = new Array<number>(names.length).fill(0);
      vec[0] = 1;
      const set = (name: string): void => {
        if (name === skip) return;
        const index = columnIndex.get(name);
        if (index !== undefined && index > 0) vec[index] = 1;
      };
      if (row.scenarioId !== scenarios[scenarios.length - 1]) set(`a:${row.scenarioId}`);
      if (row.modelVersion !== models[models.length - 1]) set(`u:${row.modelVersion}`);
      if (row.projectId !== projects[projects.length - 1]) set(`v:${row.projectId}`);
      const pairKey = `${row.modelVersion}|${row.projectId}`;
      if (interactionPairSet.has(pairKey)) set(`w:${pairKey}`);
      return vec;
    },
  };
}

interface CtlFitResult {
  readonly coefficients: readonly number[] | null;
}

function ctlComputeSupports(vectors: readonly number[][]): number[][] {
  return vectors.map((vector) => {
    const active: number[] = [];
    for (let j = 0; j < vector.length; j++) {
      if (vector[j] !== 0) active.push(j);
    }
    return active;
  });
}

function ctlIrls(
  design: CtlDesign,
  rows: readonly CtlRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  maxIter: number
): CtlFitResult {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    counters.ctlIterations += 1;
    counters.ctlEtaDots += n;
    for (let i = 0; i < n; i++) {
      eta[i] = ctlDot(beta, vectors[i]!);
      mu[i] = ctlSigmoid(eta[i]!);
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const xi = vectors[i]!;
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const active = supports[i]!;
      for (const a of active) {
        xtwz[a] = xtwz[a]! + w * xi[a]! * z;
        for (const b of active) {
          xtwx[a]![b] = xtwx[a]![b]! + w * xi[a]! * xi[b]!;
        }
      }
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    const delta = next.map((value, index) => value - beta[index]!);
    const l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
}

function ctlDot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function ctlOnProbabilitiesFor(
  vectors: readonly number[][],
  coefficients: readonly number[]
): number[] {
  return vectors.map((vector) => ctlSigmoid(ctlDot(coefficients, vector)));
}

function ctlAveragePredictiveComparison(
  design: CtlDesign,
  rows: readonly CtlRow[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
): number {
  let sum = 0;
  const columnIdx = design.columnIndex.get(column);
  if (columnIdx !== undefined && columnIdx !== 0) {
    for (let i = 0; i < rows.length; i++) {
      if (vectors[i]![columnIdx] === 0) continue;
      const on = onProbabilities[i]!;
      const offVector = vectors[i]!.slice();
      offVector[columnIdx] = 0;
      const off = ctlSigmoid(ctlDot(coefficients, offVector));
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
}

function ctlPercentile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = (sortedValues.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! * (hi - index) + sortedValues[hi]! * (index - lo);
}

function ctlFitLogitAdditive(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;

  const baseRows: CtlRow[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y,
  }));
  const effects: AttributionEffect[] = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    return ctlUncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = ctlBuildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = ctlComputeSupports(vectors);
  const fit = ctlIrls(design, baseRows, vectors, supports, maxIter);
  if (fit.coefficients === null) {
    return ctlUncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = ctlOnProbabilitiesFor(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      ctlAveragePredictiveComparison(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
    );
  }
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  const random = ctlRngFn(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    const sample: CtlRow[] = [];
    const sampleVectors: number[][] = [];
    const sampleSupports: number[][] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
      sampleVectors.push(vectors[index]!);
      sampleSupports.push(supports[index]!);
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = ctlIrls(design, sample, sampleVectors, sampleSupports, maxIter);
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = ctlOnProbabilitiesFor(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = ctlAveragePredictiveComparison(
        design,
        sample,
        sampleVectors,
        bootFit.coefficients,
        sampleOnProbabilities,
        name
      );
      ctlPushValue(draws, name, value);
    }
  }

  for (const [name, point] of pointEffects.entries()) {
    const values = draws.get(name) ?? [];
    if (successful < MIN_SUCCESSFUL_DRAWS || values.length < MIN_SUCCESSFUL_DRAWS) {
      return ctlUncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
    }
    values.sort((a, b) => a - b);
    effects.push({
      name,
      point,
      lcb: ctlPercentile(values, 0.025),
      ucb: ctlPercentile(values, 0.975),
    });
  }

  const n = baseRows.length;
  const mean = baseRows.reduce((acc, r) => acc + r.y, 0) / n;
  const muPosterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const muLcb = betaQuantileLcb(muPosterior, 0.05);
  const models = new Set(baseRows.map((r) => r.modelVersion)).size;
  const projects = new Set(baseRows.map((r) => r.projectId)).size;
  const ZERO_EPS = 0.005 * ATTRIBUTION_EFFECT;
  const containsZero = (e: AttributionEffect): boolean =>
    e.lcb <= ZERO_EPS && e.ucb >= -ZERO_EPS;
  const interactionsFor = (prefix: string): AttributionEffect[] =>
    effects.filter((e) => e.name.startsWith(`w:${prefix}`));

  let diagnosis: AttributionLabel = "uncertain";
  const scenarioHard = muLcb < QUALITY_FLOOR && models >= 2 && projects >= 3;
  if (
    effects.some(
      (e) => e.name.startsWith("u:") && e.lcb < -ATTRIBUTION_EFFECT && interactionsFor(ctlModelOf(e.name)).every(containsZero)
    )
  ) {
    diagnosis = "model-problem";
  } else if (
    effects.some(
      (e) =>
        e.name.startsWith("v:") &&
        e.lcb < -ATTRIBUTION_EFFECT &&
        effects
          .filter((w) => w.name.startsWith("w:") && w.name.endsWith(`|${e.name.slice("v:".length)}`))
          .every(containsZero)
    )
  ) {
    diagnosis = "project-problem";
  } else if (effects.some((e) => e.name.startsWith("w:") && e.lcb < -ATTRIBUTION_EFFECT)) {
    diagnosis = "interaction-only";
  } else if (scenarioHard) {
    diagnosis = "scenario-hard";
  }

  return {
    estimator: "logit-additive",
    rowsUsed: baseRows.length,
    effects,
    diagnosis,
    reason: diagnosis === "uncertain" ? "no effect beyond threshold or intervals too wide" : `${diagnosis} beyond the ${ATTRIBUTION_EFFECT} effect threshold`,
    writesActivePointer: false,
  };
}

function ctlModelOf(effectName: string): string {
  return effectName.slice("u:".length);
}

function ctlPushValue(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function ctlUncertainReport(rowsUsed: number, reason: string): AttributionReport {
  return {
    estimator: "logit-additive",
    rowsUsed,
    effects: [],
    diagnosis: "uncertain",
    reason,
    writesActivePointer: false,
  };
}

/* ------------------------------------------------------------------ */
/* R2-C variants: the candidate and the adjudicated rejects.          */
/* ------------------------------------------------------------------ */

/**
 * Canonical key per base row: index of the first base row sharing the same
 * (scenarioId, modelVersion, projectId) triple. Nested maps keep the key
 * exact — no separator string that a "|" inside modelVersion could collide.
 */
function canonicalRowKeys(rows: readonly CtlRow[]): number[] {
  const byScenario = new Map<string, Map<string, Map<string, number>>>();
  const keys = new Array<number>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let byModel = byScenario.get(row.scenarioId);
    if (byModel === undefined) {
      byModel = new Map();
      byScenario.set(row.scenarioId, byModel);
    }
    let byProject = byModel.get(row.modelVersion);
    if (byProject === undefined) {
      byProject = new Map();
      byModel.set(row.modelVersion, byProject);
    }
    let canonical = byProject.get(row.projectId);
    if (canonical === undefined) {
      canonical = i;
      byProject.set(row.projectId, canonical);
    }
    keys[i] = canonical;
  }
  return keys;
}

/**
 * IRLS with canonical-key eta/mu dedup: dot(beta, x) and sigmoid are pure
 * functions of (beta, vector contents), so all positions sharing a canonical
 * key receive the identical double. The stamp scratch lives only inside this
 * call and every per-position array is filled exactly as the control fills it.
 */
function dedupIrls(
  design: CtlDesign,
  rows: readonly CtlRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  maxIter: number,
  keys: readonly number[],
  keySpace: number,
  fuseDelta: boolean
): CtlFitResult {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let uniqueKeys = 0;
  for (let i = 0; i < n; i++) {
    const k = keys[i]!;
    if (stamp[k] !== -1) {
      stamp[k] = -1;
      uniqueKeys += 1;
    }
  }
  stamp.fill(0);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    counters.varIterations += 1;
    counters.varEtaDots += uniqueKeys;
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const k = keys[i]!;
      if (stamp[k] !== mark) {
        stamp[k] = mark;
        const e = ctlDot(beta, vectors[i]!);
        etaByKey[k] = e;
        muByKey[k] = ctlSigmoid(e);
      }
      eta[i] = etaByKey[k]!;
      mu[i] = muByKey[k]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const xi = vectors[i]!;
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const active = supports[i]!;
      for (const a of active) {
        xtwz[a] = xtwz[a]! + w * xi[a]! * z;
        for (const b of active) {
          xtwx[a]![b] = xtwx[a]![b]! + w * xi[a]! * xi[b]!;
        }
      }
    }
    for (let d = 0; d < p; d++) xtwx[d]![d] = xtwx[d]![d]! + 1e-6;
    const next = solveSymmetric(xtwx, xtwz);
    if (next === null) return { coefficients: null };
    let l2: number;
    if (fuseDelta) {
      let acc = 0;
      for (let d = 0; d < p; d++) {
        const diff = next[d]! - beta[d]!;
        acc += diff * diff;
      }
      l2 = Math.sqrt(acc);
    } else {
      const delta = next.map((value, index) => value - beta[index]!);
      l2 = Math.sqrt(delta.reduce((acc, d) => acc + d * d, 0));
    }
    beta = next;
    if (!beta.every(Number.isFinite)) return { coefficients: null };
    if (l2 < TOL) break;
  }
  return { coefficients: beta };
}

/** On-probabilities with the same canonical-key dedup (one sigmoid per key). */
function dedupOnProbabilitiesFor(
  vectors: readonly number[][],
  coefficients: readonly number[],
  keys: readonly number[],
  keySpace: number
): number[] {
  const seen = new Uint8Array(keySpace);
  const probByKey = new Float64Array(keySpace);
  const out = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    const k = keys[i]!;
    if (seen[k] === 0) {
      seen[k] = 1;
      probByKey[k] = ctlSigmoid(ctlDot(coefficients, vectors[i]!));
    }
    out[i] = probByKey[k]!;
  }
  return out;
}

/**
 * REJECTED S2-C variant: APC off dot with the contrast column virtually
 * zeroed. The copied off vector holds +0 at the contrast column, and
 * `coefficients[c] * 0` multiplies the same +0, so every partial product and
 * the summation order are unchanged — it only skips the O(p) slice per pair.
 */
function virtualZeroApc(
  design: CtlDesign,
  rows: readonly CtlRow[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
): number {
  let sum = 0;
  const columnIdx = design.columnIndex.get(column);
  if (columnIdx !== undefined && columnIdx !== 0) {
    for (let i = 0; i < rows.length; i++) {
      const vec = vectors[i]!;
      if (vec[columnIdx] === 0) continue;
      const on = onProbabilities[i]!;
      let acc = 0;
      for (let j = 0; j < coefficients.length; j++) {
        acc += coefficients[j]! * (j === columnIdx ? 0 : vec[j]!);
      }
      const off = ctlSigmoid(acc);
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
}

interface VariantConfig {
  readonly dedupOnProb: boolean;
  readonly apc: "copy" | "virtual";
  readonly fuseDelta: boolean;
}

/** Shared R2-C fit driver: canonical-key dedup plus the add-ons under test. */
function variantFitLogitAdditive(
  rows: readonly OfflineRow[],
  options: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number } | undefined,
  config: VariantConfig
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;
  const apcVariant = config.apc === "virtual" ? virtualZeroApc : ctlAveragePredictiveComparison;

  const baseRows: CtlRow[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y,
  }));
  const effects: AttributionEffect[] = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    return ctlUncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = ctlBuildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = ctlComputeSupports(vectors);
  const keys = canonicalRowKeys(baseRows);
  const keySpace = baseRows.length;
  const fit = dedupIrls(design, baseRows, vectors, supports, maxIter, keys, keySpace, config.fuseDelta);
  if (fit.coefficients === null) {
    return ctlUncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = config.dedupOnProb
    ? dedupOnProbabilitiesFor(vectors, fit.coefficients, keys, keySpace)
    : ctlOnProbabilitiesFor(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      apcVariant(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
    );
  }
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  const random = ctlRngFn(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    const sample: CtlRow[] = [];
    const sampleVectors: number[][] = [];
    const sampleSupports: number[][] = [];
    const sampleKeys: number[] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
      sampleVectors.push(vectors[index]!);
      sampleSupports.push(supports[index]!);
      sampleKeys.push(keys[index]!);
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = dedupIrls(
      design,
      sample,
      sampleVectors,
      sampleSupports,
      maxIter,
      sampleKeys,
      keySpace,
      config.fuseDelta
    );
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = config.dedupOnProb
      ? dedupOnProbabilitiesFor(sampleVectors, bootFit.coefficients, sampleKeys, keySpace)
      : ctlOnProbabilitiesFor(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = apcVariant(
        design,
        sample,
        sampleVectors,
        bootFit.coefficients,
        sampleOnProbabilities,
        name
      );
      ctlPushValue(draws, name, value);
    }
  }

  for (const [name, point] of pointEffects.entries()) {
    const values = draws.get(name) ?? [];
    if (successful < MIN_SUCCESSFUL_DRAWS || values.length < MIN_SUCCESSFUL_DRAWS) {
      return ctlUncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
    }
    values.sort((a, b) => a - b);
    effects.push({
      name,
      point,
      lcb: ctlPercentile(values, 0.025),
      ucb: ctlPercentile(values, 0.975),
    });
  }

  const n = baseRows.length;
  const mean = baseRows.reduce((acc, r) => acc + r.y, 0) / n;
  const muPosterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const muLcb = betaQuantileLcb(muPosterior, 0.05);
  const models = new Set(baseRows.map((r) => r.modelVersion)).size;
  const projects = new Set(baseRows.map((r) => r.projectId)).size;
  const ZERO_EPS = 0.005 * ATTRIBUTION_EFFECT;
  const containsZero = (e: AttributionEffect): boolean =>
    e.lcb <= ZERO_EPS && e.ucb >= -ZERO_EPS;
  const interactionsFor = (prefix: string): AttributionEffect[] =>
    effects.filter((e) => e.name.startsWith(`w:${prefix}`));

  let diagnosis: AttributionLabel = "uncertain";
  const scenarioHard = muLcb < QUALITY_FLOOR && models >= 2 && projects >= 3;
  if (
    effects.some(
      (e) => e.name.startsWith("u:") && e.lcb < -ATTRIBUTION_EFFECT && interactionsFor(ctlModelOf(e.name)).every(containsZero)
    )
  ) {
    diagnosis = "model-problem";
  } else if (
    effects.some(
      (e) =>
        e.name.startsWith("v:") &&
        e.lcb < -ATTRIBUTION_EFFECT &&
        effects
          .filter((w) => w.name.startsWith("w:") && w.name.endsWith(`|${e.name.slice("v:".length)}`))
          .every(containsZero)
    )
  ) {
    diagnosis = "project-problem";
  } else if (effects.some((e) => e.name.startsWith("w:") && e.lcb < -ATTRIBUTION_EFFECT)) {
    diagnosis = "interaction-only";
  } else if (scenarioHard) {
    diagnosis = "scenario-hard";
  }

  return {
    estimator: "logit-additive",
    rowsUsed: baseRows.length,
    effects,
    diagnosis,
    reason: diagnosis === "uncertain" ? "no effect beyond threshold or intervals too wide" : `${diagnosis} beyond the ${ATTRIBUTION_EFFECT} effect threshold`,
    writesActivePointer: false,
  };
}

/** S2-C candidate: eta/mu dedup at the IRLS site (matches the landed production edit). */
function candidateFit(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  return variantFitLogitAdditive(rows, options, { dedupOnProb: false, apc: "copy", fuseDelta: false });
}

/** REJECTED: candidate + the same dedup at the once-per-fit on-probability site. */
function onProbFit(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  return variantFitLogitAdditive(rows, options, { dedupOnProb: true, apc: "copy", fuseDelta: false });
}

/** REJECTED: candidate + virtual-zero APC dot. */
function virtualApcFit(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  return variantFitLogitAdditive(rows, options, { dedupOnProb: false, apc: "virtual", fuseDelta: false });
}

/** REJECTED: candidate + fused convergence-delta loop. */
function deltaFuseFit(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  return variantFitLogitAdditive(rows, options, { dedupOnProb: false, apc: "copy", fuseDelta: true });
}

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

let checksPassed = 0;
let failures = 0;

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): void {
  process.stderr.write(`${line}\n`);
}

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    checksPassed += 1;
    return;
  }
  failures += 1;
  fail(`FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

function sameNumber(a: number, b: number): boolean {
  return Object.is(a, b);
}

function compareReports(label: string, expected: AttributionReport, actual: AttributionReport): void {
  check(`${label}.estimator`, expected.estimator === actual.estimator);
  check(`${label}.rowsUsed`, expected.rowsUsed === actual.rowsUsed);
  check(`${label}.diagnosis`, expected.diagnosis === actual.diagnosis, `${expected.diagnosis} vs ${actual.diagnosis}`);
  check(`${label}.reason`, expected.reason === actual.reason, `${expected.reason} vs ${actual.reason}`);
  check(`${label}.writesActivePointer`, expected.writesActivePointer === actual.writesActivePointer);
  check(
    `${label}.effects.length`,
    expected.effects.length === actual.effects.length,
    `${expected.effects.length} vs ${actual.effects.length}`
  );
  const count = Math.min(expected.effects.length, actual.effects.length);
  for (let i = 0; i < count; i++) {
    const e = expected.effects[i]!;
    const a = actual.effects[i]!;
    check(`${label}.effects[${i}].name`, e.name === a.name, `${e.name} vs ${a.name}`);
    check(`${label}.effects[${i}].point`, sameNumber(e.point, a.point), `${e.point} vs ${a.point}`);
    check(`${label}.effects[${i}].lcb`, sameNumber(e.lcb, a.lcb), `${e.lcb} vs ${a.lcb}`);
    check(`${label}.effects[${i}].ucb`, sameNumber(e.ucb, a.ucb), `${e.ucb} vs ${a.ucb}`);
  }
}

/** Deterministic fixture generator (mulberry32, distinct seed space from production). */
function fixtureRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randomRows(
  rng: () => number,
  options: {
    scenarios: number;
    models: number;
    projects: number;
    rows: number;
    passRate: number;
    pipeInModel?: boolean;
  }
): OfflineRow[] {
  const scenarios = Array.from({ length: options.scenarios }, (_, i) => `fam${i}|role${i % 2}`);
  const models = Array.from({ length: options.models }, (_, i) =>
    options.pipeInModel === true && i === 0 ? "weird|model-0" : `model-${i}`
  );
  const projects = Array.from({ length: options.projects }, (_, i) => `prj_${i}`);
  const rows: OfflineRow[] = [];
  for (let i = 0; i < options.rows; i++) {
    const modelVersion = pick(rng, models);
    const rate = modelVersion === models[0] ? options.passRate * 0.4 : options.passRate;
    rows.push({
      scenarioId: pick(rng, scenarios),
      modelVersion,
      projectId: pick(rng, projects),
      y: rng() < rate ? 1 : 0,
      occurredAtMs: 1_000 + i,
    });
  }
  return rows;
}

/** Every row a unique covariate triple: the dedup key space degenerates to n. */
function allUniqueRows(rng: () => number, count: number): OfflineRow[] {
  const rows: OfflineRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      scenarioId: `s${i % 2}`,
      modelVersion: `m${i}`,
      projectId: `p${i}`,
      y: rng() < 0.6 ? 1 : 0,
      occurredAtMs: 1_000 + i,
    });
  }
  return rows;
}

/* -------------------- scenario 1: bitwise equivalence -------------------- */

function scenarioEquivalence(): void {
  const rng = fixtureRng(0x2c01);
  const cases: Array<{ rows: OfflineRow[]; options?: { maxIter?: number; bootstrap?: number; seed?: number } }> = [];

  for (let i = 0; i < 40; i++) {
    cases.push({
      rows: randomRows(rng, {
        scenarios: 1 + Math.floor(rng() * 3),
        models: 1 + Math.floor(rng() * 4),
        projects: 1 + Math.floor(rng() * 4),
        rows: 10 + Math.floor(rng() * 90),
        passRate: 0.3 + rng() * 0.6,
      }),
      options: { bootstrap: 25 + Math.floor(rng() * 40), seed: 1 + Math.floor(rng() * 10_000) },
    });
  }
  // Degenerate outcome distributions and the empty design.
  cases.push({ rows: [] });
  cases.push({
    rows: randomRows(rng, { scenarios: 2, models: 2, projects: 2, rows: 20, passRate: 2 }),
  });
  cases.push({
    rows: randomRows(rng, { scenarios: 2, models: 2, projects: 2, rows: 20, passRate: -1 }),
  });
  // Too few bootstrap draws -> INVALID_ESTIMATE path.
  cases.push({
    rows: randomRows(rng, { scenarios: 1, models: 2, projects: 2, rows: 30, passRate: 0.6 }),
    options: { bootstrap: 5, seed: 42 },
  });
  // Tiny fits where resamples often collapse to one class.
  cases.push({
    rows: randomRows(rng, { scenarios: 1, models: 2, projects: 1, rows: 4, passRate: 0.5 }),
    options: { bootstrap: 30, seed: 7 },
  });
  // Truncated IRLS (non-converged path).
  cases.push({
    rows: randomRows(rng, { scenarios: 2, models: 3, projects: 2, rows: 40, passRate: 0.5 }),
    options: { maxIter: 3, bootstrap: 30, seed: 11 },
  });
  // "|" inside modelVersion (exercises pair-key construction AND the
  // nested-map canonical key against separator collisions).
  cases.push({
    rows: randomRows(rng, {
      scenarios: 2,
      models: 3,
      projects: 3,
      rows: 60,
      passRate: 0.55,
      pipeInModel: true,
    }),
    options: { bootstrap: 30, seed: 99 },
  });
  // Single-level factors (intercept + reference levels only).
  cases.push({
    rows: randomRows(rng, { scenarios: 1, models: 1, projects: 1, rows: 24, passRate: 0.5 }),
    options: { bootstrap: 40, seed: 3 },
  });
  // Default options on a mid-size fixture (exercises bootstrap=200 default).
  cases.push({
    rows: randomRows(rng, { scenarios: 2, models: 3, projects: 3, rows: 50, passRate: 0.6 }),
  });
  // Heavy duplication: one (model, project) cell, many rows -> few keys.
  cases.push({
    rows: randomRows(rng, { scenarios: 1, models: 2, projects: 2, rows: 80, passRate: 0.55 }),
    options: { bootstrap: 40, seed: 21 },
  });
  // No duplication at all: canonical key space degenerates to n.
  cases.push({
    rows: allUniqueRows(rng, 36),
    options: { bootstrap: 40, seed: 23 },
  });

  for (const [index, testCase] of cases.entries()) {
    const expected = ctlFitLogitAdditive(testCase.rows, testCase.options);
    compareReports(`S2-C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    compareReports(`S2-C[${index}]`, expected, candidateFit(testCase.rows, testCase.options));
    compareReports(`S2-C-onprob[${index}]`, expected, onProbFit(testCase.rows, testCase.options));
    compareReports(`S2-C-vapc[${index}]`, expected, virtualApcFit(testCase.rows, testCase.options));
    compareReports(`S2-C-dfuse[${index}]`, expected, deltaFuseFit(testCase.rows, testCase.options));
  }
  out(
    `scenario 1 (bitwise equivalence, ${cases.length} cases x {production, S2-C candidate, ` +
      `rejected on-prob dedup, rejected virtual-APC, rejected delta-fuse} vs frozen S1-C reference)`
  );
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function perfFixture(): void {
  const rng = fixtureRng(0xbeef);
  const rows = randomRows(rng, {
    scenarios: 4,
    models: 6,
    projects: 8,
    rows: 400,
    passRate: 0.6,
  });
  const options = { bootstrap: 200, seed: SEED_DEFAULT };

  // Correctness first: the perf fixture must also be bitwise identical.
  const expected = ctlFitLogitAdditive(rows, options);
  compareReports("perf-fixture.prod", expected, fitLogitAdditive(rows, options));
  compareReports("perf-fixture.S2-C", expected, candidateFit(rows, options));
  compareReports("perf-fixture.onprob", expected, onProbFit(rows, options));
  compareReports("perf-fixture.virtual-apc", expected, virtualApcFit(rows, options));
  compareReports("perf-fixture.delta-fuse", expected, deltaFuseFit(rows, options));

  // Per-fit-call operation counts (snapshotted around single fits, outside timing).
  counters.ctlEtaDots = 0;
  counters.ctlIterations = 0;
  ctlFitLogitAdditive(rows, options);
  const ctlDotsPerFit = counters.ctlEtaDots;
  const ctlItersPerFit = counters.ctlIterations;
  counters.varEtaDots = 0;
  counters.varIterations = 0;
  candidateFit(rows, options);
  const varDotsPerFit = counters.varEtaDots;
  const varItersPerFit = counters.varIterations;
  const distinctKeys = new Set(canonicalRowKeys(
    rows.map((r) => ({ scenarioId: r.scenarioId, modelVersion: r.modelVersion, projectId: r.projectId, y: r.y }))
  )).size;

  const runs = 5;
  const ctlTimes: number[] = [];
  const prodTimes: number[] = [];
  const candTimes: number[] = [];
  const onProbTimes: number[] = [];
  const vapcTimes: number[] = [];
  const dfuseTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    ctlFitLogitAdditive(rows, options);
    ctlTimes.push(performance.now() - t);
    t = performance.now();
    fitLogitAdditive(rows, options);
    prodTimes.push(performance.now() - t);
    t = performance.now();
    candidateFit(rows, options);
    candTimes.push(performance.now() - t);
    t = performance.now();
    onProbFit(rows, options);
    onProbTimes.push(performance.now() - t);
    t = performance.now();
    virtualApcFit(rows, options);
    vapcTimes.push(performance.now() - t);
    t = performance.now();
    deltaFuseFit(rows, options);
    dfuseTimes.push(performance.now() - t);
  }
  const ctlMs = median(ctlTimes);
  const candMs = median(candTimes);
  const prodMs = median(prodTimes);
  out(
    `perf fixture (rows=400, canonical keys=${distinctKeys}, bootstrap=200): ` +
      `S1-C reference ${ctlMs.toFixed(1)} ms -> S2-C candidate ${candMs.toFixed(1)} ms ` +
      `(${(ctlMs / candMs).toFixed(2)}x); production ${prodMs.toFixed(1)} ms (${(ctlMs / prodMs).toFixed(2)}x)`
  );
  out(
    `rejected add-on marginals on top of S2-C: on-prob dedup ${median(onProbTimes).toFixed(1)} ms; ` +
      `virtual-APC ${median(vapcTimes).toFixed(1)} ms; delta-fuse ${median(dfuseTimes).toFixed(1)} ms`
  );
  out(
    `IRLS eta dots per fit call: reference ${ctlDotsPerFit} (${ctlItersPerFit} iterations) -> ` +
      `S2-C ${varDotsPerFit} (${varItersPerFit} iterations)`
  );
}

scenarioEquivalence();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  process.exit(1);
}
out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
