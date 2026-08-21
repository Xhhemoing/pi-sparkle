import type { RequirementContract } from "../domain/contract.js";

export interface UnsourcedItems {
  readonly ok: boolean;
  readonly deliverables: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly string[];
}

interface ProvenanceCarrier {
  readonly id: string;
  readonly sourceRefs?: readonly unknown[];
  readonly assumptionIds?: readonly string[];
}

function isSourced(item: ProvenanceCarrier, assumptionIds: ReadonlySet<string>): boolean {
  if (Array.isArray(item.sourceRefs) && item.sourceRefs.length > 0) return true;
  return (
    Array.isArray(item.assumptionIds) &&
    item.assumptionIds.length > 0 &&
    item.assumptionIds.every((id) => assumptionIds.has(id))
  );
}

/**
 * M3-T2: every deliverable, constraint, and criterion must carry at least one
 * source reference or be covered by resolvable assumptions.
 */
export function findUnsourcedItems(contract: RequirementContract): UnsourcedItems {
  const assumptionIds = new Set(contract.assumptions.map((assumption) => assumption.id));
  const deliverables = contract.deliverables.filter((d) => !isSourced(d, assumptionIds)).map((d) => d.id);
  const constraints = contract.constraints.filter((c) => !isSourced(c, assumptionIds)).map((c) => c.id);
  const acceptanceCriteria = contract.acceptanceCriteria
    .filter((ac) => !isSourced(ac, assumptionIds))
    .map((ac) => ac.id);
  return {
    ok: deliverables.length === 0 && constraints.length === 0 && acceptanceCriteria.length === 0,
    deliverables,
    constraints,
    acceptanceCriteria
  };
}
