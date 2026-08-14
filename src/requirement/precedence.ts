import type { RequirementContract } from "../domain/contract.js";

export type PrecedenceRule = "user-first" | "spec-first" | "latest-first";

export interface Conflict {
  readonly ids: readonly string[];
  readonly description: string;
  readonly resolvedBy?: string;
}

export function detectConflicts(contract: RequirementContract): Conflict[] {
  const conflicts: Conflict[] = [];
  const checks = contract.acceptanceCriteria.map((c) => c.observableCheck.toLowerCase());

  if (checks.some((c) => c.includes("fast") || c.includes("< 10ms")) &&
      checks.some((c) => c.includes("slow") || c.includes("> 1000ms"))) {
    conflicts.push({
      ids: contract.acceptanceCriteria.map((c) => c.id),
      description: "contradictory-latency"
    });
  }
  return conflicts;
}

export function applyPrecedence(contract: RequirementContract, _rule: PrecedenceRule): RequirementContract {
  // Placeholder: precedence is recorded but does not mutate the contract in M3.
  // Real resolution happens at user decision gate (M4+).
  return contract;
}
