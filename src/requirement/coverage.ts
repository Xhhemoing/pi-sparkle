import type { RequirementContract, CoverageMatrix } from "../domain/contract.js";

export interface CoverageGateResult {
  readonly ok: boolean;
  readonly orphans: readonly string[];
  readonly uncoveredCriteria: readonly string[];
  readonly blockingDecisions: readonly string[];
}

export function checkCoverageGate(contract: RequirementContract, matrix: CoverageMatrix): CoverageGateResult {
  const orphans = [...matrix.orphanRequirements];
  const uncoveredCriteria: string[] = [];
  const blockingDecisions: string[] = [];

  for (const criterion of contract.acceptanceCriteria) {
    const covered = Object.keys(matrix.requirementToTasks).includes(criterion.id) &&
      (matrix.requirementToTasks[criterion.id]?.length ?? 0) > 0;
    if (!covered) {
      uncoveredCriteria.push(criterion.id);
    }
  }

  for (const q of contract.questions) {
    if (!q.default) {
      blockingDecisions.push(q.id);
    }
  }

  const ok = orphans.length === 0 && uncoveredCriteria.length === 0 && blockingDecisions.length === 0;
  return { ok, orphans, uncoveredCriteria, blockingDecisions };
}
