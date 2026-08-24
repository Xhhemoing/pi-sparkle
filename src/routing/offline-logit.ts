import { type AttributionEffect, type AttributionLabel, type AttributionReport } from "./offline-types.js";
import { betaQuantileLcb } from "./posterior.js";
import { solveSymmetric } from "./lin-alg.js";

/**
 * Phase C Task 3: logit-additive attribution via IRLS (offline only).
 *
 *   logit Pr(y=1) = alpha(scenario) + u(modelVersion) + v(project) + w(modelVersion, project)
 *
 * One dummy dropped per factor (first seen id). Interaction columns only for
 * (model, project) pairs with n >= 3. Singular or non-finite fits fail closed
 * to `uncertain` / INVALID_ESTIMATE. Intervals: seeded bootstrap refits,
 * reporting the 2.5 / 97.5 percentiles. Never touches the active pointer.
 */

const MAX_ITER_DEFAULT = 50;
const TOL = 1e-8;
const BOOTSTRAP_DEFAULT = 200;
const SEED_DEFAULT = 20260818;
const INTERACTION_MIN_N = 3;
const MIN_SUCCESSFUL_DRAWS = 20;
const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;

interface Design {
  /** Column names, aligned with column indices. */
  readonly names: readonly string[];
  /** name -> column index. Names are unique, so this equals `names.indexOf`. */
  readonly columnIndex: ReadonlyMap<string, number>;
  /** Build one row's design vector; `skip` excludes one dummy column (for contrasts). */
  build(row: Row, skip?: string): number[];
  /** Reference levels dropped from the design; they report zero effects. */
  readonly referenceLevels: ReadonlyArray<{ factor: "a" | "u" | "v"; name: string }>;
}

interface Row {
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
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
  const scenarios = [...new Set(rows.map((r) => r.scenarioId))];
  const models = [...new Set(rows.map((r) => r.modelVersion))];
  const projects = [...new Set(rows.map((r) => r.projectId))];
  // Drop one dummy per factor: the LAST seen id becomes the reference, so a
  // uniformly failing first model keeps a real (negative) column.
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
    ...interactionPairs.map((key) => `w:${key}`)
  ];
  // All names are unique (deduped levels behind distinct prefixes), so a map
  // lookup returns exactly what `names.indexOf` did.
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
    build(row: Row, skip?: string): number[] {
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
    }
  };
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

function irls(
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
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
  let beta = new Array<number>(p).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      eta[i] = dot(beta, vectors[i]!);
      mu[i] = sigmoid(eta[i]!);
    }
    for (let d = 0; d < p; d++) xtwx[d]!.fill(0);
    xtwz.fill(0);
    // W = mu(1-mu); X' W X and X' W z with working response z = eta + (y - mu)/W.
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

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** onProbabilities[i] = sigmoid(dot(coefficients, vectors[i])), shared across columns. */
function onProbabilitiesFor(
  vectors: readonly number[][],
  coefficients: readonly number[]
): number[] {
  return vectors.map((vector) => sigmoid(dot(coefficients, vector)));
}

/**
 * Average predictive comparison on the probability scale: mean over training
 * rows of sigma(x*beta with dummy on) minus sigma(x*beta with dummy off).
 *
 * A row without the dummy has an off vector equal to its on vector, so its
 * contribution is exactly +0.0 (IEEE x - x); skipping those rows and the
 * columnless reference levels leaves every partial sum bitwise unchanged.
 *
 * An active row's off vector is its on vector with the contrast column
 * zeroed — copying the already-built on vector yields contents identical to
 * `design.build(row, column)` without repaying the O(p) rebuild per
 * (row, column). The intercept guard keeps the (unreachable) intercept
 * contrast at the build-path value: build() never skips the intercept, so
 * its off vector equals the on vector and the mean stays +0.0 either way.
 */
function averagePredictiveComparison(
  design: Design,
  rows: readonly Row[],
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
      const off = sigmoid(dot(coefficients, offVector));
      sum += on - off;
    }
  }
  return rows.length === 0 ? 0 : sum / rows.length;
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
  }));
  const effects: AttributionEffect[] = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    // Degenerate outcome distribution: no finite logit fit exists.
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = buildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupports(vectors);
  const fit = irls(design, baseRows, vectors, supports, maxIter);
  if (fit.coefficients === null) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  // Point effects via average predictive comparison.
  const onProbabilities = onProbabilitiesFor(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      averagePredictiveComparison(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
    );
  }
  // Reference levels have no column; their contrast is identically zero.
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  // Seeded bootstrap refits for intervals.
  const random = rng(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
    // A resampled row is a base row, so its design vector and support are
    // exactly the ones computed once for the base fit; reusing them by index
    // removes the per-draw O(rows × p) rebuild without touching any float.
    // Consumers only read the vectors, so the aliasing is unobservable.
    const sample: Row[] = [];
    const sampleVectors: number[][] = [];
    const sampleSupports: number[][] = [];
    for (let i = 0; i < baseRows.length; i++) {
      const index = Math.floor(random() * baseRows.length);
      sample.push(baseRows[index]!);
      sampleVectors.push(vectors[index]!);
      sampleSupports.push(supports[index]!);
    }
    // A resample can collapse to a single class; that draw is skipped.
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = irls(design, sample, sampleVectors, sampleSupports, maxIter);
    if (bootFit.coefficients === null) continue;
    successful += 1;
    const sampleOnProbabilities = onProbabilitiesFor(sampleVectors, bootFit.coefficients);
    for (const [name] of pointEffects.entries()) {
      const value = averagePredictiveComparison(
        design,
        sample,
        sampleVectors,
        bootFit.coefficients,
        sampleOnProbabilities,
        name
      );
      pushValue(draws, name, value);
    }
  }

  for (const [name, point] of pointEffects.entries()) {
    const values = draws.get(name) ?? [];
    if (successful < MIN_SUCCESSFUL_DRAWS || values.length < MIN_SUCCESSFUL_DRAWS) {
      return uncertainReport(baseRows.length, "INVALID_ESTIMATE: fewer than 20 successful bootstrap draws");
    }
    values.sort((a, b) => a - b);
    effects.push({
      name,
      point,
      lcb: percentile(values, 0.025),
      ucb: percentile(values, 0.975)
    });
  }

  // Scenario-hard uses the empirical mean's Beta LCB (same leaf rule as Task 2).
  const n = baseRows.length;
  const mean = baseRows.reduce((acc, r) => acc + r.y, 0) / n;
  const muPosterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const muLcb = betaQuantileLcb(muPosterior, 0.05);
  const models = new Set(baseRows.map((r) => r.modelVersion)).size;
  const projects = new Set(baseRows.map((r) => r.projectId)).size;
  // Bootstrap noise means an "uninformative" interval can sit a hair off zero;
  // treat CIs within a small epsilon of zero as containing it.
  const ZERO_EPS = 0.005 * ATTRIBUTION_EFFECT;
  const containsZero = (e: AttributionEffect): boolean =>
    e.lcb <= ZERO_EPS && e.ucb >= -ZERO_EPS;
  const interactionsFor = (prefix: string): AttributionEffect[] =>
    effects.filter((e) => e.name.startsWith(`w:${prefix}`));

  // Order note: additive effects are checked before the scenario-level flag.
  // A separable scenario (some models fail, some pass) must surface as a
  // model/project problem, not be masked by a low scenario mean.
  let diagnosis: AttributionLabel = "uncertain";
  const scenarioHard = muLcb < QUALITY_FLOOR && models >= 2 && projects >= 3;
  if (
    effects.some(
      (e) => e.name.startsWith("u:") && e.lcb < -ATTRIBUTION_EFFECT && interactionsFor(modelOf(e.name)).every(containsZero)
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
    writesActivePointer: false
  };
}

function modelOf(effectName: string): string {
  return effectName.slice("u:".length);
}

function pushValue(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function uncertainReport(rowsUsed: number, reason: string): AttributionReport {
  return {
    estimator: "logit-additive",
    rowsUsed,
    effects: [],
    diagnosis: "uncertain",
    reason,
    writesActivePointer: false
  };
}
