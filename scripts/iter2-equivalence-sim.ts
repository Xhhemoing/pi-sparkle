/**
 * Iteration-2 equivalence & performance simulation.
 *
 * Compares the iteration-1 (commit bf23106) implementations — embedded below,
 * verbatim, as the frozen CONTROL — against the current production code for:
 *
 *   D1  buildDesign column-index map + interaction-pair set (O(1) lookups)
 *   E2  averagePredictiveComparison with hoisted on-probabilities and
 *       inactive-row skipping (+0.0 contributions elided)
 *   F1  IRLS X'WX / X'Wz accumulation over precomputed per-row supports
 *   G1  fitProbabilityAdditive parent cell-stats reuse in the pair loop
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings, including thrown error messages. The script never
 * touches production state; it only imports pure functions.
 * Run with: npx tsx scripts/iter2-equivalence-sim.ts
 */

import { fitLogitAdditive } from "../src/routing/offline-logit.js";
import { fitProbabilityAdditive } from "../src/routing/offline-prob-add.js";
import type {
  AttributionEffect,
  AttributionLabel,
  AttributionReport,
  OfflineRow,
} from "../src/routing/offline-types.js";
import { DEFAULT_POSTERIOR_CONFIG, betaQuantileLcb } from "../src/routing/posterior.js";
import { solveSymmetric } from "../src/routing/lin-alg.js";
import { DomainValidationError } from "../src/domain/errors.js";

/* ------------------------------------------------------------------ */
/* Frozen iteration-1 reference (control). Verbatim from bf23106.     */
/* betaQuantileLcb / solveSymmetric / DomainValidationError did not   */
/* change this round and are imported from production, so the diff    */
/* under test stays exactly the D1/E2/F1/G1 edits.                    */
/* ------------------------------------------------------------------ */

const counters = {
  refBuildCalls: 0,
  refDotCalls: 0,
  newBuildEquivalentSaved: 0,
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

function refRng(seed: number): () => number {
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

  const referenceLevels: Array<{ factor: "a" | "u" | "v"; name: string }> = [];
  const lastModel = models[models.length - 1];
  const lastProject = projects[projects.length - 1];
  if (lastModel !== undefined) referenceLevels.push({ factor: "u", name: lastModel });
  if (lastProject !== undefined) referenceLevels.push({ factor: "v", name: lastProject });

  return {
    names,
    referenceLevels,
    build(row: RefRow, skip?: string): number[] {
      counters.refBuildCalls += 1;
      const vec = new Array<number>(names.length).fill(0);
      vec[0] = 1;
      const set = (name: string): void => {
        if (name === skip) return;
        const index = names.indexOf(name);
        if (index > 0) vec[index] = 1;
      };
      if (row.scenarioId !== scenarios[scenarios.length - 1]) set(`a:${row.scenarioId}`);
      if (row.modelVersion !== models[models.length - 1]) set(`u:${row.modelVersion}`);
      if (row.projectId !== projects[projects.length - 1]) set(`v:${row.projectId}`);
      const pairKey = `${row.modelVersion}|${row.projectId}`;
      if (interactionPairs.includes(pairKey)) set(`w:${pairKey}`);
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
      for (let a = 0; a < p; a++) {
        if (xi[a] === 0) continue;
        xtwz[a] = xtwz[a]! + w * xi[a]! * z;
        for (let b = 0; b < p; b++) {
          if (xi[b] === 0) continue;
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
  counters.refDotCalls += 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function refAveragePredictiveComparison(
  design: RefDesign,
  rows: readonly RefRow[],
  vectors: readonly number[][],
  coefficients: readonly number[],
  column: string
): number {
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const on = refSigmoid(refDot(coefficients, vectors[i]!));
    const offVector = design.build(rows[i]!, column);
    const off = refSigmoid(refDot(coefficients, offVector));
    sum += on - off;
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

  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(name, refAveragePredictiveComparison(design, baseRows, vectors, fit.coefficients, name));
  }
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  const random = refRng(seed);
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
    for (const [name] of pointEffects.entries()) {
      const value = refAveragePredictiveComparison(design, sample, sampleVectors, bootFit.coefficients, name);
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

/* --------------- frozen fitProbabilityAdditive (bf23106) --------------- */

const PA_ATTRIBUTION_EFFECT = 0.1;
const PA_QUALITY_FLOOR = 0.55;
const PA_INTERACTION_KAPPA = 16;

interface RefCellStats {
  readonly n: number;
  readonly mean: number;
}

function refCell(rows: readonly { y: 0 | 1 }[]): RefCellStats {
  const n = rows.length;
  if (n === 0) return { n: 0, mean: 0 };
  const sum = rows.reduce((acc, r) => acc + r.y, 0);
  return { n, mean: sum / n };
}

function refKappaS(cells: readonly RefCellStats[]): number {
  if (cells.length < 3) return 8;
  const means = cells.map((c) => c.mean);
  const mu = means.reduce((a, b) => a + b, 0) / means.length;
  const variance =
    means.reduce((acc, m) => acc + (m - mu) * (m - mu), 0) / (means.length - 1 || 1);
  return Math.min(40, Math.max(2, variance));
}

function refShrink(kappa: number, stats: RefCellStats, scenarioMean: number): number {
  const w = kappa / (kappa + stats.n);
  return w * scenarioMean + (1 - w) * stats.mean;
}

function refBetaInterval(n: number, mean: number): { lcb: number; ucb: number } {
  const posterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const tail = 0.05;
  void DEFAULT_POSTERIOR_CONFIG.lcbZ;
  return {
    lcb: betaQuantileLcb(posterior, tail),
    ucb: betaQuantileLcb(posterior, 1 - tail),
  };
}

function refDiffInterval(
  leaf: { n: number; mean: number },
  baseline: number
): { point: number; lcb: number; ucb: number } {
  const interval = refBetaInterval(leaf.n, leaf.mean);
  return {
    point: leaf.mean - baseline,
    lcb: interval.lcb - baseline,
    ucb: interval.ucb - baseline,
  };
}

function refFitProbabilityAdditive(
  rows: readonly OfflineRow[],
  _options?: { readonly kappaClamp?: readonly [number, number]; readonly seed?: number }
): AttributionReport {
  void _options;
  if (rows.length === 0) {
    throw new DomainValidationError("probability-additive attribution requires at least one row");
  }
  const scenarioIds = [...new Set(rows.map((r) => r.scenarioId))];
  if (scenarioIds.length !== 1) {
    throw new DomainValidationError(
      `probability-additive attribution requires exactly one scenario, got ${scenarioIds.length}`
    );
  }

  const whole = refCell(rows);
  const muS = whole.mean;

  const byModel = new Map<string, { y: 0 | 1 }[]>();
  const byProject = new Map<string, { y: 0 | 1 }[]>();
  const byPair = new Map<string, { y: 0 | 1 }[]>();
  for (const row of rows) {
    refPush(byModel, row.modelVersion, row);
    refPush(byProject, row.projectId, row);
    refPush(byPair, `${row.modelVersion}|${row.projectId}`, row);
  }

  const kappaScenario = refKappaS([...byModel.values(), ...byProject.values()].map(refCell));

  const effects: AttributionEffect[] = [];
  const muInterval = refBetaInterval(whole.n, muS);
  effects.push({ name: "mu_s", point: muS, lcb: muInterval.lcb, ucb: muInterval.ucb });

  const modelDiffs = new Map<string, { point: number; lcb: number; ucb: number }>();
  for (const [model, list] of byModel) {
    const stats = refCell(list);
    const pM = refShrink(kappaScenario, stats, muS);
    const diff = refDiffInterval(stats, muS);
    void pM;
    modelDiffs.set(model, diff);
    effects.push({ name: `p_m-mu_s:${model}`, ...diff });
  }

  const projectDiffs = new Map<string, { point: number; lcb: number; ucb: number }>();
  for (const [project, list] of byProject) {
    const stats = refCell(list);
    const diff = refDiffInterval(stats, muS);
    projectDiffs.set(project, diff);
    effects.push({ name: `p_p-mu_s:${project}`, ...diff });
  }

  const interactionDiffs = new Map<string, { point: number; lcb: number; ucb: number }>();
  for (const [pair, list] of byPair) {
    const stats = refCell(list);
    const parts = pair.split("|");
    const model = parts[0];
    const project = parts[1];
    if (model === undefined || project === undefined) continue;
    const modelStats = refCell(byModel.get(model) ?? []);
    const projectStats = refCell(byProject.get(project) ?? []);
    const pM = refShrink(kappaScenario, modelStats, muS);
    const pP = refShrink(kappaScenario, projectStats, muS);
    const pAdd = Math.min(1, Math.max(0, pM + pP - muS));
    const pMp = refShrink(PA_INTERACTION_KAPPA, stats, pAdd);
    const diff = refDiffInterval(stats, pAdd);
    void pMp;
    interactionDiffs.set(pair, diff);
    effects.push({ name: `p_mp-p_add:${pair}`, ...diff });
  }

  const diagnosis = refDiagnose({
    muSLcb: muInterval.lcb,
    models: byModel.size,
    projects: byProject.size,
    modelDiffs,
    projectDiffs,
    interactionDiffs,
    byPair,
  });

  return {
    estimator: "probability-additive",
    rowsUsed: rows.length,
    effects,
    diagnosis,
    reason: refDiagnosisReason(diagnosis),
    writesActivePointer: false,
  };
}

function refPush<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function refDiagnose(input: {
  muSLcb: number;
  models: number;
  projects: number;
  modelDiffs: Map<string, { lcb: number; ucb: number }>;
  projectDiffs: Map<string, { lcb: number; ucb: number }>;
  interactionDiffs: Map<string, { lcb: number; ucb: number }>;
  byPair: Map<string, unknown>;
}): AttributionLabel {
  const containsZero = (d: { lcb: number; ucb: number }): boolean =>
    d.lcb <= 0 && d.ucb >= 0;

  if (input.muSLcb < PA_QUALITY_FLOOR && input.models >= 2 && input.projects >= 3) {
    return "scenario-hard";
  }
  for (const [model, diff] of input.modelDiffs) {
    if (diff.lcb < -PA_ATTRIBUTION_EFFECT) {
      const pairs = [...input.interactionDiffs.entries()].filter(([key]) =>
        key.startsWith(`${model}|`)
      );
      if (pairs.every(([, d]) => containsZero(d))) return "model-problem";
    }
  }
  for (const [, diff] of input.projectDiffs) {
    if (diff.lcb < -PA_ATTRIBUTION_EFFECT) {
      const pairs = [...input.interactionDiffs.entries()].filter(([key]) =>
        key.endsWith(`|${refLastSegment(input, key)}`)
      );
      if (pairs.length > 0 && pairs.every(([, d]) => containsZero(d))) {
        return "project-problem";
      }
    }
  }
  for (const [pair, diff] of input.interactionDiffs) {
    const stats = input.byPair.get(pair);
    const support = typeof stats === "object" && stats !== null && "length" in stats ? (stats as unknown[]).length : 0;
    if (support >= 3 && diff.lcb < -PA_ATTRIBUTION_EFFECT) return "interaction-only";
  }
  return "uncertain";
}

function refLastSegment(_input: unknown, key: string): string {
  const parts = key.split("|");
  return parts[parts.length - 1] ?? key;
}

function refDiagnosisReason(diagnosis: AttributionLabel): string {
  switch (diagnosis) {
    case "scenario-hard":
      return "scenario mean LCB below the quality floor with enough models and projects to compare";
    case "model-problem":
      return "a model version underperforms the scenario mean beyond the effect threshold with no explaining interaction";
    case "project-problem":
      return "a project underperforms the scenario mean beyond the effect threshold with no explaining interaction";
    case "interaction-only":
      return "only a specific (model, project) cell underperforms; additive terms are clean";
    default:
      return "intervals too wide or no effect beyond threshold";
  }
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
    // Give the first model a depressed pass rate so effect thresholds trigger.
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

/* ---------------------- scenario 1: fitLogitAdditive ---------------------- */

function scenarioLogit(): void {
  const rng = fixtureRng(0x1e72);
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
  // Default options on a mid-size fixture (exercises bootstrap=200 default).
  cases.push({
    rows: randomRows(rng, { scenarios: 2, models: 3, projects: 3, rows: 50, passRate: 0.6 }),
  });

  for (const [index, testCase] of cases.entries()) {
    const expected = refFitLogitAdditive(testCase.rows, testCase.options);
    const actual = fitLogitAdditive(testCase.rows, testCase.options);
    compareReports(`logit[${index}]`, expected, actual);
  }
  out(`scenario 1 (fitLogitAdditive D1+E2+F1): ${cases.length} cases compared`);
}

/* ------------------ scenario 2: fitProbabilityAdditive ------------------ */

function scenarioProbAdd(): void {
  const rng2 = fixtureRng(0x9a57);
  const cases: OfflineRow[][] = [];
  for (let i = 0; i < 60; i++) {
    cases.push(
      randomRows(rng2, {
        scenarios: 1,
        models: 1 + Math.floor(rng2() * 5),
        projects: 1 + Math.floor(rng2() * 5),
        rows: 1 + Math.floor(rng2() * 150),
        passRate: rng2(),
      })
    );
  }
  // "|" inside modelVersion: split desync falls back to the empty parent cell.
  cases.push(
    randomRows(rng2, {
      scenarios: 1,
      models: 4,
      projects: 4,
      rows: 80,
      passRate: 0.5,
      pipeInModel: true,
    })
  );

  for (const [index, rows] of cases.entries()) {
    const expected = refFitProbabilityAdditive(rows);
    const actual = fitProbabilityAdditive(rows);
    compareReports(`probAdd[${index}]`, expected, actual);
  }

  // Error paths must throw the identical messages.
  const errorCases: OfflineRow[][] = [
    [],
    randomRows(rng2, { scenarios: 3, models: 2, projects: 2, rows: 12, passRate: 0.5 }),
  ];
  for (const [index, rows] of errorCases.entries()) {
    let expectedMessage: string | undefined;
    let actualMessage: string | undefined;
    try {
      refFitProbabilityAdditive(rows);
    } catch (error) {
      expectedMessage = error instanceof Error ? error.message : String(error);
    }
    try {
      fitProbabilityAdditive(rows);
    } catch (error) {
      actualMessage = error instanceof Error ? error.message : String(error);
    }
    check(
      `probAdd.error[${index}]`,
      expectedMessage !== undefined && expectedMessage === actualMessage,
      `${expectedMessage} vs ${actualMessage}`
    );
  }
  out(
    `scenario 2 (fitProbabilityAdditive G1): ${cases.length} cases + ${errorCases.length} error paths compared`
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
  compareReports("perf-fixture", refFitLogitAdditive(rows, options), fitLogitAdditive(rows, options));

  counters.refBuildCalls = 0;
  counters.refDotCalls = 0;
  const runs = 3;
  const oldTimes: number[] = [];
  const newTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    refFitLogitAdditive(rows, options);
    oldTimes.push(performance.now() - t0);
    const t1 = performance.now();
    fitLogitAdditive(rows, options);
    newTimes.push(performance.now() - t1);
  }
  const oldMs = median(oldTimes);
  const newMs = median(newTimes);
  out(
    `perf fixture (rows=400, p≈${refBuildDesign(rows.map((r) => ({ ...r }))).names.length}, bootstrap=200): ` +
      `reference ${oldMs.toFixed(1)} ms -> current ${newMs.toFixed(1)} ms (${(oldMs / newMs).toFixed(1)}x)`
  );
  out(
    `reference work per fit on this fixture: buildCalls=${Math.round(counters.refBuildCalls / runs)}, dotCalls=${Math.round(counters.refDotCalls / runs)}`
  );
}

scenarioLogit();
scenarioProbAdd();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  process.exit(1);
}
out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
