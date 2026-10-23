import type { AssignableTask } from "../routing/assign.js";
import { analyzeTask } from "../routing/analyze-task.js";
import { ASSIGN_FEATURE_VERSION } from "../routing/feature-version.js";
import { flowchartRoleForAgentRole } from "../graph/compile-children.js";
import { createModelRouter } from "../supervisor/model-router.js";
import type { NativeAssignmentPlan } from "./core-session.js";
import type { NativeRoutingCatalog } from "./routing-catalog.js";

export interface HostPinnedAssignmentInput {
  readonly tasks: readonly AssignableTask[];
  readonly catalog: NativeRoutingCatalog;
  readonly pinnedModelId: string;
  readonly remainingTimeMs?: number;
  readonly remainingCostUsd?: number;
}

/** Static host selection still passes through every existing eligibility rule. */
export function assignHostPinnedTasks(input: HostPinnedAssignmentInput): NativeAssignmentPlan {
  const router = createModelRouter(input.catalog.config);
  const assignments = input.tasks.map((task) => {
    const analysis = analyzeTask(task.objective, task.role, {
      ...(task.contractRisk !== undefined ? { contractRisk: task.contractRisk } : {}),
      ...(task.contextTokens !== undefined ? { contextTokens: task.contextTokens } : {}),
      ...(task.outputTokens !== undefined ? { outputTokens: task.outputTokens } : {})
    });
    // Preferred alone permits fallback when the selection is ineligible.
    // A host pin is a hard constraint, not a ranking hint.
    const allowedModels = [input.pinnedModelId];
    const preferredModel = input.pinnedModelId;
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
      privacyRequired: analysis.privacyRequired,
      ...(analysis.contextTokens !== undefined ? { contextNeeded: analysis.contextTokens } : {}),
      ...(analysis.outputTokens !== undefined ? { outputNeeded: analysis.outputTokens } : {}),
      limits: {
        remainingTimeMs: input.remainingTimeMs ?? Number.MAX_SAFE_INTEGER,
        ...(input.remainingCostUsd !== undefined ? { remainingCostUsd: input.remainingCostUsd } : {})
      }
    });
    return { taskId: task.taskId, role: task.role, analysis, decision, allowedModels, preferredModel };
  });
  return { assignments, requiredModelIds: input.catalog.config.models.map((model) => model.id) };
}
