import { type AttributionEffect, type AttributionLabel, type AttributionReport } from "./offline-types.js";
import { betaQuantileLcb } from "./posterior.js";
import { solveSymmetric } from "./lin-alg.js";

/**
 * Offline logit-standardized-v2 attribution via IRLS. Canonical treatment
 * references identify the fitted coefficients; reported effects center full
 * grid predictions, including every reference level, on the probability scale.
 * Rank-deficient designs fail closed before ridge stabilization. Seeded
 * bootstrap refits share the original prediction grid and scenario weights.
 * Never touches the active pointer.
 */

const MAX_ITER_DEFAULT = 50;
const TOL = 1e-8;
const BOOTSTRAP_DEFAULT = 200;
const SEED_DEFAULT = 20260818;
const INTERACTION_MIN_N = 3;
const MIN_SUCCESSFUL_DRAWS = 20;
const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;
const PROTOCOL = "logit-standardized-v2";

type EffectTerm =
  | { readonly factor: "a"; readonly name: string; readonly scenario: number }
  | { readonly factor: "u"; readonly name: string; readonly model: number }
  | { readonly factor: "v"; readonly name: string; readonly project: number }
  | { readonly factor: "w"; readonly name: string; readonly model: number; readonly project: number };

interface Design {
  /** Fitted column names, in canonical factor and tuple order. */
  readonly names: readonly string[];
  readonly scenarios: readonly string[];
  readonly models: readonly string[];
  readonly projects: readonly string[];
  readonly scenarioWeights: readonly number[];
  readonly effects: readonly EffectTerm[];
  build(row: Row): number[];
  /** Stream a grid prediction without allocating a dense design vector. */
  predict(scenario: string, model: string, project: string, coefficients: readonly number[]): number;
}

interface Row {
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDesign(rows: readonly Row[]): Design {
  const scenarios = [...new Set(rows.map((r) => r.scenarioId))].sort(compareText);
  const models = [...new Set(rows.map((r) => r.modelVersion))].sort(compareText);
  const projects = [...new Set(rows.map((r) => r.projectId))].sort(compareText);
  const names = ["intercept"];
  const factorColumns = (levels: readonly string[], prefix: string): ReadonlyMap<string, number> => {
    const columns = new Map<string, number>();
    // The exact code-unit last level is the treatment reference.
    for (const level of levels.slice(0, -1)) {
      columns.set(level, names.length);
      names.push(`${prefix}:${level}`);
    }
    return columns;
  };
  const scenarioColumns = factorColumns(scenarios, "a");
  const modelColumns = factorColumns(models, "u");
  const projectColumns = factorColumns(projects, "v");
  const pairCounts = new Map<string, Map<string, number>>();
  const scenarioCounts = new Map<string, number>();
  for (const row of rows) {
    let counts = pairCounts.get(row.modelVersion);
    if (counts === undefined) {
      counts = new Map();
      pairCounts.set(row.modelVersion, counts);
    }
    counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
    scenarioCounts.set(row.scenarioId, (scenarioCounts.get(row.scenarioId) ?? 0) + 1);
  }
  const interactionColumns = new Map<string, Map<string, number>>();
  for (const model of modelColumns.keys()) {
    const columns = new Map<string, number>();
    for (const project of projectColumns.keys()) {
      if ((pairCounts.get(model)?.get(project) ?? 0) < INTERACTION_MIN_N) continue;
      columns.set(project, names.length);
      names.push(`w:${JSON.stringify([model, project])}`);
    }
    interactionColumns.set(model, columns);
  }
  const effects: EffectTerm[] = [
    ...scenarios.map((name, scenario) => ({ factor: "a" as const, name: `a:${name}`, scenario })),
    ...models.map((name, model) => ({ factor: "u" as const, name: `u:${name}`, model })),
    ...projects.map((name, project) => ({ factor: "v" as const, name: `v:${name}`, project }))
  ];
  for (let model = 0; model < models.length; model++) {
    for (let project = 0; project < projects.length; project++) {
      effects.push({ factor: "w", name: `w:${JSON.stringify([models[model], projects[project]])}`, model, project });
    }
  }
  return {
    names,
    scenarios,
    models,
    projects,
    scenarioWeights: scenarios.map((scenario) => scenarioCounts.get(scenario)! / rows.length),
    effects,
    build(row: Row): number[] {
      const vec = new Array<number>(names.length).fill(0);
      vec[0] = 1;
      for (const column of [
        scenarioColumns.get(row.scenarioId),
        modelColumns.get(row.modelVersion),
        projectColumns.get(row.projectId),
        interactionColumns.get(row.modelVersion)?.get(row.projectId)
      ]) {
        if (column !== undefined) vec[column] = 1;
      }
      return vec;
    },
    predict(scenario, model, project, coefficients): number {
      let value = coefficients[0]!;
      const a = scenarioColumns.get(scenario);
      const u = modelColumns.get(model);
      const v = projectColumns.get(project);
      const w = interactionColumns.get(model)?.get(project);
      if (a !== undefined) value += coefficients[a]!;
      if (u !== undefined) value += coefficients[u]!;
      if (v !== undefined) value += coefficients[v]!;
      if (w !== undefined) value += coefficients[w]!;
      return sigmoid(value);
    }
  };
}

/**
 * Rank of the unregularized 0/1 rows, independent of duplicate counts.
 * Work directly in row space rather than squaring conditioning in X'X.
 * Reorthogonalize twice and reject residuals at scaled roundoff precision;
 * ridge may stabilize identified coefficients, never supply missing rank.
 */
function hasFullColumnRank(supports: readonly (readonly number[])[], columns: number): boolean {
  // Supports contain sorted integer column indices, so this exact encoding
  // cannot confuse identifiers containing punctuation or distinct rows.
  const unique = new Map<string, readonly number[]>();
  for (const active of supports) unique.set(active.join(","), active);
  if (unique.size < columns) return false;
  const basis: number[][] = [];
  const tolerance = 64 * Number.EPSILON * Math.max(unique.size, columns);
  for (const active of unique.values()) {
    const residual = new Array<number>(columns).fill(0);
    for (const column of active) residual[column] = 1;
    for (let pass = 0; pass < 2; pass++) {
      for (const direction of basis) {
        let projection = 0;
        for (let column = 0; column < columns; column++) projection += residual[column]! * direction[column]!;
        for (let column = 0; column < columns; column++) residual[column] = residual[column]! - projection * direction[column]!;
      }
    }
    let squaredNorm = 0;
    for (const value of residual) squaredNorm += value * value;
    const norm = Math.sqrt(squaredNorm);
    if (!Number.isFinite(norm)) return false;
    if (norm <= tolerance * Math.sqrt(active.length)) continue;
    for (let column = 0; column < columns; column++) residual[column] = residual[column]! / norm;
    basis.push(residual);
    if (basis.length === columns) return true;
  }
  return false;
}
interface FitResult {
  readonly coefficients: readonly number[] | null;
}

/**
 * Non-zero column indices per row. The IRLS accumulation already skipped zero
 * entries, so visiting only the support performs the identical float
 * operations in the identical order on every iteration. Supports depend only
 * on the vectors, so the base fit computes them once and bootstrap refits
 * reuse them by row index.
 */
function computeSupports(vectors: readonly number[][]): number[][] {
  return vectors.map((vector) => {
    const active: number[] = [];
    for (let j = 0; j < vector.length; j++) {
      if (vector[j] !== 0) active.push(j);
    }
    return active;
  });
}

/**
 * Canonical key per row: index of the first base row sharing the same
 * (scenarioId, modelVersion, projectId) triple. The design vector is a pure
 * function of that triple, so rows with equal keys hold identical vectors.
 * Nested maps keep the key exact — no separator string that a "|" inside
 * modelVersion could collide with. Computed once per base fit; bootstrap
 * resamples reuse keys by index, exactly like vectors and supports.
 */
function canonicalRowKeys(rows: readonly Row[]): number[] {
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

function irls(
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  keys: readonly number[],
  keySpace: number,
  maxIter: number
): FitResult {
  const p = design.names.length;
  const n = rows.length;
  // Per-iteration work buffers, allocated once per fit: eta/mu are fully
  // overwritten and X'WX / X'Wz fully zeroed at the top of every iteration,
  // so each iteration starts from the exact state a fresh allocation gives.
  // solveSymmetric copies its inputs, so no buffer reference escapes.
  const eta = new Array<number>(n).fill(0);
  const mu = new Array<number>(n).fill(0);
  const xtwx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xtwz: number[] = new Array<number>(p).fill(0);
  // eta (support-only sum below; supports derive from vector contents
  // alone) and mu = sigmoid(eta) are pure functions of (beta, vector
  // contents), and rows sharing a canonical key hold identical vectors, so
  // computing each double once per key per iteration and copying it is
  // bitwise identical to recomputing it per row. The stamp scratch never
  // escapes this call and is reset by the per-iteration mark.
  const stamp = new Int32Array(keySpace);
  const etaByKey = new Float64Array(keySpace);
  const muByKey = new Float64Array(keySpace);
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        // Support-only eta is bitwise-safe only under three premises: 0/1 design entries, a +0.0 accumulator start, and finite beta — with a non-0/1 design this must revert to full dot(beta, vectors[i]).
        let value = 0;
        const active = supports[i]!;
        for (let ai = 0; ai < active.length; ai++) value += beta[active[ai]!]!;
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
      }
      eta[i] = etaByKey[key]!;
      mu[i] = muByKey[key]!;
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    // W = mu(1-mu); X' W X and X' W z with working response z = eta + (y - mu)/W.
    // Every design-vector entry on a support list is exactly 1 (build() only
    // writes 1s and computeSupports selects the non-zeros), and IEEE-754
    // multiplication by 1.0 is an identity, so the addends w * xi[a] * xi[b]
    // and w * xi[a] * z equal w and w * z bit for bit. Adding those values
    // directly — with w * z hoisted once per row — keeps every term, every
    // value, and the accumulation order unchanged; it only drops the
    // redundant multiplications and vector reads.
    //
    // A support holds at most five columns by construction — the intercept
    // plus at most one scenario, model, project, and interaction dummy — so
    // the accumulation loops run at trip counts the JIT cannot amortize:
    // each element pays one increment/compare/branch plus one integer read
    // of `active`. Dispatching on the support size to straight-line bodies
    // performs the identical additions on the identical targets in the
    // identical order (ai ascending, then bi ascending within it); only the
    // per-element loop control and the repeated `active` index reads are
    // dropped. `active` is never written during a fit and never aliases
    // `xtwx` rows or `xtwz` (both freshly allocated above), so hoisting its
    // entries into locals is unobservable. Sizes outside 2..5 (the
    // intercept-only support) take the verbatim rolled loop in the default.
    for (let i = 0; i < n; i++) {
      const w = Math.max(mu[i]! * (1 - mu[i]!)!, 1e-10);
      const z = eta[i]! + ((rows[i]!.y - mu[i]!) / w);
      const wz = w * z;
      const active = supports[i]!;
      switch (active.length) {
        case 5: {
          const a0 = active[0]!;
          const a1 = active[1]!;
          const a2 = active[2]!;
          const a3 = active[3]!;
          const a4 = active[4]!;
          xtwz[a0] = xtwz[a0]! + wz;
          const r0 = xtwx[a0]!;
          r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w; r0[a2] = r0[a2]! + w; r0[a3] = r0[a3]! + w; r0[a4] = r0[a4]! + w;
          xtwz[a1] = xtwz[a1]! + wz;
          const r1 = xtwx[a1]!;
          r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w; r1[a2] = r1[a2]! + w; r1[a3] = r1[a3]! + w; r1[a4] = r1[a4]! + w;
          xtwz[a2] = xtwz[a2]! + wz;
          const r2 = xtwx[a2]!;
          r2[a0] = r2[a0]! + w; r2[a1] = r2[a1]! + w; r2[a2] = r2[a2]! + w; r2[a3] = r2[a3]! + w; r2[a4] = r2[a4]! + w;
          xtwz[a3] = xtwz[a3]! + wz;
          const r3 = xtwx[a3]!;
          r3[a0] = r3[a0]! + w; r3[a1] = r3[a1]! + w; r3[a2] = r3[a2]! + w; r3[a3] = r3[a3]! + w; r3[a4] = r3[a4]! + w;
          xtwz[a4] = xtwz[a4]! + wz;
          const r4 = xtwx[a4]!;
          r4[a0] = r4[a0]! + w; r4[a1] = r4[a1]! + w; r4[a2] = r4[a2]! + w; r4[a3] = r4[a3]! + w; r4[a4] = r4[a4]! + w;
          break;
        }
        case 4: {
          const a0 = active[0]!;
          const a1 = active[1]!;
          const a2 = active[2]!;
          const a3 = active[3]!;
          xtwz[a0] = xtwz[a0]! + wz;
          const r0 = xtwx[a0]!;
          r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w; r0[a2] = r0[a2]! + w; r0[a3] = r0[a3]! + w;
          xtwz[a1] = xtwz[a1]! + wz;
          const r1 = xtwx[a1]!;
          r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w; r1[a2] = r1[a2]! + w; r1[a3] = r1[a3]! + w;
          xtwz[a2] = xtwz[a2]! + wz;
          const r2 = xtwx[a2]!;
          r2[a0] = r2[a0]! + w; r2[a1] = r2[a1]! + w; r2[a2] = r2[a2]! + w; r2[a3] = r2[a3]! + w;
          xtwz[a3] = xtwz[a3]! + wz;
          const r3 = xtwx[a3]!;
          r3[a0] = r3[a0]! + w; r3[a1] = r3[a1]! + w; r3[a2] = r3[a2]! + w; r3[a3] = r3[a3]! + w;
          break;
        }
        case 3: {
          const a0 = active[0]!;
          const a1 = active[1]!;
          const a2 = active[2]!;
          xtwz[a0] = xtwz[a0]! + wz;
          const r0 = xtwx[a0]!;
          r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w; r0[a2] = r0[a2]! + w;
          xtwz[a1] = xtwz[a1]! + wz;
          const r1 = xtwx[a1]!;
          r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w; r1[a2] = r1[a2]! + w;
          xtwz[a2] = xtwz[a2]! + wz;
          const r2 = xtwx[a2]!;
          r2[a0] = r2[a0]! + w; r2[a1] = r2[a1]! + w; r2[a2] = r2[a2]! + w;
          break;
        }
        case 2: {
          const a0 = active[0]!;
          const a1 = active[1]!;
          xtwz[a0] = xtwz[a0]! + wz;
          const r0 = xtwx[a0]!;
          r0[a0] = r0[a0]! + w; r0[a1] = r0[a1]! + w;
          xtwz[a1] = xtwz[a1]! + wz;
          const r1 = xtwx[a1]!;
          r1[a0] = r1[a0]! + w; r1[a1] = r1[a1]! + w;
          break;
        }
        default: {
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
      }
    }
    // Tiny ridge keeps the Hessian positive definite under separation
    // (coefficients stay large-but-finite instead of diverging).
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

/**
 * Fixed full-grid standardization. Only M×P pair means and factor marginals
 * are retained; no S×M×P dense vectors are materialized. Predictions for
 * missing cells extrapolate under the selected logit design. Probability
 * interactions also include link nonlinearity, not only logit interactions.
 */
function standardizedEffects(design: Design, coefficients: readonly number[]): number[] {
  const { scenarios, models, projects, scenarioWeights } = design;
  const pairMeans = Array.from({ length: models.length }, () => new Array<number>(projects.length).fill(0));
  const scenarioMeans = new Array<number>(scenarios.length).fill(0);
  for (let s = 0; s < scenarios.length; s++) {
    let sum = 0;
    for (let m = 0; m < models.length; m++) {
      for (let p = 0; p < projects.length; p++) {
        const probability = design.predict(scenarios[s]!, models[m]!, projects[p]!, coefficients);
        pairMeans[m]![p] = pairMeans[m]![p]! + scenarioWeights[s]! * probability;
        sum += probability;
      }
    }
    scenarioMeans[s] = sum / (models.length * projects.length);
  }
  const modelMeans = new Array<number>(models.length).fill(0);
  const projectMeans = new Array<number>(projects.length).fill(0);
  let sum = 0;
  for (let m = 0; m < models.length; m++) {
    for (let p = 0; p < projects.length; p++) {
      const probability = pairMeans[m]![p]!;
      modelMeans[m] = modelMeans[m]! + probability / projects.length;
      projectMeans[p] = projectMeans[p]! + probability / models.length;
      sum += probability;
    }
  }
  const grandMean = sum / (models.length * projects.length);
  return design.effects.map((term) => {
    switch (term.factor) {
      case "a": return scenarioMeans[term.scenario]! - grandMean;
      case "u": return modelMeans[term.model]! - grandMean;
      case "v": return projectMeans[term.project]! - grandMean;
      case "w": return pairMeans[term.model]![term.project]! - modelMeans[term.model]! - projectMeans[term.project]! + grandMean;
    }
  });
}

function percentile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = (sortedValues.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sortedValues[lo]!;
  return sortedValues[lo]! * (hi - index) + sortedValues[hi]! * (index - lo);
}

export function fitLogitAdditive(
  rows: readonly {
    readonly scenarioId: string;
    readonly modelVersion: string;
    readonly projectId: string;
    readonly y: 0 | 1;
    readonly occurredAtMs: number;
  }[],
  options?: { readonly maxIter?: number; readonly bootstrap?: number; readonly seed?: number }
): AttributionReport {
  const maxIter = options?.maxIter ?? MAX_ITER_DEFAULT;
  const bootstrapDraws = options?.bootstrap ?? BOOTSTRAP_DEFAULT;
  const seed = options?.seed ?? SEED_DEFAULT;

  const baseRows: Row[] = rows.map((r) => ({
    scenarioId: r.scenarioId,
    modelVersion: r.modelVersion,
    projectId: r.projectId,
    y: r.y
  })).sort((a, b) => compareText(a.scenarioId, b.scenarioId)
    || compareText(a.modelVersion, b.modelVersion)
    || compareText(a.projectId, b.projectId)
    || a.y - b.y);
  const effects: AttributionEffect[] = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    // Degenerate outcome distribution: no finite logit fit exists.
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = buildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupports(vectors);
  const keys = canonicalRowKeys(baseRows);
  if (!hasFullColumnRank(supports, design.names.length)) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: rank-deficient design");
  }
  const fit = irls(design, baseRows, vectors, supports, keys, baseRows.length, maxIter);
  if (fit.coefficients === null) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }
  const pointEffects = standardizedEffects(design, fit.coefficients);
  if (!pointEffects.every(Number.isFinite)) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: non-finite standardized prediction");
  }

  // Seeded bootstrap refits on the original design, prediction grid and q_s.
  const random = rng(seed);
  const draws = pointEffects.map(() => [] as number[]);
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    // Samples reuse the original observed rows' vectors, supports and keys.
    const sample: Row[] = [];
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
    if (!hasFullColumnRank(sampleSupports, design.names.length)) continue;
    const bootFit = irls(design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter);
    if (bootFit.coefficients === null) continue;
    const sampleEffects = standardizedEffects(design, bootFit.coefficients);
    if (!sampleEffects.every(Number.isFinite)) continue;
    successful += 1;
    for (let i = 0; i < sampleEffects.length; i++) draws[i]!.push(sampleEffects[i]!);
  }

  if (successful < MIN_SUCCESSFUL_DRAWS) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
  }
  for (let i = 0; i < pointEffects.length; i++) {
    const values = draws[i]!;
    values.sort((a, b) => a - b);
    effects.push({
      name: design.effects[i]!.name,
      point: pointEffects[i]!,
      lcb: percentile(values, 0.025),
      ucb: percentile(values, 0.975)
    });
  }

  // Scenario-hard uses the empirical mean's Beta LCB (same leaf rule as Task 2).
  const n = baseRows.length;
  const mean = baseRows.reduce((acc, r) => acc + r.y, 0) / n;
  const muPosterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const muLcb = betaQuantileLcb(muPosterior, 0.05);
  const models = design.models.length;
  const projects = design.projects.length;
  // Bootstrap noise means an "uninformative" interval can sit a hair off zero;
  // treat CIs within a small epsilon of zero as containing it.
  const ZERO_EPS = 0.005 * ATTRIBUTION_EFFECT;
  const containsZero = (e: AttributionEffect): boolean =>
    e.lcb <= ZERO_EPS && e.ucb >= -ZERO_EPS;
  const interactionEffects = design.effects.flatMap((term, i) =>
    term.factor === "w" ? [{ model: term.model, project: term.project, effect: effects[i]! }] : []);

  // Additive effects retain precedence over the scenario-level flag.
  let diagnosis: AttributionLabel = "uncertain";
  const scenarioHard = muLcb < QUALITY_FLOOR && models >= 2 && projects >= 3;
  if (
    design.effects.some((term, i) => term.factor === "u"
      && effects[i]!.lcb < -ATTRIBUTION_EFFECT
      && interactionEffects.filter((w) => w.model === term.model).every((w) => containsZero(w.effect)))
  ) {
    diagnosis = "model-problem";
  } else if (
    design.effects.some((term, i) => term.factor === "v"
      && effects[i]!.lcb < -ATTRIBUTION_EFFECT
      && interactionEffects.filter((w) => w.project === term.project).every((w) => containsZero(w.effect)))
  ) {
    diagnosis = "project-problem";
  } else if (interactionEffects.some((w) => w.effect.lcb < -ATTRIBUTION_EFFECT)) {
    diagnosis = "interaction-only";
  } else if (scenarioHard) {
    diagnosis = "scenario-hard";
  }

  return {
    estimator: "logit-additive",
    rowsUsed: baseRows.length,
    effects,
    diagnosis,
    reason: `${PROTOCOL}: ${diagnosis === "uncertain" ? "no effect beyond threshold or intervals too wide" : `${diagnosis} beyond the ${ATTRIBUTION_EFFECT} effect threshold`}`,
    writesActivePointer: false
  };
}

function uncertainReport(rowsUsed: number, reason: string): AttributionReport {
  return {
    estimator: "logit-additive",
    rowsUsed,
    effects: [],
    diagnosis: "uncertain",
    reason: `${PROTOCOL}: ${reason}`,
    writesActivePointer: false
  };
}
