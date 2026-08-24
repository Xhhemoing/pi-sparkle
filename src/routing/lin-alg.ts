import { DomainValidationError } from "../domain/errors.js";

/**
 * Phase C Task 3: minimal symmetric solver. Gaussian elimination with
 * partial pivoting — no npm numeric library. Returns null when the matrix
 * is singular to working precision; callers must fail closed.
 *
 * The row references and the pivot column of `x` are hoisted out of the
 * inner loops: nothing inside those loops reassigns `m[col]`, `m[row]`, or
 * `x[col]` (the pivot swap runs before the hoist, and elimination only
 * writes elements of rows strictly below `col`), so every read and write
 * targets the identical memory in the identical order. The float operation
 * set, values, and order are unchanged — the hoists only drop redundant
 * outer-array loads that the JIT does not eliminate on its own.
 *
 * The elimination k loop is unrolled by four with an in-order remainder:
 * the bodies execute for k, k+1, k+2, k+3 in exactly the source order of
 * the rolled loop (no reordering, no extra or missing iterations), so the
 * sequence of loads, float operations, and stores is identical instruction
 * for instruction — only the per-element loop increment/compare/branch
 * overhead is amortized, which the JIT does not do on its own here.
 */
export function solveSymmetric(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
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
    const colArr = m[col]!;
    const pivot = colArr[col]!;
    const xCol = x[col]!;
    for (let row = col + 1; row < n; row++) {
      const rowArr = m[row]!;
      const factor = rowArr[col]! / pivot;
      if (factor === 0) continue;
      let k = col;
      const stop = n - 3;
      for (; k < stop; k += 4) {
        rowArr[k] = rowArr[k]! - factor * colArr[k]!;
        rowArr[k + 1] = rowArr[k + 1]! - factor * colArr[k + 1]!;
        rowArr[k + 2] = rowArr[k + 2]! - factor * colArr[k + 2]!;
        rowArr[k + 3] = rowArr[k + 3]! - factor * colArr[k + 3]!;
      }
      for (; k < n; k++) {
        rowArr[k] = rowArr[k]! - factor * colArr[k]!;
      }
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
