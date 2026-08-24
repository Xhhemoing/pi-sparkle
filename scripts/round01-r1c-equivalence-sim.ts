/**
 * Round 1 / R1-C equivalence & performance simulation (offline routing slice).
 *
 * Compares the pre-round implementation of `fitLogitAdditive` (commit
 * bb39570) — embedded below, verbatim, as the frozen CONTROL — against the
 * current production code for the landed S1-C set:
 *
 *   (a) bootstrap resample reuse of per-row base-fit artifacts: a resampled
 *       row IS a base row, so its design vector and its IRLS support list
 *       are exactly the ones already computed for the base fit; reusing
 *       them by index removes the per-draw O(rows × p) rebuild + rescan.
 *   (b) APC off vectors derived by copying the on vector and zeroing the
 *       contrast column instead of rebuilding via design.build(row, skip).
 *   (c) IRLS per-iteration work buffers (eta / mu / X'WX / X'Wz) allocated
 *       once per fit and fully overwritten/zeroed at the top of every
 *       iteration instead of reallocated.
 *
 * It also adjudicates the REJECTED variant (kept here as evidence for the
 * exclusion table, never landed; built on top of the landed S1-C so the
 * bench isolates its marginal gain):
 *
 *   S1-C-1  APC off contrast via in-place zero-then-restore of the shared
 *           on vector (skips the copy, mutates aliased arrays temporarily)
 *
 * An intermediate variant with (a)+(b) but per-iteration IRLS allocations
 * is benched too, purely to attribute the landed gain between its parts.
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings. The script never touches production state; it only
 * imports pure functions. betaQuantileLcb / solveSymmetric did not change
 * this round and are imported from production, so the diff under test stays
 * exactly the S1-C edit.
 * Run with: npx tsx scripts/round01-r1c-equivalence-sim.ts
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
/* Frozen pre-round reference (control). Verbatim from bb39570.       */
/* ------------------------------------------------------------------ */

const counters = {
  refBuildCalls: 0,
};

const MAX_ITER_DEFAULT = 50;
const TOL = 1e-8;
const BOOTSTRAP_DEFAULT = 200;
const SEED_DEFAULT = 20260818;
const INTERACTION_MIN_N = 3;
const MIN_SUCCESSFUL_DRAWS = 20;
const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;

interface RefDesign {
  readonly names: readonly string[];
  readonly columnIndex: ReadonlyMap<string, number>;
  build(row: RefRow, skip?: string): number[];
  readonly referenceLevels: ReadonlyArray<{ factor: "a" | "u" | "v"; name: string }>;
}

interface RefRow {
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
}

function refSigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function refRngFn(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function refBuildDesign(rows: readonly RefRow[]): RefDesign {
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
    build(row: RefRow, skip?: string): number[] {
      counters.refBuildCalls += 1;
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

interface RefFitResult {
  readonly coefficients: readonly number[] | null;
}

function refIrls(
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  maxIter: number
): RefFitResult {
  const p = design.names.length;
  const supports = vectors.map((vector) => {
    const active: number[] = [];
    for (let j = 0; j < vector.length; j++) {
      if (vector[j] !== 0) active.push(j);
    }
    return active;
  });
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const eta = vectors.map((v) => refDot(beta, v));
    const mu = eta.map(refSigmoid);
    const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const xtwz: number[] = new Array<number>(p).fill(0);
    for (let i = 0; i < rows.length; i++) {
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

function refDot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function refOnProbabilitiesFor(
  vectors: readonly number[][],
  coefficients: readonly number[]
): number[] {
  return vectors.map((vector) => refSigmoid(refDot(coefficients, vector)));
}

function refAveragePredictiveComparison(
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
): number {
  let sum = 0;
  const columnIdx = design.columnIndex.get(column);
  if (columnIdx !== undefined) {
    for (let i = 0; i < rows.length; i++) {
      if (vectors[i]![columnIdx] === 0) continue;
      const on = onProbabilities[i]!;
      const offVector = design.build(rows[i]!, column);
      const off = refSigmoid(refDot(coefficients, offVector));
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
}

function refPercentile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = (sortedValues.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! * (hi - index) + sortedValues[hi]! * (index - lo);
}

function refFitLogitAdditive(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;

  const baseRows: RefRow[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y,
  }));
  const effects: AttributionEffect[] = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    return refUncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = refBuildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const fit = refIrls(design, baseRows, vectors, maxIter);
  if (fit.coefficients === null) {
    return refUncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = refOnProbabilitiesFor(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      refAveragePredictiveComparison(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
    );
  }
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  const random = refRngFn(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    const sample: RefRow[] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const sampleVectors = sample.map((r) => design.build(r));
    const bootFit = refIrls(design, sample, sampleVectors, maxIter);
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = refOnProbabilitiesFor(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = refAveragePredictiveComparison(
        design,
        sample,
        sampleVectors,
        bootFit.coefficients,
        sampleOnProbabilities,
        name
      );
      refPushValue(draws, name, value);
    }
  }

  for (const [name, point] of pointEffects.entries()) {
    const values = draws.get(name) ?? [];
    if (successful < MIN_SUCCESSFUL_DRAWS || values.length < MIN_SUCCESSFUL_DRAWS) {
      return refUncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
    }
    values.sort((a, b) => a - b);
    effects.push({
      name,
      point,
      lcb: refPercentile(values, 0.025),
      ucb: refPercentile(values, 0.975),
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
      (e) => e.name.startsWith("u:") && e.lcb < -ATTRIBUTION_EFFECT && interactionsFor(refModelOf(e.name)).every(containsZero)
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

function refModelOf(effectName: string): string {
  return effectName.slice("u:".length);
}

function refPushValue(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function refUncertainReport(rowsUsed: number, reason: string): AttributionReport {
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
/* Adjudication variants: the rejected S1-C-1 and the (a)+(b)-only    */
/* intermediate used to attribute the landed gain between its parts.  */
/* ------------------------------------------------------------------ */

function computeSupportsVariant(vectors: readonly number[][]): number[][] {
  return vectors.map((vector) => {
    const active: number[] = [];
    for (let j = 0; j < vector.length; j++) {
      if (vector[j] !== 0) active.push(j);
    }
    return active;
  });
}

/** Landed part (c) (matches production): per-fit IRLS buffers zeroed in place. */
function bufferedIrls(
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  maxIter: number
): RefFitResult {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      eta[i] = refDot(beta, vectors[i]!);
      mu[i] = refSigmoid(eta[i]!);
    }
    for (let d = 0; d < p; d++) {
      xtwx[d]!.fill(0);
    }
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

/** Intermediate (a)+(b) IRLS: supports passed in, per-iteration allocations kept. */
function reuseIrls(
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  maxIter: number
): RefFitResult {
  const p = design.names.length;
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const eta = vectors.map((v) => refDot(beta, v));
    const mu = eta.map(refSigmoid);
    const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const xtwz: number[] = new Array<number>(p).fill(0);
    for (let i = 0; i < rows.length; i++) {
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

/** Landed S1-C APC (matches production): off vector copied from the on vector. */
function copyDeriveApc(
  design: RefDesign,
  rows: readonly RefRow[],
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
      const off = refSigmoid(refDot(coefficients, offVector));
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
}

/** S1-C-1 (rejected): off contrast via in-place zero-then-restore of the shared on vector. */
function mutateRestoreApc(
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
): number {
  let sum = 0;
  const columnIdx = design.columnIndex.get(column);
  if (columnIdx !== undefined && columnIdx !== 0) {
    for (let i = 0; i < rows.length; i++) {
      const vector = vectors[i]!;
      if (vector[columnIdx] === 0) continue;
      const on = onProbabilities[i]!;
      vector[columnIdx] = 0;
      const off = refSigmoid(refDot(coefficients, vector));
      vector[columnIdx] = 1;
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
}

type IrlsVariant = (
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  maxIter: number
) => RefFitResult;

type ApcVariant = (
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  onProbabilities: readonly number[],
  column: string
) => number;

/** Shared S1-C-style fit driver, parameterized by the add-on under test. */
function variantFitLogitAdditive(
  rows: readonly OfflineRow[],
  options: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number } | undefined,
  irlsVariant: IrlsVariant,
  apcVariant: ApcVariant
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;

  const baseRows: RefRow[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y,
  }));
  const effects: AttributionEffect[] = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    return refUncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = refBuildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupportsVariant(vectors);
  const fit = irlsVariant(design, baseRows, vectors, supports, maxIter);
  if (fit.coefficients === null) {
    return refUncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = refOnProbabilitiesFor(vectors, fit.coefficients);
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

  const random = refRngFn(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    const sample: RefRow[] = [];
    const sampleVectors: number[][] = [];
    const sampleSupports: number[][] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
      sampleVectors.push(vectors[index]!);
      sampleSupports.push(supports[index]!);
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = irlsVariant(design, sample, sampleVectors, sampleSupports, maxIter);
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = refOnProbabilitiesFor(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = apcVariant(
        design,
        sample,
        sampleVectors,
        bootFit.coefficients,
        sampleOnProbabilities,
        name
      );
      refPushValue(draws, name, value);
    }
  }

  for (const [name, point] of pointEffects.entries()) {
    const values = draws.get(name) ?? [];
    if (successful < MIN_SUCCESSFUL_DRAWS || values.length < MIN_SUCCESSFUL_DRAWS) {
      return refUncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
    }
    values.sort((a, b) => a - b);
    effects.push({
      name,
      point,
      lcb: refPercentile(values, 0.025),
      ucb: refPercentile(values, 0.975),
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
      (e) => e.name.startsWith("u:") && e.lcb < -ATTRIBUTION_EFFECT && interactionsFor(refModelOf(e.name)).every(containsZero)
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

function intermediateFit(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  return variantFitLogitAdditive(rows, options, reuseIrls, copyDeriveApc);
}

function mutateRestoreFit(
  rows: readonly OfflineRow[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  return variantFitLogitAdditive(rows, options, bufferedIrls, mutateRestoreApc);
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

/* -------------------- scenario 1: bitwise equivalence -------------------- */

function scenarioEquivalence(): void {
  const rng = fixtureRng(0x1c01);
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
  // "|" inside modelVersion (exercises pair-key construction).
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

  for (const [index, testCase] of cases.entries()) {
    const expected = refFitLogitAdditive(testCase.rows, testCase.options);
    compareReports(`S1-C[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    compareReports(`S1-C-ab[${index}]`, expected, intermediateFit(testCase.rows, testCase.options));
    compareReports(`S1-C-1[${index}]`, expected, mutateRestoreFit(testCase.rows, testCase.options));
  }
  out(`scenario 1 (bitwise equivalence, ${cases.length} cases x {production S1-C, intermediate a+b, rejected S1-C-1} vs frozen reference)`);
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
  const expected = refFitLogitAdditive(rows, options);
  compareReports("perf-fixture.S1-C", expected, fitLogitAdditive(rows, options));
  compareReports("perf-fixture.S1-C-ab", expected, intermediateFit(rows, options));
  compareReports("perf-fixture.S1-C-1", expected, mutateRestoreFit(rows, options));

  counters.refBuildCalls = 0;
  refFitLogitAdditive(rows, options);
  const buildsPerRefFit = counters.refBuildCalls;

  const runs = 5;
  const refTimes: number[] = [];
  const prodTimes: number[] = [];
  const abTimes: number[] = [];
  const mutTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    refFitLogitAdditive(rows, options);
    refTimes.push(performance.now() - t);
    t = performance.now();
    fitLogitAdditive(rows, options);
    prodTimes.push(performance.now() - t);
    t = performance.now();
    intermediateFit(rows, options);
    abTimes.push(performance.now() - t);
    t = performance.now();
    mutateRestoreFit(rows, options);
    mutTimes.push(performance.now() - t);
  }
  const refMs = median(refTimes);
  const prodMs = median(prodTimes);
  const p = refBuildDesign(rows.map((r) => ({ ...r }))).names.length;
  out(
    `perf fixture (rows=400, p≈${p}, bootstrap=200): reference ${refMs.toFixed(1)} ms -> ` +
      `production S1-C ${prodMs.toFixed(1)} ms (${(refMs / prodMs).toFixed(2)}x)`
  );
  out(
    `attribution: intermediate (a)+(b) ${median(abTimes).toFixed(1)} ms; ` +
      `rejected S1-C-1 mutate-restore APC on top of S1-C ${median(mutTimes).toFixed(1)} ms`
  );
  out(`reference design.build calls per fit on this fixture: ${buildsPerRefFit}`);
}

scenarioEquivalence();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  process.exit(1);
}
out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
