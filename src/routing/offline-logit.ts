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
  const keys = canonicalRowKeys(baseRows);
  const fit = irls(design, baseRows, vectors, supports, keys, baseRows.length, maxIter);
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
    // A resampled row is a base row, so its design vector, support, and
    // canonical key are exactly the ones computed once for the base fit;
    // reusing them by index removes the per-draw O(rows × p) rebuild without
    // touching any float. Consumers only read the vectors, so the aliasing
    // is unobservable.
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
    // A resample can collapse to a single class; that draw is skipped.
    if (sample.every((r) => r.y === 0) || sample.every((r) => r.y === 1)) continue;
    const bootFit = irls(design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter);
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
