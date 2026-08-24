import type { TaskFamily } from "../task/taxonomy.js";
import type { CatalogModel } from "./catalog-model.js";
import { pickFromPublicPrior, type PublicPriorSnapshot } from "./public-prior.js";

/**
 * Catalog-invariant slice of live assignment. Everything here depends only on
 * the (router catalog, requested catalogIds) pair, so assignTasks computes it
 * once per batch instead of re-deriving membership and re-sorting the catalog
 * for every task. Selection semantics are locked against the original
 * per-task chain by test/unit/routing/assign-plan.test.ts.
 */
export interface AssignmentPolicyPlan {
  /** The requested ids, echoed for the single-model short circuit. */
  readonly catalogIds: readonly string[];
  /** Requested ids that exist in the router catalog, in request order. */
  readonly allowedIds: readonly string[];
  /** Most expensive catalog model when it is requested; preferPrimary target. */
  readonly primaryPreferredId: string | undefined;
  /** Catalog-order models restricted to the requested ids; public-prior pool. */
  readonly assignableModels: readonly CatalogModel[];
  /** Cheapest assignable id, else catalogIds[0] — the legacy last resort. */
  readonly cheapestAssignableId: string;
}

export function planAssignmentPolicy(
  models: readonly CatalogModel[],
  catalogIds: readonly string[]
): AssignmentPolicyPlan {
  const catalog = new Set(models.map((model) => model.id));
  const requested = new Set(catalogIds);
  const primary = [...models].sort(
    (left, right) => right.estimatedCostUsd - left.estimatedCostUsd
  )[0];
  const assignableModels = models.filter((model) => requested.has(model.id));
  const cheapest = [...assignableModels].sort(
    (left, right) => left.estimatedCostUsd - right.estimatedCostUsd
  )[0];
  return {
    catalogIds,
    allowedIds: catalogIds.filter((id) => catalog.has(id)),
    primaryPreferredId:
      primary !== undefined && requested.has(primary.id) ? primary.id : undefined,
    assignableModels,
    cheapestAssignableId: cheapest?.id ?? catalogIds[0]!
  };
}

/**
 * Preferred-model decision procedure, unchanged from the original inline
 * chain: sole requested id → primary when the task prefers it → public-prior
 * pick → cheapest assignable. Ties inside every tier keep catalog order
 * (the stable sorts this plan replaces kept the earliest catalog entry).
 */
export function pickPreferredModel(
  plan: AssignmentPolicyPlan,
  task: { readonly preferPrimary: boolean; readonly family: TaskFamily },
  prior?: PublicPriorSnapshot
): string {
  if (plan.catalogIds.length === 1) return plan.catalogIds[0]!;
  if (task.preferPrimary && plan.primaryPreferredId !== undefined) {
    return plan.primaryPreferredId;
  }
  if (prior !== undefined) {
    const picked = pickFromPublicPrior(prior, task.family, plan.assignableModels);
    if (picked !== undefined) return picked.modelId;
  }
  return plan.cheapestAssignableId;
}
