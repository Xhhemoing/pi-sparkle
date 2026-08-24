import type { AgentRole } from "../domain/roles.js";
import type { TaskId } from "../domain/ids.js";
import { flowchartRoleForAgentRole } from "../graph/compile-children.js";
import {
  createModelRouter,
  type ModelRouter,
  type ModelRouterConfig,
  type RoutingDecision,
  type RoutingLimits
} from "../supervisor/model-router.js";
import { analyzeTask, type TaskAnalysis } from "./analyze-task.js";
import { applyLearnedRouting, type LearnedRoutingPolicy } from "../learning/learned-routing.js";
import {
  pickPreferredModel,
  planAssignmentPolicy,
  type AssignmentPolicyPlan
} from "./assign-plan.js";
import type { PublicPriorSnapshot } from "./public-prior.js";
import { ASSIGN_FEATURE_VERSION } from "./feature-version.js";

export interface AssignableTask {
  readonly taskId: TaskId;
  readonly role: AgentRole;
  readonly objective: string;
  readonly contractRisk?: boolean | undefined;
  readonly contextTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
}

export interface TaskAssignment {
  readonly taskId: TaskId;
  readonly role: AgentRole;
  readonly analysis: TaskAnalysis;
  readonly decision: RoutingDecision;
  readonly allowedModels: readonly string[];
  readonly preferredModel: string;
}

export interface AssignTasksInput {
  readonly tasks: readonly AssignableTask[];
  readonly catalog: ModelRouterConfig;
  readonly remainingTimeMs?: number;
  readonly remainingCostUsd?: number;
  readonly learned?: LearnedRoutingPolicy | undefined;
  readonly prior?: PublicPriorSnapshot | undefined;
}

export { ASSIGN_FEATURE_VERSION } from "./feature-version.js";

const DEFAULT_LIMITS: RoutingLimits = {
  remainingTimeMs: Number.MAX_SAFE_INTEGER
};

/**
 * Live assignment: analyze each task, then apply the R0-equivalent ModelRouter.
 * High-risk / high-complexity / planner work prefers the primary model. Other
 * work uses a frozen public-scene prior when provided, otherwise the cheapest
 * eligible catalog entry. The catalog-invariant policy plan (allow-list and
 * preferred-model tiers) is computed once per batch, not once per task.
 */
export function assignTasks(input: AssignTasksInput): readonly TaskAssignment[] {
  const router = createModelRouter(input.catalog);
  const catalogIds = input.catalog.models.map((model) => model.id);
  const plan = planAssignmentPolicy(router.config.models, catalogIds);
  const limits: RoutingLimits = {
    remainingTimeMs: input.remainingTimeMs ?? DEFAULT_LIMITS.remainingTimeMs,
    ...(input.remainingCostUsd !== undefined ? { remainingCostUsd: input.remainingCostUsd } : {})
  };
  return input.tasks.map((task) =>
    assignPlanned(router, plan, task, limits, input.learned, input.prior)
  );
}

export function assignOne(
  router: ModelRouter,
  catalogIds: readonly string[],
  task: AssignableTask,
  limits: RoutingLimits = DEFAULT_LIMITS,
  learned?: LearnedRoutingPolicy,
  prior?: PublicPriorSnapshot
): TaskAssignment {
  const plan = planAssignmentPolicy(router.config.models, catalogIds);
  return assignPlanned(router, plan, task, limits, learned, prior);
}

function assignPlanned(
  router: ModelRouter,
  plan: AssignmentPolicyPlan,
  task: AssignableTask,
  limits: RoutingLimits,
  learned?: LearnedRoutingPolicy,
  prior?: PublicPriorSnapshot
): TaskAssignment {
  const analysis = analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
  let allowedModels: readonly string[] = [...plan.allowedIds];
  let preferredModel = pickPreferredModel(plan, analysis, prior);
  if (learned !== undefined) {
    const applied = applyLearnedRouting(analysis.family, allowedModels, preferredModel, learned);
    allowedModels = [...applied.allowedModels];
    preferredModel = applied.preferredModel;
  }
  const decision = router.route({
    taskId: task.taskId,
    role: flowchartRoleForAgentRole(task.role),
    complexity: analysis.complexity,
    modelPolicy: { allowedModels, preferredModel },
    approvalRequired: analysis.highRisk,
    highRisk: analysis.highRisk,
    family: analysis.family,
    featureVersion: ASSIGN_FEATURE_VERSION,
    agentRole: task.role,
    requiredCapabilities: analysis.requiredCapabilities,
    ...(analysis.contextTokens !== undefined ? { contextNeeded: analysis.contextTokens } : {}),
    ...(analysis.outputTokens !== undefined ? { outputNeeded: analysis.outputTokens } : {}),
    limits
  });
  return {
    taskId: task.taskId,
    role: task.role,
    analysis,
    decision,
    allowedModels,
    preferredModel
  };
}
