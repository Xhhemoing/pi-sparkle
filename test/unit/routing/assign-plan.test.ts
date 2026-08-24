import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskId } from "../../../src/domain/ids.js";
import { assignOne, assignTasks } from "../../../src/routing/assign.js";
import {
  pickPreferredModel,
  planAssignmentPolicy
} from "../../../src/routing/assign-plan.js";
import { catalogModel, type CatalogModel } from "../../../src/routing/catalog-model.js";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import {
  parsePublicPriorSnapshot,
  pickFromPublicPrior,
  type PublicPriorSnapshot
} from "../../../src/routing/public-prior.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import type { TaskFamily } from "../../../src/task/taxonomy.js";

function model(id: string, cost: number): CatalogModel {
  return catalogModel({
    id,
    version: `${id}-v1`,
    roles: ["actor"],
    maxComplexity: "HIGH",
    estimatedCostUsd: cost,
    estimatedDurationMs: 1_000
  });
}

/**
 * The pre-refactor golden picker: recompute membership and re-sort the
 * catalog on every call, exactly as assign.ts used to inline per task.
 */
function legacyPreferredFrom(
  models: readonly CatalogModel[],
  catalogIds: readonly string[],
  task: { readonly preferPrimary: boolean; readonly family: TaskFamily },
  prior?: PublicPriorSnapshot
): string {
  if (catalogIds.length === 1) return catalogIds[0]!;
  if (task.preferPrimary) {
    const primary = [...models].sort(
      (left, right) => right.estimatedCostUsd - left.estimatedCostUsd
    )[0];
    if (primary !== undefined && catalogIds.includes(primary.id)) return primary.id;
  }
  if (prior !== undefined) {
    const picked = pickFromPublicPrior(
      prior,
      task.family,
      models.filter((entry) => catalogIds.includes(entry.id))
    );
    if (picked !== undefined) return picked.modelId;
  }
  const cheapest = [...models]
    .filter((entry) => catalogIds.includes(entry.id))
    .sort((left, right) => left.estimatedCostUsd - right.estimatedCostUsd)[0];
  return cheapest?.id ?? catalogIds[0]!;
}

/** The pre-refactor golden allow-list: quadratic membership per task. */
function legacyAllowed(models: readonly CatalogModel[], catalogIds: readonly string[]): string[] {
  return catalogIds.filter((id) => models.some((entry) => entry.id === id));
}

function priorSnapshot(qualityBar: number): PublicPriorSnapshot {
  const ts = "2026-08-24T00:00:00.000Z";
  const score = (alias: string, raw: number) => ({
    sourceId: "aider-polyglot" as const,
    modelAliases: [alias],
    raw,
    unit: "pass_rate" as const,
    fetchedAt: ts,
    sourceUrl: "https://aider.chat/docs/leaderboards/"
  });
  return parsePublicPriorSnapshot({
    schemaVersion: 1,
    snapshotId: `pps_plan_${qualityBar}`,
    createdAt: ts,
    qualityBar,
    scores: [score("cheap", 0.8), score("premium", 0.9), score("alpha", 0.7), score("beta", 0.6)]
  });
}

test("plan + pick matches the per-task legacy chain for every catalog, id set, task, and prior", () => {
  const catalogs: readonly (readonly CatalogModel[])[] = [
    [model("cheap", 0.1), model("premium", 0.9)],
    [model("alpha", 0.5), model("beta", 0.5)],
    [model("mid", 0.3), model("cheap", 0.1), model("also-cheap", 0.1), model("dear", 0.9), model("also-dear", 0.9)],
    [model("only", 1)]
  ];
  const tasks: readonly { readonly preferPrimary: boolean; readonly family: TaskFamily }[] = [
    { preferPrimary: true, family: "edit" },
    { preferPrimary: false, family: "edit" },
    { preferPrimary: true, family: "deploy" },
    { preferPrimary: false, family: "plan" },
    { preferPrimary: false, family: "unknown" }
  ];
  const priors: readonly (PublicPriorSnapshot | undefined)[] = [
    undefined,
    priorSnapshot(0),
    priorSnapshot(0.95)
  ];
  for (const models of catalogs) {
    const ids = models.map((entry) => entry.id);
    const idVariants: readonly (readonly string[])[] = [
      ids,
      [...ids].reverse(),
      ids.slice(1),
      ids.slice(0, -1),
      ids.slice(0, 1),
      [...ids, "ghost"],
      ["ghost"],
      ["ghost", "phantom"],
      []
    ];
    for (const catalogIds of idVariants) {
      const plan = planAssignmentPolicy(models, catalogIds);
      assert.deepEqual(plan.allowedIds, legacyAllowed(models, catalogIds));
      for (const task of tasks) {
        for (const prior of priors) {
          const label =
            `catalog=[${ids.join(",")}] ids=[${catalogIds.join(",")}] ` +
            `preferPrimary=${task.preferPrimary} family=${task.family} bar=${prior?.qualityBar ?? "none"}`;
          assert.equal(
            pickPreferredModel(plan, task, prior),
            legacyPreferredFrom(models, catalogIds, task, prior),
            label
          );
        }
      }
    }
  }
});

test("preferred tiers keep the earliest catalog entry on cost ties, regardless of request order", () => {
  const models = [model("alpha", 0.9), model("beta", 0.9), model("cheap", 0.1), model("also-cheap", 0.1)];
  const reversed = planAssignmentPolicy(models, ["also-cheap", "cheap", "beta", "alpha"]);
  assert.equal(pickPreferredModel(reversed, { preferPrimary: true, family: "edit" }), "alpha");
  assert.equal(pickPreferredModel(reversed, { preferPrimary: false, family: "edit" }), "cheap");
});

test("preferPrimary falls through to cheapest when the primary is not requested", () => {
  const models = [model("dear", 0.9), model("mid", 0.5), model("cheap", 0.1)];
  const plan = planAssignmentPolicy(models, ["mid", "cheap"]);
  assert.equal(plan.primaryPreferredId, undefined);
  assert.equal(pickPreferredModel(plan, { preferPrimary: true, family: "edit" }), "cheap");
});

test("a sole requested id short-circuits even when the catalog does not know it", () => {
  const models = [model("dear", 0.9), model("cheap", 0.1)];
  const plan = planAssignmentPolicy(models, ["ghost"]);
  assert.equal(pickPreferredModel(plan, { preferPrimary: true, family: "edit" }), "ghost");
  assert.deepEqual(plan.allowedIds, []);
});

test("an empty catalog intersection falls back to the first requested id", () => {
  const models = [model("dear", 0.9), model("cheap", 0.1)];
  const plan = planAssignmentPolicy(models, ["ghost", "phantom"]);
  assert.equal(pickPreferredModel(plan, { preferPrimary: false, family: "edit" }), "ghost");
});

test("assignTasks with a batch plan equals per-task assignOne exactly", () => {
  const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
  const router = createModelRouter(catalog);
  const catalogIds = catalog.models.map((entry) => entry.id);
  const tasks = [
    { taskId: parseTaskId("tsk_scout"), role: "scout" as const, objective: "Survey the repo" },
    { taskId: parseTaskId("tsk_work"), role: "worker" as const, objective: "Fix the typo in README" },
    {
      taskId: parseTaskId("tsk_prod"),
      role: "implementer" as const,
      objective: "Deploy the checkout flow to production with credential rotation"
    }
  ];
  const batch = assignTasks({ catalog, tasks });
  assert.equal(batch.length, tasks.length);
  batch.forEach((assignment, index) => {
    assert.deepEqual(assignment, assignOne(router, catalogIds, tasks[index]!));
  });
});
