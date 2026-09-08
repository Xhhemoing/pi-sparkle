/**
 * Round 3 / R3-C equivalence & performance simulation (offline routing slice).
 *
 * Compares the post-Round-2 production implementation of `fitLogitAdditive`
 * (the landed S2-C form, embedded below verbatim as the frozen CONTROL)
 * against the current production code and the R3-C candidate family, all in
 * the IRLS accumulation hot loop:
 *
 *   VAR-A  0/1-design unit-multiplication elimination: every design-vector
 *          entry on a row's support list is exactly 1 (design.build only
 *          ever writes 1s and computeSupports selects the non-zeros), and
 *          IEEE-754 multiplication by 1.0 is an identity (x * 1.0 === x
 *          bitwise for every finite double). Therefore
 *            w * xi[a] * xi[b] === w        (addend into X'WX)
 *            w * xi[a] * z     === w * z    (addend into X'Wz)
 *          bitwise, and w * z hoisted once per row is the same pure-function
 *          double for every support column. The addend VALUES, the term
 *          sets, and the accumulation order are all unchanged — this only
 *          removes redundant multiplications and vector reads (X2-1, which
 *          changes term sets, is untouched; the loop already visits only the
 *          support since F1).
 *
 *   VAR-B  A + symmetric upper-triangle accumulation with a mirror pass:
 *          for a fixed cell (a,b), the control adds the same w_i sequence in
 *          the same row order to [a][b] and to [b][a], so both cells are
 *          bitwise equal after accumulation; accumulating only ai <= bi and
 *          copying [a][b] into [b][a] before the ridge reproduces the full
 *          matrix bit for bit (same copy-derive spirit as landed S1-C (b)).
 *
 *   VAR-C  B + fused single row pass with per-key w and per-(key,y) z
 *          dedup: w = max(mu(1-mu), 1e-10) is a pure function of the
 *          canonical key's mu; z = eta + ((y - mu)/w) takes exactly two
 *          values per key (y in {0,1} by the OfflineRow contract). The
 *          eta/mu per-row copy arrays disappear entirely.
 *
 *   VAR-D  winner + bootstrap sample-buffer reuse across draws (the four
 *          per-draw arrays become preallocated buffers overwritten index by
 *          index; the PRNG call sequence and all consumed values are
 *          unchanged, and no draw's reader outlives the draw).
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings. The script never touches production state; it only
 * imports pure functions. betaQuantileLcb / solveSymmetric did not change
 * this round and are imported from production, so the diff under test stays
 * exactly the R3-C candidate edits.
 * Run with: npx tsx scripts/round03-r3c-equivalence-sim.ts
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
/* Frozen post-Round-2 reference (control). Verbatim S2-C production. */
/* ------------------------------------------------------------------ */

const counters = {
  ctlIterations: 0,
  ctlPairMults: 0,
  varIterations: 0,
  varPairMults: 0,
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

function ctlCanonicalRowKeys(rows: readonly CtlRow[]): number[] {
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

function sumSquaredSupportSizes(supports: readonly (readonly number[])[]): number {
  let total = 0;
  for (const active of supports) total += active.length * active.length + active.length;
  return total;
}

function ctlIrls(
  design: CtlDesign,
  rows: readonly CtlRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  keys: readonly number[],
  keySpace: number,
  maxIter: number
): CtlFitResult {
  const p = design.names.length;
  const n = rows.length;
  const perIterationMults = 2 * sumSquaredSupportSizes(supports); // 2 mults per addend
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    counters.ctlIterations += 1;
    counters.ctlPairMults += perIterationMults;
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = ctlDot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = ctlSigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
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
  const keys = ctlCanonicalRowKeys(baseRows);
  const fit = ctlIrls(design, baseRows, vectors, supports, keys, baseRows.length, maxIter);
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
    const sampleKeys: number[] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
      sampleVectors.push(vectors[index]!);
      sampleSupports.push(supports[index]!);
      sampleKeys.push(keys[index]!);
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = ctlIrls(design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter);
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
/* R3-C candidate IRLS variants                                       */
/* ------------------------------------------------------------------ */

type IrlsImpl = (
  design: CtlDesign,
  rows: readonly CtlRow[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  keys: readonly number[],
  keySpace: number,
  maxIter: number
) => CtlFitResult;

/**
 * VAR-A: unit-multiplication elimination only. Two-pass structure, per-row
 * w/z exactly as the control computes them; the accumulation loop adds w
 * and the per-row hoisted wz instead of recomputing w*1*1 and (w*1)*z.
 */
const irlsA: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    counters.varIterations += 1;
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = ctlDot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = ctlSigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      const active = supports[i]!;
      for (let ai = 0; ai < active.length; ai++) {
        const a = active[ai]!;
        xtwz[a] = xtwz[a]! + wz;
        const rowA = xtwx[a]!;
        for (let bi = 0; bi < active.length; bi++) {
          const b = active[bi]!;
          rowA[b] = rowA[b]! + w;
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
};

/** VAR-B: A + upper-triangle accumulation with a mirror pass before the ridge. */
const irlsB: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    counters.varIterations += 1;
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = ctlDot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = ctlSigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      const active = supports[i]!;
      for (let ai = 0; ai < active.length; ai++) {
        const a = active[ai]!;
        xtwz[a] = xtwz[a]! + wz;
        const rowA = xtwx[a]!;
        for (let bi = ai; bi < active.length; bi++) {
          const b = active[bi]!;
          rowA[b] = rowA[b]! + w;
        }
      }
    }
    for (let a = 0; a < p; a++) {
      const rowA = xtwx[a]!;
      for (let b = a + 1; b < p; b++) xtwx[b]![a] = rowA[b]!;
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
};

/**
 * VAR-C: B + fused single row pass, per-key w, per-(key,y) z dedup. The
 * eta/mu per-row arrays disappear; dot/sigmoid still run at first key
 * occurrence in row order, so the float-op sequence per key is unchanged.
 */
const irlsC: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
  const p = design.names.length;
  const n = rows.length;
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  const wByKey = new Float64Array(keySpace);
  const zPassStamp = new Int32Array(keySpace);
  const zFailStamp = new Int32Array(keySpace);
  const zPassByKey = new Float64Array(keySpace);
  const zFailByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    counters.varIterations += 1;
    const mark = iter + 1;
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = ctlDot(beta, vectors[i]!);
        const m = ctlSigmoid(value);
        etaByKey[key] = value;
        muByKey[key] = m;
        wByKey[key] = Math.max(m * (1 - m), 1e-10);
      }
      const w = wByKey[key]!;
      let z: number;
      if (rows[i]!.y === 1) {
        if (zPassStamp[key] !== mark) {
          zPassStamp[key] = mark;
          zPassByKey[key] = etaByKey[key]! + ((1 - muByKey[key]!) / w);
        }
        z = zPassByKey[key]!;
      } else {
        if (zFailStamp[key] !== mark) {
          zFailStamp[key] = mark;
          zFailByKey[key] = etaByKey[key]! + ((0 - muByKey[key]!) / w);
        }
        z = zFailByKey[key]!;
      }
      const wz = w * z;
      const active = supports[i]!;
      for (let ai = 0; ai < active.length; ai++) {
        const a = active[ai]!;
        xtwz[a] = xtwz[a]! + wz;
        const rowA = xtwx[a]!;
        for (let bi = ai; bi < active.length; bi++) {
          const b = active[bi]!;
          rowA[b] = rowA[b]! + w;
        }
      }
    }
    for (let a = 0; a < p; a++) {
      const rowA = xtwx[a]!;
      for (let b = a + 1; b < p; b++) xtwx[b]![a] = rowA[b]!;
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
};

/* ------------------------------------------------------------------ */
/* Variant fit driver                                                 */
/* ------------------------------------------------------------------ */

interface VariantConfig {
  readonly irls: IrlsImpl;
  readonly reuseSampleBuffers: boolean;
}

function variantFitLogitAdditive(
  rows: readonly OfflineRow[],
  options: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number } | undefined,
  config: VariantConfig
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;
  const irlsImpl = config.irls;

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
  const keys = ctlCanonicalRowKeys(baseRows);
  const keySpace = baseRows.length;
  const fit = irlsImpl(design, baseRows, vectors, supports, keys, keySpace, maxIter);
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
  const reuse = config.reuseSampleBuffers;
  const sampleBuf: CtlRow[] = reuse ? new Array<CtlRow>(baseRows.length) : [];
  const sampleVectorsBuf: number[][] = reuse ? new Array<number[]>(baseRows.length) : [];
  const sampleSupportsBuf: number[][] = reuse ? new Array<number[]>(baseRows.length) : [];
  const sampleKeysBuf: number[] = reuse ? new Array<number>(baseRows.length) : [];
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    let sample: CtlRow[];
    let sampleVectors: number[][];
    let sampleSupports: number[][];
    let sampleKeys: number[];
    if (reuse) {
      for (let i = 0; i < baseRows.length; i++) {
        const index = Math.floor(random() * baseRows.length);
        sampleBuf[i] = baseRows[index]!;
        sampleVectorsBuf[i] = vectors[index]!;
        sampleSupportsBuf[i] = supports[index]!;
        sampleKeysBuf[i] = keys[index]!;
      }
      sample = sampleBuf;
      sampleVectors = sampleVectorsBuf;
      sampleSupports = sampleSupportsBuf;
      sampleKeys = sampleKeysBuf;
    } else {
      sample = [];
      sampleVectors = [];
      sampleSupports = [];
      sampleKeys = [];
      for (let i = 0; i < baseRows.length; i++) {
        const index = Math.floor(random() * baseRows.length);
        sample.push(baseRows[index]!);
        sampleVectors.push(vectors[index]!);
        sampleSupports.push(supports[index]!);
        sampleKeys.push(keys[index]!);
      }
    }
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = irlsImpl(design, sample, sampleVectors, sampleSupports, sampleKeys, keySpace, maxIter);
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

const fitVarA = (rows: readonly OfflineRow[], options?: { maxIter?: number; bootstrap?: number; seed?: number }): AttributionReport =>
  variantFitLogitAdditive(rows, options, { irls: irlsA, reuseSampleBuffers: false });
const fitVarB = (rows: readonly OfflineRow[], options?: { maxIter?: number; bootstrap?: number; seed?: number }): AttributionReport =>
  variantFitLogitAdditive(rows, options, { irls: irlsB, reuseSampleBuffers: false });
const fitVarC = (rows: readonly OfflineRow[], options?: { maxIter?: number; bootstrap?: number; seed?: number }): AttributionReport =>
  variantFitLogitAdditive(rows, options, { irls: irlsC, reuseSampleBuffers: false });
const fitVarD = (rows: readonly OfflineRow[], options?: { maxIter?: number; bootstrap?: number; seed?: number }): AttributionReport =>
  variantFitLogitAdditive(rows, options, { irls: irlsA, reuseSampleBuffers: true });

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
  const rng = fixtureRng(0x3c01);
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
  // "|" inside modelVersion (pair-key construction AND nested-map keys).
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
  // Single-level factors (intercept + reference levels only) — the support
  // degenerates to {intercept}, exercising the s=1 corner of the triangle loop.
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
  // No duplication at all: canonical key space degenerates to n; the
  // per-(key,y) z scratch of VAR-C sees exactly one y per key.
  cases.push({
    rows: allUniqueRows(rng, 36),
    options: { bootstrap: 40, seed: 23 },
  });
  // Single-key fixture: every row the same covariate triple, mixed outcomes —
  // both z scratch slots of one key are live on every iteration.
  {
    const oneKey: OfflineRow[] = [];
    for (let i = 0; i < 30; i++) {
      oneKey.push({
        scenarioId: "s0",
        modelVersion: "m0",
        projectId: "p0",
        y: i % 3 === 0 ? 0 : 1,
        occurredAtMs: 1_000 + i,
      });
    }
    cases.push({ rows: oneKey, options: { bootstrap: 40, seed: 31 } });
  }

  for (const [index, testCase] of cases.entries()) {
    const expected = ctlFitLogitAdditive(testCase.rows, testCase.options);
    compareReports(`R3C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    compareReports(`R3C-A[${index}]`, expected, fitVarA(testCase.rows, testCase.options));
    compareReports(`R3C-B[${index}]`, expected, fitVarB(testCase.rows, testCase.options));
    compareReports(`R3C-C[${index}]`, expected, fitVarC(testCase.rows, testCase.options));
    compareReports(`R3C-D[${index}]`, expected, fitVarD(testCase.rows, testCase.options));
  }
  out(
    `scenario 1 (bitwise equivalence, ${cases.length} cases x {production, VAR-A unit-mult, ` +
      `VAR-B +triangle-mirror, VAR-C +fused-key-scratch, VAR-D +sample-buffer-reuse} vs frozen S2-C reference)`
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
  compareReports("perf-fixture.A", expected, fitVarA(rows, options));
  compareReports("perf-fixture.B", expected, fitVarB(rows, options));
  compareReports("perf-fixture.C", expected, fitVarC(rows, options));
  compareReports("perf-fixture.D", expected, fitVarD(rows, options));

  // Per-fit accumulation-loop shape (outside timing).
  const baseRows: CtlRow[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y,
  }));
  const design = ctlBuildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = ctlComputeSupports(vectors);
  const distinctKeys = new Set(ctlCanonicalRowKeys(baseRows)).size;
  let sumS = 0;
  let sumS2 = 0;
  for (const s of supports) {
    sumS += s.length;
    sumS2 += s.length * s.length;
  }
  counters.ctlIterations = 0;
  counters.ctlPairMults = 0;
  ctlFitLogitAdditive(rows, options);
  const itersPerFit = counters.ctlIterations;
  const multsPerFit = counters.ctlPairMults;
  out(
    `perf fixture shape: rows=400, p=${design.names.length}, canonical keys=${distinctKeys}, ` +
      `mean support=${(sumS / supports.length).toFixed(2)}, sum s^2=${sumS2}, ` +
      `IRLS iterations/fit=${itersPerFit}, accumulation multiplications/fit=${multsPerFit} -> 0 in VAR-A/B/C/D`
  );

  const runs = 7;
  const ctlTimes: number[] = [];
  const prodTimes: number[] = [];
  const aTimes: number[] = [];
  const bTimes: number[] = [];
  const cTimes: number[] = [];
  const dTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    ctlFitLogitAdditive(rows, options);
    ctlTimes.push(performance.now() - t);
    t = performance.now();
    fitLogitAdditive(rows, options);
    prodTimes.push(performance.now() - t);
    t = performance.now();
    fitVarA(rows, options);
    aTimes.push(performance.now() - t);
    t = performance.now();
    fitVarB(rows, options);
    bTimes.push(performance.now() - t);
    t = performance.now();
    fitVarC(rows, options);
    cTimes.push(performance.now() - t);
    t = performance.now();
    fitVarD(rows, options);
    dTimes.push(performance.now() - t);
  }
  const ctlMs = median(ctlTimes);
  const prodMs = median(prodTimes);
  const aMs = median(aTimes);
  const bMs = median(bTimes);
  const cMs = median(cTimes);
  const dMs = median(dTimes);
  out(
    `perf fixture (rows=400, bootstrap=200): S2-C reference ${ctlMs.toFixed(1)} ms; ` +
      `production ${prodMs.toFixed(1)} ms (${(ctlMs / prodMs).toFixed(2)}x)`
  );
  out(
    `candidates: VAR-A ${aMs.toFixed(1)} ms (${(ctlMs / aMs).toFixed(2)}x); ` +
      `VAR-B ${bMs.toFixed(1)} ms (${(ctlMs / bMs).toFixed(2)}x); ` +
      `VAR-C ${cMs.toFixed(1)} ms (${(ctlMs / cMs).toFixed(2)}x); ` +
      `VAR-D ${dMs.toFixed(1)} ms (${(ctlMs / dMs).toFixed(2)}x)`
  );
}

scenarioEquivalence();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  process.exit(1);
}
out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
