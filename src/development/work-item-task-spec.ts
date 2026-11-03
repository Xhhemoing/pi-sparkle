import { DomainValidationError } from "../domain/errors.js";
import { snapshotDevelopmentCheckPlan } from "./check-plan.js";
import { snapshotDevelopmentTaskSpec, snapshotTaskSpecHostArray, snapshotTaskSpecHostInput,
  type DevelopmentTaskCheck, type DevelopmentTaskSpec } from "./task-spec.js";
import { workItemText, type WorkItemDefinition } from "./work-items.js";

export interface WorkItemTaskSpecInput {
  /** A host-selected definition; scheduling/dependencies must be admitted separately. */
  readonly item: WorkItemDefinition;
  readonly context: DevelopmentTaskSpec["context"];
  readonly prepare: DevelopmentTaskSpec["prepare"];
  readonly budget: DevelopmentTaskSpec["budget"];
  readonly checkExpectations: Readonly<Record<string, { readonly expect: DevelopmentTaskCheck["expect"]; readonly visibleToWorker?: boolean }>>;
  readonly requiredWrites?: readonly string[];
  readonly limits?: DevelopmentTaskSpec["limits"];
  readonly worker?: DevelopmentTaskSpec["worker"];
}

const RECIPE_FIELDS = ["id", "command", "args", "verifierVersion", "protectedPaths", "timeoutMs", "maxStdoutBytes", "maxStderrBytes"];
function fail(reason: string): never { throw new DomainValidationError(`work-item TaskSpec: ${reason}`); }

/** Pure experimental authoring; this draft grants no queue or execution authority. */
export function authorTaskSpecFromWorkItem(input: WorkItemTaskSpecInput): { readonly workItemId: string; readonly spec: DevelopmentTaskSpec } {
  const host = snapshotTaskSpecHostInput(input, ["item", "context", "prepare", "budget", "checkExpectations", "requiredWrites", "limits", "worker"]);
  const item = snapshotTaskSpecHostInput(host.item, ["id", "goal", "dependencies", "allowedScope", "priority", "acceptance"]);
  const workItemId = workItemText(item.id, "id", 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(workItemId)) fail("invalid work-item id");
  if (host.context === undefined || host.prepare === undefined) fail("host must explicitly select context and preparation");
  // Snapshot own data before the existing recipe parser reads nested fields.
  const recipes = snapshotTaskSpecHostArray(item.acceptance, 8, 1).map(value => {
    const recipe = snapshotTaskSpecHostInput(value, RECIPE_FIELDS);
    return { ...recipe, args: snapshotTaskSpecHostArray(recipe.args, 64),
      ...(recipe.protectedPaths === undefined ? {} : { protectedPaths: snapshotTaskSpecHostArray(recipe.protectedPaths, 16) }) };
  });
  const plan = snapshotDevelopmentCheckPlan({ checks: recipes });
  const bindings = snapshotTaskSpecHostInput(host.checkExpectations, plan.checks.map(check => check.id));
  const checks = plan.checks.map(check => {
    if (!Object.hasOwn(bindings, check.id)) fail(`missing baseline expectation for check ${check.id}`);
    const binding = snapshotTaskSpecHostInput(bindings[check.id]!, ["expect", "visibleToWorker"]);
    return { ...check, expect: binding.expect,
      ...(binding.visibleToWorker === undefined ? {} : { visibleToWorker: binding.visibleToWorker }) };
  });
  const spec = snapshotDevelopmentTaskSpec({ version: 1, objective: item.goal, context: host.context, prepare: host.prepare,
    write: { allow: item.allowedScope, protect: [...new Set(plan.checks.flatMap(check => check.protectedPaths ?? []))],
      ...(host.requiredWrites === undefined ? {} : { require: host.requiredWrites }) },
    checks, budget: host.budget, ...(host.limits === undefined ? {} : { limits: host.limits }),
    ...(host.worker === undefined ? {} : { worker: host.worker }) });
  return Object.freeze({ workItemId, spec });
}
