/**
 * Round 7 / R7-C landing simulation (offline routing slice): support-only
 * eta (winner S7-C, the reopened X2-1 row — reopened by the exclusion-table
 * owner on the strength of the R7-C §3 dossier).
 *
 * The landed edit lives entirely in `src/routing/offline-logit.ts`, at the
 * unique-key eta site inside the S2-C stamp/dedup branch of `irls`: the full
 * `dot(beta, vector)` over all p columns (p multiplies + p adds, most of
 * them ±0.0 zero terms) is replaced by summation over that row's support
 * only, in ascending index order:
 *
 *   let value = 0;
 *   const active = supports[i]!;
 *   for (let ai = 0; ai < active.length; ai++) value += beta[active[ai]!]!;
 *
 * Bitwise identity holds by the R7-C §3.1 lemma under three premises, all
 * true by construction at this site: (1) design entries are exactly 0/1
 * (`build()` writes only the intercept and dummy 1s onto a fill(0) vector);
 * (2) the accumulator starts at +0.0 (`let value = 0` / `let sum = 0`);
 * (3) beta is finite (guarded by `beta.every(Number.isFinite)`; the fit
 * fails closed otherwise). Then a partial sum can never be -0.0 (IEEE
 * round-to-nearest yields -0.0 from a+b only when both are -0.0), so every
 * skipped `0*beta` term is a bitwise no-op (adding ±0.0 to a non-(-0.0)
 * value is the identity) and every kept `1.0*beta` term is bitwise `beta`.
 * If the design ever gains non-0/1 entries, the premises fail and the edit
 * must revert to the full dot (X2-1's original reason regains force).
 *
 * Untouched by the edit: the S2-C stamp/dedup itself, the S6-C
 * `switch(active.length)` accumulation, and the shared `dot()` helper still
 * used verbatim by `onProbabilitiesFor` and `averagePredictiveComparison`.
 *
 * Lanes (every check demands bitwise-identical floats via Object.is and
 * identical structures/strings):
 *
 *   CTL   frozen pre-edit production irls (the landed S6-C form, verbatim
 *         80d103e body: full dot(beta, vector) at the eta site, switch
 *         accumulation) — the reference every lane must match bitwise
 *   PROD  production import (the landed S7-C winner)
 *   SOD   the winner embedded independently of the production import:
 *         CTL with exactly one edit — the support-only eta sum
 *
 * The fit pipeline embedded below is the verbatim production
 * `offline-logit.ts` parameterized only by the irls implementation, so
 * control-vs-SOD diffs are exactly the eta-site edit and
 * production-import-vs-control diffs are exactly the landed R7-C edit.
 * `solveSymmetric` and `betaQuantileLcb` are unchanged this round and
 * imported from production on both sides.
 *
 * Fixtures include the R7-C §3.2 signed-zero adversarial set:
 *   beta0-truncated  maxIter=1 pins the beta=0 first iteration — the full
 *                    dot adds only +0.0 terms while the support sum adds
 *                    only +0.0 entries
 *   negative-beta    uniformly failing dummies drive negative coefficients,
 *                    so the reference dot adds -0.0 terms (0 * negative
 *                    beta) — the exact failure mode X2-1's original reason
 *                    worried about
 *   empty-support    an all-zero vector (s=0): reference dot returns +0.0
 *                    via zero terms only vs the untouched +0.0 initial
 *                    accumulator — production-unreachable (vec[0]=1 always)
 *                    but pins the lemma's endpoint
 *
 * Modes:
 *   (default)   full equivalence battery (direct irls s=1..8, signed-zero
 *               adversarial fixtures, 53 report-level cases), eta-site
 *               instrumentation, and an in-process multi-way race (irls
 *               call sites go polymorphic here, so only the relative order
 *               is meaningful)
 *   --duel A,B  clean two-lane timing: exactly two racers, 7 interleaved
 *               reps, median — the landing-grade numbers; run in 3+
 *               independent processes (e.g. --duel ctl,prod)
 *
 * Run: npx tsx scripts/round07-r7c-equivalence-sim.ts [--duel ctl,prod]
 */

import { fitLogitAdditive } from "../src/routing/offline-logit.js";
import { solveSymmetric } from "../src/routing/lin-alg.js";
import { betaQuantileLcb } from "../src/routing/posterior.js";
import type { AttributionReport, OfflineRow } from "../src/routing/offline-types.js";

const MAX_ITER_DEFAULT = 50;
const TOL = 1e-8;
const BOOTSTRAP_DEFAULT = 200;
const SEED_DEFAULT = 20260818;
const INTERACTION_MIN_N = 3;
const MIN_SUCCESSFUL_DRAWS = 20;
const ATTRIBUTION_EFFECT = 0.1;
const QUALITY_FLOOR = 0.55;

interface Design {
  readonly names: readonly string[];
  readonly columnIndex: ReadonlyMap<string, number>;
  build(row: Row, skip?: string): number[];
  readonly referenceLevels: ReadonlyArray<{ factor: "a" | "u" | "v"; name: string }>;
}

interface Row {
  readonly scenarioId: string;
  readonly modelVersion: string;
  readonly projectId: string;
  readonly y: 0 | 1;
}

interface FitResult {
  readonly coefficients: readonly number[] | null;
}

type IrlsImpl = (
  design: Design,
  rows: readonly Row[],
  vectors: readonly number[][],
  supports: readonly (readonly number[])[],
  keys: readonly number[],
  keySpace: number,
  maxIter: number
) => FitResult;

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

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

function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function buildDesign(rows: readonly Row[]): Design {
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
    ...interactionPairs.map((key) => `w:${key}`)
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

function computeSupports(vectors: readonly number[][]): number[][] {
  return vectors.map((vector) => {
    const active: number[] = [];
    for (let j = 0; j < vector.length; j++) {
      if (vector[j] !== 0) active.push(j);
    }
    return active;
  });
}

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

/* ------------------------------------------------------------------- */
/* CTL: frozen pre-edit production irls — verbatim 80d103e (S6-C) body: */
/* full dot(beta, vector) at the eta site, switch accumulation.         */
/* ------------------------------------------------------------------- */

const irlsCtl: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
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
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        const value = dot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
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

/* ------------------------------------------------------------------- */
/* SOD: the landed S7-C winner embedded independently of the production */
/* import. Exactly one edit vs CTL: the eta site sums beta over the     */
/* row's support in ascending index order instead of the full dot.      */
/* ------------------------------------------------------------------- */

const irlsSOD: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
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
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
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

/* Instrumented CTL copy: counts eta-site row visits, dedup dots, and dot
 * terms (mul+add pairs the landed edit deletes) plus the support adds the
 * landed edit keeps. Coverage/accounting only — never raced. */
let etaRowVisits = 0;
let etaDotCalls = 0;
let etaDotTerms = 0;
let etaSupportAdds = 0;
const irlsCounting: IrlsImpl = (design, rows, vectors, supports, keys, keySpace, maxIter) => {
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
    const mark = iter + 1;
    for (let i = 0; i < n; i++) {
      etaRowVisits++;
      const key = keys[i]!;
      if (stamp[key] !== mark) {
        stamp[key] = mark;
        etaDotCalls++;
        etaDotTerms += vectors[i]!.length;
        etaSupportAdds += supports[i]!.length;
        const value = dot(beta, vectors[i]!);
        etaByKey[key] = value;
        muByKey[key] = sigmoid(value);
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

/* ------------------------------------------------------------------- */
/* Verbatim current production fitLogitAdditive pipeline, parameterized */
/* only by the irls implementation.                                     */
/* ------------------------------------------------------------------- */

function onProbabilitiesFor(
  vectors: readonly number[][],
  coefficients: readonly number[]
): number[] {
  return vectors.map((vector) => sigmoid(dot(coefficients, vector)));
}

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

function fitWith(
  irlsImpl: IrlsImpl,
  rows: readonly OfflineRow[],
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
  const effects: Array<{ name: string; point: number; lcb: number; ucb: number }> = [];

  if (baseRows.length === 0 || baseRows.every((r) => r.y === 0) || baseRows.every((r) => r.y === 1)) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: degenerate or empty design");
  }

  const design = buildDesign(baseRows);
  const vectors = baseRows.map((r) => design.build(r));
  const supports = computeSupports(vectors);
  const keys = canonicalRowKeys(baseRows);
  const fit = irlsImpl(design, baseRows, vectors, supports, keys, baseRows.length, maxIter);
  if (fit.coefficients === null) {
    return uncertainReport(baseRows.length, "INVALID_ESTIMATE: singular or non-finite Hessian");
  }

  const onProbabilities = onProbabilitiesFor(vectors, fit.coefficients);
  const pointEffects = new Map<string, number>();
  for (const name of design.names) {
    if (name === "intercept") continue;
    pointEffects.set(
      name,
      averagePredictiveComparison(design, baseRows, vectors, fit.coefficients, onProbabilities, name)
    );
  }
  for (const ref of design.referenceLevels) {
    if (!pointEffects.has(`${ref.factor}:${ref.name}`)) {
      pointEffects.set(`${ref.factor}:${ref.name}`, 0);
    }
  }

  const random = rng(seed);
  const draws = new Map<string, number[]>();
  let successful = 0;
  for (let draw = 0; draw < bootstrapDraws; draw++) {
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
    const bootFit = irlsImpl(design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter);
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

  const n = baseRows.length;
  const mean = baseRows.reduce((acc, r) => acc + r.y, 0) / n;
  const muPosterior = { alpha: 1 + n * mean, beta: 1 + n * (1 - mean) };
  const muLcb = betaQuantileLcb(muPosterior, 0.05);
  const models = new Set(baseRows.map((r) => r.modelVersion)).size;
  const projects = new Set(baseRows.map((r) => r.projectId)).size;
  const ZERO_EPS = 0.005 * ATTRIBUTION_EFFECT;
  const containsZero = (e: { lcb: number; ucb: number }): boolean =>
    e.lcb <= ZERO_EPS && e.ucb >= -ZERO_EPS;
  const interactionsFor = (prefix: string): Array<{ name: string; lcb: number; ucb: number }> =>
    effects.filter((e) => e.name.startsWith(`w:${prefix}`));

  let diagnosis: AttributionReport["diagnosis"] = "uncertain";
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

/* ------------------------------ harness ------------------------------ */

let checksPassed = 0;
let failures = 0;

function check(label: string, ok: boolean): void {
  if (ok) checksPassed++;
  else {
    failures++;
    process.stderr.write(`FAIL ${label}\n`);
  }
}

function compareReports(label: string, expected: AttributionReport, actual: AttributionReport): void {
  check(`${label}.estimator`, expected.estimator === actual.estimator);
  check(`${label}.rowsUsed`, expected.rowsUsed === actual.rowsUsed);
  check(`${label}.diagnosis`, expected.diagnosis === actual.diagnosis);
  check(`${label}.reason`, expected.reason === actual.reason);
  check(`${label}.writesActivePointer`, expected.writesActivePointer === actual.writesActivePointer);
  check(`${label}.effects.length`, expected.effects.length === actual.effects.length);
  if (expected.effects.length === actual.effects.length) {
    for (let i = 0; i < expected.effects.length; i++) {
      const e = expected.effects[i]!;
      const g = actual.effects[i]!;
      check(`${label}.effects[${i}].name`, e.name === g.name);
      check(`${label}.effects[${i}].point`, Object.is(e.point, g.point));
      check(`${label}.effects[${i}].lcb`, Object.is(e.lcb, g.lcb));
      check(`${label}.effects[${i}].ucb`, Object.is(e.ucb, g.ucb));
    }
  }
}

function compareFits(label: string, expected: FitResult, actual: FitResult): void {
  const en = expected.coefficients === null;
  const an = actual.coefficients === null;
  check(`${label}.null`, en === an);
  if (expected.coefficients !== null && actual.coefficients !== null) {
    check(`${label}.length`, expected.coefficients.length === actual.coefficients.length);
    if (expected.coefficients.length === actual.coefficients.length) {
      for (let i = 0; i < expected.coefficients.length; i++) {
        check(`${label}[${i}]`, Object.is(expected.coefficients[i], actual.coefficients[i]));
      }
    }
  }
}

/* ------------------------------ fixtures ------------------------------ */

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

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

function randomRows(
  r: () => number,
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
    const modelVersion = pick(r, models);
    const rate = modelVersion === models[0] ? options.passRate * 0.4 : options.passRate;
    rows.push({
      scenarioId: pick(r, scenarios),
      modelVersion,
      projectId: pick(r, projects),
      y: r() < rate ? 1 : 0,
      occurredAtMs: 1_000 + i,
    });
  }
  return rows;
}

function allUniqueRows(r: () => number, count: number): OfflineRow[] {
  const rows: OfflineRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      scenarioId: `s${i % 2}`,
      modelVersion: `m${i}`,
      projectId: `p${i}`,
      y: r() < 0.6 ? 1 : 0,
      occurredAtMs: 1_000 + i,
    });
  }
  return rows;
}

function batteryCases(): Array<{ rows: OfflineRow[]; options?: { maxIter?: number; bootstrap?: number; seed?: number } }> {
  const r = fixtureRng(0x3c01);
  const cases: Array<{ rows: OfflineRow[]; options?: { maxIter?: number; bootstrap?: number; seed?: number } }> = [];

  for (let i = 0; i < 40; i++) {
    cases.push({
      rows: randomRows(r, {
        scenarios: 1 + Math.floor(r() * 3),
        models: 1 + Math.floor(r() * 4),
        projects: 1 + Math.floor(r() * 4),
        rows: 10 + Math.floor(r() * 90),
        passRate: 0.3 + r() * 0.6,
      }),
      options: { bootstrap: 25 + Math.floor(r() * 40), seed: 1 + Math.floor(r() * 10_000) },
    });
  }
  // Degenerate outcome distributions and the empty design.
  cases.push({ rows: [] });
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 2, projects: 2, rows: 20, passRate: 2 }),
  });
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 2, projects: 2, rows: 20, passRate: -1 }),
  });
  // Too few bootstrap draws -> INVALID_ESTIMATE path.
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 2, projects: 2, rows: 30, passRate: 0.6 }),
    options: { bootstrap: 5, seed: 42 },
  });
  // Tiny fits where resamples often collapse to one class.
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 2, projects: 1, rows: 4, passRate: 0.5 }),
    options: { bootstrap: 30, seed: 7 },
  });
  // Truncated IRLS (non-converged path).
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 3, projects: 2, rows: 40, passRate: 0.5 }),
    options: { maxIter: 3, bootstrap: 30, seed: 11 },
  });
  // "|" inside modelVersion (pair-key construction AND nested-map keys).
  cases.push({
    rows: randomRows(r, {
      scenarios: 2,
      models: 3,
      projects: 3,
      rows: 60,
      passRate: 0.55,
      pipeInModel: true,
    }),
    options: { bootstrap: 30, seed: 99 },
  });
  // Single-level factors (intercept + interaction column: s = 2 everywhere).
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 1, projects: 1, rows: 24, passRate: 0.5 }),
    options: { bootstrap: 40, seed: 3 },
  });
  // Default options on a mid-size fixture (exercises bootstrap=200 default).
  cases.push({
    rows: randomRows(r, { scenarios: 2, models: 3, projects: 3, rows: 50, passRate: 0.6 }),
  });
  // Heavy duplication: one (model, project) cell, many rows -> few keys.
  cases.push({
    rows: randomRows(r, { scenarios: 1, models: 2, projects: 2, rows: 80, passRate: 0.55 }),
    options: { bootstrap: 40, seed: 21 },
  });
  // No duplication at all: canonical key space degenerates to n.
  cases.push({
    rows: allUniqueRows(r, 36),
    options: { bootstrap: 40, seed: 23 },
  });
  // Single-key fixture: every row the same covariate triple, mixed outcomes.
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
  // Intercept-only design (support size 1 on every row).
  cases.push({
    rows: [
      { scenarioId: "s0", modelVersion: "m0", projectId: "p0", y: 1, occurredAtMs: 1_000 },
      { scenarioId: "s0", modelVersion: "m0", projectId: "p0", y: 0, occurredAtMs: 1_001 },
    ],
    options: { bootstrap: 30, seed: 5 },
  });
  return cases;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const fail = (line: string): void => {
  process.stderr.write(`${line}\n`);
  process.exitCode = 1;
};

/* -------- scenario 1: direct irls bitwise equivalence (s = 1..8) -------- */

function directDesign(p: number): Design {
  return {
    names: Array.from({ length: p }, (_, i) => `c${i}`),
    columnIndex: new Map(),
    referenceLevels: [],
    build(): number[] {
      throw new Error("direct-irls fixtures never call design.build");
    }
  };
}

function directKeys(vectors: readonly number[][]): number[] {
  const seen = new Map<string, number>();
  const keys = new Array<number>(vectors.length);
  for (let i = 0; i < vectors.length; i++) {
    const sig = vectors[i]!.join(",");
    const canonical = seen.get(sig);
    if (canonical === undefined) {
      seen.set(sig, i);
      keys[i] = i;
    } else {
      keys[i] = canonical;
    }
  }
  return keys;
}

function scenarioDirectIrls(): void {
  const r = fixtureRng(0x7c01);
  let fixtures = 0;
  const supportSizes = new Set<number>();
  for (let t = 0; t < 24; t++) {
    const p = 6 + Math.floor(r() * 7); // 6..12 columns
    const n = 5 + Math.floor(r() * 36); // 5..40 rows
    const vectors: number[][] = [];
    const rows: Row[] = [];
    for (let j = 0; j < n; j++) {
      // Duplicate an earlier vector (shared reference, shared canonical key)
      // on roughly a third of the rows to exercise the eta/mu dedup path.
      if (j > 0 && r() < 0.35) {
        const k = Math.floor(r() * j);
        vectors.push(vectors[k]!);
      } else {
        const vec = new Array<number>(p).fill(0);
        vec[0] = 1;
        // Extra support size 0..7 on top of the intercept sweeps s = 1..8,
        // beyond the production-reachable 1..5.
        const extra = (j + t) % 8;
        const cols = new Set<number>();
        while (cols.size < Math.min(extra, p - 1)) {
          cols.add(1 + Math.floor(r() * (p - 1)));
        }
        for (const c of cols) vec[c] = 1;
        vectors.push(vec);
      }
      rows.push({ scenarioId: "s", modelVersion: "m", projectId: "p", y: r() < 0.5 ? 1 : 0 });
    }
    const supports = computeSupports(vectors);
    for (const s of supports) supportSizes.add(s.length);
    const keys = directKeys(vectors);
    const design = directDesign(p);
    const maxIter = t % 3 === 0 ? 1 : t % 3 === 1 ? 3 : 50;
    const expected = irlsCtl(design, rows, vectors, supports, keys, n, maxIter);
    compareFits(`direct[${t}].SOD`, expected, irlsSOD(design, rows, vectors, supports, keys, n, maxIter));
    fixtures++;
  }
  for (let s = 1; s <= 6; s++) {
    check(`direct.support-size-${s}-covered`, supportSizes.has(s));
  }
  out(
    `scenario 1 (direct irls bitwise equivalence, ${fixtures} fixtures x SOD vs frozen ` +
      `pre-edit S6-C irls; support sizes: ${[...supportSizes].sort((a, b) => a - b).join(",")})`
  );
}

/* --------- scenario 1b: adversarial signed-zero fixtures (R7-C §3.2) --------- */

function scenarioSignedZero(): void {
  // Force negative and mixed-sign beta trajectories, tiny etas near zero,
  // shared references, and the empty-support edge. Every check is Object.is,
  // so a -0.0 vs +0.0 divergence in eta would surface as a coefficient
  // mismatch downstream (sigmoid(±0) = 0.5 either way, but eta feeds
  // z = eta + (y - mu)/w directly, where -0.0 + x differs from +0.0 + x
  // only at x = ±0.0 — also covered by the maxIter=1 beta=0 fixture here).
  const design = directDesign(6);
  const mk = (vecs: number[][], ys: Array<0 | 1>, maxIter: number, label: string): void => {
    const rows: Row[] = ys.map((y) => ({ scenarioId: "s", modelVersion: "m", projectId: "p", y }));
    const supports = computeSupports(vecs);
    const keys = directKeys(vecs);
    const expected = irlsCtl(design, rows, vecs, supports, keys, rows.length, maxIter);
    compareFits(`zero[${label}]`, expected, irlsSOD(design, rows, vecs, supports, keys, rows.length, maxIter));
  };
  // beta = 0 first iteration: full dot adds 0*1 and 0*0 terms (+0.0 each);
  // support-only sums +0.0 entries. maxIter=1 pins the beta=0 eta exactly.
  mk(
    [
      [1, 0, 1, 0, 0, 0],
      [1, 1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 1],
    ],
    [1, 0, 1],
    1,
    "beta0-truncated"
  );
  // Mixed-sign betas (uniformly failing dummy drives a negative coefficient);
  // zero terms then multiply negative betas: the reference adds -0.0 terms —
  // the exact scenario X2-1's original exclusion reason worried about.
  mk(
    [
      [1, 1, 0, 0, 0, 0],
      [1, 1, 0, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 0, 1, 0],
      [1, 0, 0, 0, 1, 0],
    ],
    [0, 0, 1, 1, 1, 0, 1, 1],
    50,
    "negative-beta"
  );
  // All-zero vector (empty support): full dot = +0.0 via 0-terms only;
  // support-only sum = initial +0.0. Unreachable in production (vec[0]=1
  // always) but pins the s=0 edge of the identity argument.
  mk(
    [
      [1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 1, 0, 0, 0],
    ],
    [1, 0, 1, 0],
    50,
    "empty-support"
  );
  out("scenario 1b (SOD adversarial signed-zero / beta=0 / empty-support fixtures, R7-C §3.2)");
}

/* -------------- scenario 2: full-report bitwise equivalence -------------- */

function scenarioEquivalence(): void {
  const cases = batteryCases();
  for (const [index, testCase] of cases.entries()) {
    const expected = fitWith(irlsCtl, testCase.rows, testCase.options);
    compareReports(`R7C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    compareReports(`R7C-SOD[${index}]`, expected, fitWith(irlsSOD, testCase.rows, testCase.options));
  }
  out(
    `scenario 2 (full-report bitwise equivalence, ${cases.length} cases x {production, SOD} ` +
      `vs frozen pre-edit S6-C irls under the verbatim production pipeline)`
  );
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function perfRows(): OfflineRow[] {
  const r = fixtureRng(0xbeef);
  return randomRows(r, {
    scenarios: 4,
    models: 6,
    projects: 8,
    rows: 400,
    passRate: 0.6,
  });
}

const PERF_OPTIONS = { bootstrap: 200, seed: SEED_DEFAULT };

function perfFixtureMultiway(): void {
  const rows = perfRows();

  // Correctness first: the perf fixture must also be bitwise identical.
  const expected = fitWith(irlsCtl, rows, PERF_OPTIONS);
  compareReports("perf-fixture.prod", expected, fitLogitAdditive(rows, PERF_OPTIONS));
  compareReports("perf-fixture.SOD", expected, fitWith(irlsSOD, rows, PERF_OPTIONS));

  // Eta-site accounting: mul+add pairs the landed edit deletes vs the
  // support adds it keeps.
  etaRowVisits = 0;
  etaDotCalls = 0;
  etaDotTerms = 0;
  etaSupportAdds = 0;
  fitWith(irlsCounting, rows, PERF_OPTIONS);
  out(
    `perf fixture eta site: rowVisits=${etaRowVisits} dedupDots=${etaDotCalls} ` +
      `dotTerms=${etaDotTerms} (mul+add pairs deleted) supportAdds=${etaSupportAdds} (kept)`
  );

  // In-process multi-way race: the irls call sites go polymorphic here, so
  // only the relative ordering is meaningful; the landing numbers come from
  // the clean two-lane duel mode below (see the R7-C-LAND report).
  const racers: Array<[string, () => AttributionReport]> = [
    ["ctl (pre-edit S6-C)", (): AttributionReport => fitWith(irlsCtl, rows, PERF_OPTIONS)],
    ["production", (): AttributionReport => fitLogitAdditive(rows, PERF_OPTIONS)],
    ["VAR-SOD", (): AttributionReport => fitWith(irlsSOD, rows, PERF_OPTIONS)],
  ];
  const times = racers.map(() => [] as number[]);
  for (let rep = 0; rep < 7; rep++) {
    for (let v = 0; v < racers.length; v++) {
      const t0 = performance.now();
      racers[v]![1]();
      times[v]!.push(performance.now() - t0);
    }
  }
  const ctlMs = median(times[0]!);
  out(`perf fixture (rows=400, bootstrap=200), median of 7 interleaved reps (multi-way, relative order only):`);
  for (let v = 0; v < racers.length; v++) {
    const ms = median(times[v]!);
    out(`  ${racers[v]![0].padEnd(20)} ${ms.toFixed(1)} ms  (${(ctlMs / ms).toFixed(2)}x vs ctl)`);
  }
}

/* ------------------------------ duel mode ------------------------------ */

const LANES: Record<string, (rows: readonly OfflineRow[]) => AttributionReport> = {
  ctl: (rows) => fitWith(irlsCtl, rows, PERF_OPTIONS),
  prod: (rows) => fitLogitAdditive(rows, PERF_OPTIONS),
  sod: (rows) => fitWith(irlsSOD, rows, PERF_OPTIONS),
};

function duel(a: string, b: string): void {
  const rows = perfRows();
  const laneA = LANES[a]!;
  const laneB = LANES[b]!;
  // Correctness inside the duel process too.
  compareReports(`duel.${a}-vs-${b}`, laneA(rows), laneB(rows));
  const ta: number[] = [];
  const tb: number[] = [];
  for (let rep = 0; rep < 7; rep++) {
    let t0 = performance.now();
    laneA(rows);
    ta.push(performance.now() - t0);
    t0 = performance.now();
    laneB(rows);
    tb.push(performance.now() - t0);
  }
  const ma = median(ta);
  const mb = median(tb);
  out(
    `duel ${a} vs ${b}: ${a}=${ma.toFixed(1)}ms ${b}=${mb.toFixed(1)}ms ` +
      `delta=${(ma - mb).toFixed(1)}ms (${(ma / mb).toFixed(3)}x)`
  );
  if (failures > 0) {
    fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  } else {
    out(`duel equivalence: ${checksPassed} bitwise checks passed`);
  }
}

/* ------------------------------- main ------------------------------- */

const duelArg = process.argv.indexOf("--duel");
if (duelArg !== -1) {
  const [a, b] = (process.argv[duelArg + 1] ?? "").split(",");
  if (a === undefined || b === undefined || !(a in LANES) || !(b in LANES)) {
    fail(`usage: --duel <${Object.keys(LANES).join("|")}>,<lane>`);
  } else {
    duel(a, b);
  }
} else {
  scenarioDirectIrls();
  scenarioSignedZero();
  scenarioEquivalence();
  perfFixtureMultiway();
  if (failures > 0) {
    fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
  } else {
    out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
  }
}
