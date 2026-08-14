import type { EvaluatorKind } from "./types.js";

export interface PrecedenceEntry {
  readonly kind: EvaluatorKind;
  readonly weight: number;
}

export const EVIDENCE_PRECEDENCE: readonly PrecedenceEntry[] = [
  { kind: "deterministic", weight: 3 },
  { kind: "human", weight: 2 },
  { kind: "inferential", weight: 1 },
] as const;

export function getPrecedenceWeight(kind: EvaluatorKind): number {
  const entry = EVIDENCE_PRECEDENCE.find((e) => e.kind === kind);
  return entry ? entry.weight : 0;
}

export function comparePrecedence(a: EvaluatorKind, b: EvaluatorKind): number {
  return getPrecedenceWeight(a) - getPrecedenceWeight(b);
}

export function selectHighestPrecedence(kinds: readonly EvaluatorKind[]): EvaluatorKind | undefined {
  if (kinds.length === 0) return undefined;
  return kinds.reduce((best, current) =>
    comparePrecedence(current, best) > 0 ? current : best
  );
}
