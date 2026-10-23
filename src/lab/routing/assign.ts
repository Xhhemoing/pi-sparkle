import { applyLearnedRouting, type LearnedRoutingPolicy } from "../learning/learned-routing.js";
import {
  assignStaticTasks, assignStaticOne,
  type StaticAssignTasksInput, type AssignmentPolicyTransform, type AssignableTask, type TaskAssignment
} from "../../routing/static-assign.js";
import type { ModelRouter, RoutingLimits } from "../../supervisor/model-router.js";
import type { PublicPriorSnapshot } from "../../routing/public-prior.js";

export type { AssignableTask, TaskAssignment } from "../../routing/static-assign.js";
export { ASSIGN_FEATURE_VERSION } from "../../routing/feature-version.js";
export interface AssignTasksInput extends StaticAssignTasksInput {
  readonly learned?: LearnedRoutingPolicy | undefined;
}
function learnedTransform(learned: LearnedRoutingPolicy | undefined): AssignmentPolicyTransform | undefined {
  if (learned === undefined) return undefined;
  return (analysis, policy) => applyLearnedRouting(analysis.family, policy.allowedModels, policy.preferredModel, learned);
}

/** Explicit legacy learned-policy composition over the shared static implementation. */
export function assignTasks(input: AssignTasksInput): readonly TaskAssignment[] {
  return assignStaticTasks(input, learnedTransform(input.learned));
}
export function assignOne(
  router: ModelRouter,
  catalogIds: readonly string[],
  task: AssignableTask,
  limits?: RoutingLimits,
  learned?: LearnedRoutingPolicy,
  prior?: PublicPriorSnapshot
): TaskAssignment {
  return assignStaticOne(router, catalogIds, task, limits, prior, learnedTransform(learned));
}
