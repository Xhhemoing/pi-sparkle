import { applyLearnedRouting, type LearnedRoutingPolicy } from "../learning/learned-routing.js";
import {
  assignStaticTasks, assignStaticOne,
  type StaticAssignTasksInput, type AssignmentPolicyTransform, type AssignableTask, type TaskAssignment
} from "./static-assign.js";
import type { ModelRouter, RoutingLimits } from "../supervisor/model-router.js";
import type { PublicPriorSnapshot } from "./public-prior.js";

export type { AssignableTask, TaskAssignment } from "./static-assign.js";
export { ASSIGN_FEATURE_VERSION } from "./feature-version.js";
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
