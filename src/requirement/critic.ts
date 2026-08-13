import type { RequirementContract } from "../domain/contract.js";

export interface ContractCritique {
  contradictions: string[];
  untestable: string[];
  scopeCreep: string[];
  missingSources: string[];
  score: number; // 0-100
}

export function critiqueContract(contract: RequirementContract): ContractCritique {
  const contradictions: string[] = [];
  const untestable: string[] = [];
  const scopeCreep: string[] = [];
  const missingSources: string[] = [];

  for (const c of contract.acceptanceCriteria) {
    if (!c.observableCheck || c.observableCheck === "manual-or-test") {
      untestable.push(c.id);
    }
  }

  if (contract.deliverables.length > 20) scopeCreep.push("too-many-deliverables");
  if (contract.sourceRefs.length === 0) missingSources.push("no-sources");

  const score = 100 - (untestable.length * 10 + scopeCreep.length * 15 + missingSources.length * 20);
  return { contradictions, untestable, scopeCreep, missingSources, score: Math.max(0, score) };
}
