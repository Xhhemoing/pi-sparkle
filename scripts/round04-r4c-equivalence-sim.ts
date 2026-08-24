/**
 * Round 4 / R4-C equivalence & performance simulation (offline routing slice).
 *
 * The R4-C edit lives entirely in `src/routing/lin-alg.ts`: loop-invariant
 * reference hoisting inside `solveSymmetric`. A CPU profile of the perf
 * fixture shows the Gaussian-elimination kernel holds ~77% of the whole
 * `fitLogitAdditive` self time, and the JIT does not hoist the `m[col]` /
 * `m[row]` / `x[col]` loads out of the elimination loops on its own (the
 * element stores conservatively kill them). Hoisting them is pure code
 * motion: no statement between the hoist point and the last use reassigns
 * `m[col]`, `m[row]`, or `x[col]` (the pivot swap runs before the hoist and
 * elimination writes only touch elements of rows strictly below `col`), so
 * every read and write targets the identical memory in the identical order
 * and the float operation set/values/order are unchanged — bitwise-identical
 * outputs by construction. This is the same transform S3-C landed for the
 * IRLS accumulation (`xtwx[a]` row hoist), applied to the dominant kernel.
 *
 * Variants raced for the single-winner adjudication:
 *   CTL     frozen ccd4ab4 (S3-C production) solveSymmetric, verbatim below
 *   PROD    production import (the landed R4-C winner)
 *   VAR-H2  winner embedded independently (colArr + rowArr + xCol hoists)
 *   VAR-H   hoists without xCol (dominated sibling)
 *   VAR-HD  H2 + dead-store skip (inner k loop starts at col+1; the
 *           eliminated m[row][col] is provably never read again) — measured
 *           SLOWER than H2, rejected
 *   VAR-F   flat Float64Array + Int32 row-offset table (O(1) swaps) — rejected
 *   VAR-FC  flat Float64Array + physical row-copy swaps — rejected
 *   VAR-H3  H2 + defensive copy restructured to for+slice — noise vs H2,
 *           rejected (copy stays verbatim `a.map(row => [...row])`)
 *
 * Every check demands bitwise-identical floats (Object.is) and identical
 * structures/strings. The fit pipeline embedded below is the verbatim
 * current production `offline-logit.ts` (unchanged this round) parameterized
 * only by the solve function, so control-vs-variant diffs are exactly the
 * solve edits; production-import-vs-control diffs are exactly the R4-C edit.
 * Direct kernel checks additionally cover pivot-swap-forcing matrices,
 * asymmetric inputs, singular/non-finite/negative-zero/empty/1x1 inputs and
 * the non-square error path, which the fit-level fixtures cannot force.
 * Run with: npx tsx scripts/round04-r4c-equivalence-sim.ts
 */

import { fitLogitAdditive } from "../src/routing/offline-logit.js";
import { solveSymmetric } from "../src/routing/lin-alg.js";
import type { AttributionReport, OfflineRow } from "../src/routing/offline-types.js";
import { betaQuantileLcb } from "../src/routing/posterior.js";
import { DomainValidationError } from "../src/domain/errors.js";

type Solve = (a: readonly (readonly number[])[], b: readonly number[]) => number[] | null;

/* ------------------------------------------------------------------ */
/* Frozen ccd4ab4 (S3-C production) solveSymmetric — verbatim CONTROL. */
/* ------------------------------------------------------------------ */

function ctlSolveSymmetric(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  // Work on augmented copies.
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;

  for (let col = 0; col < n; col++) {
    // Partial pivot: largest |value| in this column at or below the diagonal.
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null; // singular
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const pivot = m[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = m[row]![col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) {
        m[row]![k] = m[row]![k]! - factor * m[col]![k]!;
      }
      x[row] = x[row]! - factor * x[col]!;
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= m[row]![k]! * solution[k]!;
    const diag = m[row]![row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/* Swap-counting copy of the control (fixture-coverage instrumentation only). */
let swapCount = 0;
function countingSolve(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      swapCount++;
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const pivot = m[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = m[row]![col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) m[row]![k] = m[row]![k]! - factor * m[col]![k]!;
      x[row] = x[row]! - factor * x[col]!;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= m[row]![k]! * solution[k]!;
    const diag = m[row]![row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/* ----------------------------- variants ----------------------------- */

/** Winner, embedded independently of the production import. */
function varH2(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      x[row] = x[row]! - factor * xCol;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rowArr = m[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= rowArr[k]! * solution[k]!;
    const diag = rowArr[row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/** Hoists without xCol (dominated sibling). */
function varH(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      x[row] = x[row]! - factor * x[col]!;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rowArr = m[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= rowArr[k]! * solution[k]!;
    const diag = rowArr[row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/**
 * H2 + dead-store skip: the inner k loop starts at col+1, leaving the
 * eliminated m[row][col] at its pre-step value. That position is provably
 * never read again (pivot searches read later columns only, back
 * substitution reads the upper triangle only, swaps move whole row
 * references), so outputs stay bitwise identical — but the variant measured
 * SLOWER than H2 and is rejected.
 */
function varHD(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = a.map((row) => [...row]);
  const x: number[] = [...b];
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      for (let k = col + 1; k < n; k++) rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      x[row] = x[row]! - factor * xCol;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rowArr = m[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= rowArr[k]! * solution[k]!;
    const diag = rowArr[row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/** Flat Float64Array + Int32 row-offset table (rejected: slower than H2). */
function varF(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i++) m.set(a[i]! as number[], i * n);
  const x = Float64Array.from(b);
  const base = new Int32Array(n);
  for (let i = 0; i < n; i++) base[i] = i * n;
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[base[col]! + col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[base[row]! + col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = base[col]!;
      base[col] = base[pivotRow]!;
      base[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const cBase = base[col]!;
    const pivot = m[cBase + col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rBase = base[row]!;
      const factor = m[rBase + col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) m[rBase + k] = m[rBase + k]! - factor * m[cBase + k]!;
      x[row] = x[row]! - factor * xCol;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rBase = base[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= m[rBase + k]! * solution[k]!;
    const diag = m[rBase + row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/** Flat Float64Array + physical row-copy swaps (rejected: slower than H2). */
function varFC(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i++) m.set(a[i]! as number[], i * n);
  const x = Float64Array.from(b);
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col * n + col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row * n + col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const cOff = col * n;
      const pOff = pivotRow * n;
      for (let k = 0; k < n; k++) {
        const tmp = m[cOff + k]!;
        m[cOff + k] = m[pOff + k]!;
        m[pOff + k] = tmp;
      }
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const cBase = col * n;
    const pivot = m[cBase + col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rBase = row * n;
      const factor = m[rBase + col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) m[rBase + k] = m[rBase + k]! - factor * m[cBase + k]!;
      x[row] = x[row]! - factor * xCol;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rBase = row * n;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= m[rBase + k]! * solution[k]!;
    const diag = m[rBase + row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/** H2 + defensive copy via for+slice (noise vs H2, rejected). */
function varH3(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = b.length;
  if (a.length !== n || a.some((row) => row.length !== n)) {
    throw new DomainValidationError("solveSymmetric requires a square matrix matching b");
  }
  const m: number[][] = new Array(n);
  for (let i = 0; i < n; i++) m[i] = a[i]!.slice() as number[];
  const x: number[] = b.slice() as number[];
  const eps = 1e-12;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const abs = Math.abs(m[row]![col]!);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }
    if (pivotAbs < eps) return null;
    if (pivotRow !== col) {
      const tmp = m[col]!;
      m[col] = m[pivotRow]!;
      m[pivotRow] = tmp;
      const tb = x[col]!;
      x[col] = x[pivotRow]!;
      x[pivotRow] = tb;
    }
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      x[row] = x[row]! - factor * xCol;
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const rowArr = m[row]!;
    let sum = x[row]!;
    for (let k = row + 1; k < n; k++) sum -= rowArr[k]! * solution[k]!;
    const diag = rowArr[row]!;
    if (Math.abs(diag) < eps) return null;
    solution[row] = sum / diag;
  }
  for (const value of solution) {
    if (!Number.isFinite(value)) return null;
  }
  return solution;
}

/* ------------------------------------------------------------------- */
/* Verbatim current production fitLogitAdditive pipeline (S3-C form),   */
/* parameterized only by the solve function.                            */
/* ------------------------------------------------------------------- */

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

interface FitResult {
  readonly coefficients: readonly number[] | null;
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

function irls(
  solve: Solve,
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
    const next = solve(xtwx, xtwz);
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

function fitWith(
  solve: Solve,
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
  const fit = irls(solve, design, baseRows, vectors, supports, keys, baseRows.length, maxIter);
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
    const bootFit = irls(solve, design, sample, sampleVectors, sampleSupports, sampleKeys, baseRows.length, maxIter);
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

/* ------------------------------ harness ------------------------------ */

let checksPassed = 0;
let failures = 0;

function check(label: string, ok: boolean): void {
  if (ok) checksPassed++;
  else {
    failures++;
    console.error(`FAIL ${label}`);
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

type KernelOutcome =
  | { kind: "solution"; values: readonly number[] }
  | { kind: "null" }
  | { kind: "throw"; name: string; message: string };

function runKernel(solve: Solve, a: readonly (readonly number[])[], b: readonly number[]): KernelOutcome {
  try {
    const result = solve(a, b);
    return result === null ? { kind: "null" } : { kind: "solution", values: result };
  } catch (error) {
    const e = error as Error;
    return { kind: "throw", name: e.constructor.name, message: e.message };
  }
}

function compareKernel(label: string, expected: KernelOutcome, actual: KernelOutcome): void {
  check(`${label}.kind`, expected.kind === actual.kind);
  if (expected.kind === "solution" && actual.kind === "solution") {
    check(`${label}.length`, expected.values.length === actual.values.length);
    if (expected.values.length === actual.values.length) {
      for (let i = 0; i < expected.values.length; i++) {
        check(`${label}[${i}]`, Object.is(expected.values[i], actual.values[i]));
      }
    }
  } else if (expected.kind === "throw" && actual.kind === "throw") {
    check(`${label}.errName`, expected.name === actual.name);
    check(`${label}.errMessage`, expected.message === actual.message);
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

const out = (line: string): void => {
  console.log(line);
};

const fail = (line: string): void => {
  console.error(line);
  process.exitCode = 1;
};

/* -------------- scenario 1: direct kernel bitwise equivalence -------------- */

const KERNEL_VARIANTS: Array<[string, Solve]> = [
  ["prod", solveSymmetric],
  ["H2", varH2],
  ["H", varH],
  ["HD", varHD],
  ["F", varF],
  ["FC", varFC],
  ["H3", varH3],
];

function scenarioKernel(): void {
  const cases: Array<{ label: string; a: number[][]; b: number[] }> = [];

  // Pivot-swap-forcing SPD matrix: |m[1][0]| = 1.5 > |m[0][0]| = 1.
  cases.push({ label: "swap-spd-2x2", a: [[1, 1.5], [1.5, 4]], b: [1, 2] });
  // Swap chain on an asymmetric matrix (the public function accepts any square input).
  cases.push({
    label: "swap-asym-3x3",
    a: [[0.001, 2, 3], [4, 5, 6], [7, 8, 10]],
    b: [1, -2, 3],
  });
  // Singular: rank-1 symmetric.
  cases.push({ label: "singular-2x2", a: [[1, 2], [2, 4]], b: [1, 1] });
  // All-zero matrix (pivotAbs = 0 immediately).
  cases.push({ label: "zero-3x3", a: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b: [1, 2, 3] });
  // Non-finite entries: NaN and Infinity propagate to the final null gate.
  cases.push({ label: "nan-2x2", a: [[Number.NaN, 1], [1, 2]], b: [1, 1] });
  cases.push({ label: "inf-2x2", a: [[Number.POSITIVE_INFINITY, 1], [1, 2]], b: [1, 1] });
  // Negative zeros in the matrix and rhs.
  cases.push({ label: "negzero-2x2", a: [[-0, 1], [1, -0]], b: [-0, 1] });
  // factor === 0 skip path.
  cases.push({ label: "zero-factor-3x3", a: [[2, 1, 0], [0, 3, 1], [4, 0, 5]], b: [1, 2, 3] });
  // Tiny sizes.
  cases.push({ label: "one-by-one", a: [[5]], b: [10] });
  cases.push({ label: "one-by-one-singular", a: [[0]], b: [10] });
  cases.push({ label: "empty", a: [], b: [] });
  // Random symmetric positive-definite-ish and asymmetric matrices, n = 2..12.
  const r = fixtureRng(0x4c04);
  for (let t = 0; t < 30; t++) {
    const n = 2 + Math.floor(r() * 11);
    const sym: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        const v = (r() - 0.5) * 10;
        sym[i]![j] = v;
        sym[j]![i] = v;
      }
      sym[i]![i] = sym[i]![i]! + n; // keep most fixtures nonsingular
    }
    const asym: number[][] = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => (r() - 0.5) * 10)
    );
    const rhs = Array.from({ length: n }, () => (r() - 0.5) * 4);
    cases.push({ label: `rand-sym-${t}`, a: sym, b: rhs });
    cases.push({ label: `rand-asym-${t}`, a: asym, b: [...rhs] });
  }

  swapCount = 0;
  for (const testCase of cases) {
    const expected = runKernel(ctlSolveSymmetric, testCase.a, testCase.b);
    runKernel(countingSolve, testCase.a, testCase.b);
    for (const [name, solve] of KERNEL_VARIANTS) {
      compareKernel(`kernel.${testCase.label}.${name}`, expected, runKernel(solve, testCase.a, testCase.b));
    }
  }
  // Non-square / mismatched inputs must throw the identical error.
  const badInputs: Array<{ label: string; a: number[][]; b: number[] }> = [
    { label: "non-square", a: [[1, 2, 3], [4, 5, 6]], b: [1, 2] },
    { label: "b-mismatch", a: [[1, 2], [3, 4]], b: [1, 2, 3] },
  ];
  for (const bad of badInputs) {
    const expected = runKernel(ctlSolveSymmetric, bad.a, bad.b);
    check(`kernel.${bad.label}.ctl-throws`, expected.kind === "throw");
    for (const [name, solve] of KERNEL_VARIANTS) {
      compareKernel(`kernel.${bad.label}.${name}`, expected, runKernel(solve, bad.a, bad.b));
    }
  }
  check("kernel.swap-coverage", swapCount > 0);
  out(
    `scenario 1 (direct kernel bitwise equivalence, ${cases.length + badInputs.length} matrices x ` +
      `{production, H2, H, HD, F, FC, H3} vs frozen ccd4ab4 reference; pivot swaps exercised: ${swapCount})`
  );
}

/* -------------- scenario 2: full-report bitwise equivalence -------------- */

function scenarioEquivalence(): void {
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
  // Single-level factors (intercept + reference levels only).
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

  for (const [index, testCase] of cases.entries()) {
    const expected = fitWith(ctlSolveSymmetric, testCase.rows, testCase.options);
    compareReports(`R4C-prod[${index}]`, expected, fitLogitAdditive(testCase.rows, testCase.options));
    compareReports(`R4C-H2[${index}]`, expected, fitWith(varH2, testCase.rows, testCase.options));
    compareReports(`R4C-H[${index}]`, expected, fitWith(varH, testCase.rows, testCase.options));
    compareReports(`R4C-HD[${index}]`, expected, fitWith(varHD, testCase.rows, testCase.options));
    compareReports(`R4C-F[${index}]`, expected, fitWith(varF, testCase.rows, testCase.options));
    compareReports(`R4C-FC[${index}]`, expected, fitWith(varFC, testCase.rows, testCase.options));
    compareReports(`R4C-H3[${index}]`, expected, fitWith(varH3, testCase.rows, testCase.options));
  }
  out(
    `scenario 2 (full-report bitwise equivalence, ${cases.length} cases x {production, H2, H, HD, ` +
      `F, FC, H3} vs frozen ccd4ab4 solve under the verbatim S3-C pipeline)`
  );
}

/* --------------------------- performance fixture --------------------------- */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function perfFixture(): void {
  const r = fixtureRng(0xbeef);
  const rows = randomRows(r, {
    scenarios: 4,
    models: 6,
    projects: 8,
    rows: 400,
    passRate: 0.6,
  });
  const options = { bootstrap: 200, seed: SEED_DEFAULT };

  // Correctness first: the perf fixture must also be bitwise identical.
  const expected = fitWith(ctlSolveSymmetric, rows, options);
  compareReports("perf-fixture.prod", expected, fitLogitAdditive(rows, options));
  compareReports("perf-fixture.H2", expected, fitWith(varH2, rows, options));
  compareReports("perf-fixture.H", expected, fitWith(varH, rows, options));
  compareReports("perf-fixture.HD", expected, fitWith(varHD, rows, options));
  compareReports("perf-fixture.F", expected, fitWith(varF, rows, options));
  compareReports("perf-fixture.FC", expected, fitWith(varFC, rows, options));
  compareReports("perf-fixture.H3", expected, fitWith(varH3, rows, options));

  // Kernel workload shape on this fixture (swaps counted by the instrumented control).
  swapCount = 0;
  fitWith(countingSolve, rows, options);
  out(`perf fixture kernel shape: rows=400, pivot swaps across all solve calls: ${swapCount}`);

  const racers: Array<[string, () => AttributionReport]> = [
    ["ctl (S3-C frozen)", (): AttributionReport => fitWith(ctlSolveSymmetric, rows, options)],
    ["production", (): AttributionReport => fitLogitAdditive(rows, options)],
    ["VAR-H2", (): AttributionReport => fitWith(varH2, rows, options)],
    ["VAR-H", (): AttributionReport => fitWith(varH, rows, options)],
    ["VAR-HD", (): AttributionReport => fitWith(varHD, rows, options)],
    ["VAR-F", (): AttributionReport => fitWith(varF, rows, options)],
    ["VAR-FC", (): AttributionReport => fitWith(varFC, rows, options)],
    ["VAR-H3", (): AttributionReport => fitWith(varH3, rows, options)],
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
  out(`perf fixture (rows=400, bootstrap=200), median of 7 interleaved reps:`);
  for (let v = 0; v < racers.length; v++) {
    const ms = median(times[v]!);
    out(`  ${racers[v]![0].padEnd(18)} ${ms.toFixed(1)} ms  (${(ctlMs / ms).toFixed(2)}x vs ctl)`);
  }
}

scenarioKernel();
scenarioEquivalence();
perfFixture();

if (failures > 0) {
  fail(`\n${failures} EQUIVALENCE CHECK(S) FAILED (${checksPassed} passed)`);
} else {
  out(`\nALL EQUIVALENCE CHECKS PASSED (${checksPassed} bitwise checks)`);
}
