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
import { pickFromPublicPrior, type PublicPriorSnapshot } from "./public-prior.js";
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
 * eligible catalog entry.
 */
export function assignTasks(input: AssignTasksInput): readonly TaskAssignment[] {
  const router = createModelRouter(input.catalog);
  const catalogIds = input.catalog.models.map((model) => model.id);
  const limits: RoutingLimits = {
    remainingTimeMs: input.remainingTimeMs ?? DEFAULT_LIMITS.remainingTimeMs,
    ...(input.remainingCostUsd !== undefined ? { remainingCostUsd: input.remainingCostUsd } : {})
  };
  return input.tasks.map((task) =>
    assignOne(router, catalogIds, task, limits, input.learned, input.prior)
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
  const analysis = analyzeTask(task.objective, task.role, {
    ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
    ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
    ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
  });
  let allowedModels = catalogIds.filter((id) =>
    router.config.models.some((model) => model.id === id)
  );
  let preferredModel = preferredFrom(analysis, catalogIds, router, prior);
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

function preferredFrom(
  analysis: TaskAnalysis,
  catalogIds: readonly string[],
  router: ModelRouter,
  prior?: PublicPriorSnapshot
): string {
  if (catalogIds.length === 1) return catalogIds[0]!;
  if (analysis.preferPrimary) {
    const primary = [...router.config.models].sort(
      (left, right) => right.estimatedCostUsd - left.estimatedCostUsd
    )[0];
    if (primary !== undefined && catalogIds.includes(primary.id)) return primary.id;
  }
  if (prior !== undefined) {
    const picked = pickFromPublicPrior(
      prior,
      analysis.family,
      router.config.models.filter((model) => catalogIds.includes(model.id))
    );
    if (picked !== undefined) return picked.modelId;
  }
  const cheapest = [...router.config.models]
    .filter((model) => catalogIds.includes(model.id))
    .sort((left, right) => left.estimatedCostUsd - right.estimatedCostUsd)[0];
  return cheapest?.id ?? catalogIds[0]!;
}
