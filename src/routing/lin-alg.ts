import { DomainValidationError } from "../domain/errors.js";

/**
 * Phase C Task 3: minimal symmetric solver. Gaussian elimination with
 * partial pivoting — no npm numeric library. Returns null when the matrix
 * is singular to working precision; callers must fail closed.
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
