import type { RequirementContract } from "../domain/contract.js";
import type { IdGenerator } from "../domain/ids.js";
import type { LearnedRoutingPolicy } from "../learning/learned-routing.js";
import { assignTasks, type TaskAssignment } from "../routing/assign.js";
import type { PublicPriorSnapshot } from "../routing/public-prior.js";
import type { HeuristicHabits } from "../requirement/heuristic.js";
import type { ModelRouterConfig } from "../supervisor/model-router.js";
import { planFromContract, type PlannedChild } from "./plan.js";

export type PrimarySplitSource = "primary-schema";

export interface PrimarySplitResult {
  readonly source: PrimarySplitSource;
  readonly children: readonly PlannedChild[];
  readonly assignments: readonly TaskAssignment[];
}

export interface SplitAndAssignInput {
  readonly contract: RequirementContract;
  readonly catalog: ModelRouterConfig;
  readonly habits?: HeuristicHabits;
  readonly answers?: Readonly<Record<string, string>>;
  readonly generateId?: IdGenerator;
  readonly learned?: LearnedRoutingPolicy;
  readonly prior?: PublicPriorSnapshot;
}

/**
 * Sends the objective through the primary-owned split schema, then assigns
 * child work with R0 ModelRouter. Live R1 is not used. Fake and live executors
 * share this DAG; a later JSON plan from a live primary must validate to the
 * same PlannedChild shape or fall back here.
 */
export function splitAndAssignForPrimary(input: SplitAndAssignInput): PrimarySplitResult {
  const children = planFromContract({
    contract: input.contract,
    ...(input.habits !== undefined ? { habits: input.habits } : {}),
    ...(input.answers !== undefined ? { answers: input.answers } : {}),
    ...(input.generateId !== undefined ? { generateId: input.generateId } : {})
  });
  const assignments = assignTasks({
    tasks: children.map((child) => ({
      taskId: child.taskId,
      role: child.role,
      objective: child.objective
    })),
    catalog: input.catalog,
    ...(input.learned !== undefined ? { learned: input.learned } : {}),
    ...(input.prior !== undefined ? { prior: input.prior } : {})
  });
  return { source: "primary-schema", children, assignments };
}
