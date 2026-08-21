import type { RequirementContract } from "../domain/contract.js";

export type PrecedenceRule = "user-first" | "spec-first" | "latest-first";

export interface Conflict {
  readonly ids: readonly string[];
  readonly description: string;
  readonly resolvedBy?: string;
}

function isFastCheck(check: string): boolean {
  const lower = check.toLowerCase();
  return lower.includes("fast") || lower.includes("< 10ms");
}

function isSlowCheck(check: string): boolean {
  const lower = check.toLowerCase();
  return lower.includes("slow") || lower.includes("> 1000ms");
}

export function detectConflicts(contract: RequirementContract): Conflict[] {
  const fast = contract.acceptanceCriteria.filter((criterion) => isFastCheck(criterion.observableCheck));
  const slow = contract.acceptanceCriteria.filter((criterion) => isSlowCheck(criterion.observableCheck));
  if (fast.length === 0 || slow.length === 0) return [];
  return [
    {
      ids: [...fast, ...slow].map((criterion) => criterion.id),
      description: "contradictory-latency"
    }
  ];
}

export function applyPrecedence(contract: RequirementContract, rule: PrecedenceRule): RequirementContract {
  const conflicts = detectConflicts(contract);
  if (conflicts.length === 0) return contract;

  const drop = new Set<string>();
  const assumptions = [...contract.assumptions];
  for (const conflict of conflicts) {
    const ordered = contract.acceptanceCriteria.filter((criterion) => conflict.ids.includes(criterion.id));
    const winner = rule === "user-first" ? ordered[0] : ordered.at(-1);
    if (winner === undefined) continue;
    for (const criterion of ordered) {
      if (criterion.id === winner.id) continue;
      drop.add(criterion.id);
      assumptions.push({
        id: `a-superseded-${criterion.id}`,
        statement: `Dropped by ${rule}: ${criterion.description}`,
        source: "precedence"
      });
    }
  }

  return {
    ...contract,
    acceptanceCriteria: contract.acceptanceCriteria.filter((criterion) => !drop.has(criterion.id)),
    assumptions
  };
}
