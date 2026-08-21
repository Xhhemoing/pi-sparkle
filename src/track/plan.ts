import { DomainValidationError } from "../domain/errors.js";
import { createTaskId, type IdGenerator, type TaskId } from "../domain/ids.js";
import type { AgentRole } from "../domain/roles.js";
import type { RequirementContract } from "../domain/contract.js";
import { shouldScout, type HeuristicHabits } from "../requirement/heuristic.js";

export interface PlannedChild {
  readonly taskId: TaskId;
  readonly role: AgentRole;
  readonly objective: string;
  readonly dependsOn: readonly TaskId[];
}

export interface PlanFromContractInput {
  readonly contract: RequirementContract;
  readonly habits?: HeuristicHabits;
  readonly answers?: Readonly<Record<string, string>>;
  readonly generateId?: IdGenerator;
}

/**
 * Primary-owned split: planner first, then a bounded scout → implement →
 * review → test cluster. The planner node is the split owner (assigned to the
 * primary model). Skips implementation for investigation-only answers.
 */
export function planFromContract(input: PlanFromContractInput): readonly PlannedChild[] {
  const objective = input.contract.objective.trim();
  if (objective === "") {
    throw new DomainValidationError("cannot plan an empty objective");
  }
  const answers = input.answers ?? {};
  const testsAnswer = answers["q-tests"]?.toLowerCase();
  const doneAnswer = answers["q-done"]?.toLowerCase() ?? "";
  const writeAnswer = answers["q-write"]?.toLowerCase() ?? "";
  const investigationOnly = doneAnswer.includes("investigation") || writeAnswer.includes("investigation");
  const includeTests =
    !investigationOnly &&
    (input.habits?.requireTests === true ||
      input.contract.constraints.some((constraint) => constraint.id === "c-tests") ||
      testsAnswer === "yes" ||
      /\b(tests?|coverage)\b/i.test(objective));
  const includeScout = investigationOnly || shouldScout(objective);
  const includeReviewer = !investigationOnly && input.habits?.preferReview !== false;

  const gen = input.generateId;
  const children: PlannedChild[] = [];
  const plannerId = createTaskId(gen);
  children.push({
    taskId: plannerId,
    role: "planner",
    objective: `Decompose and route: ${objective}`,
    dependsOn: []
  });
  let scoutId: TaskId | undefined;
  if (includeScout) {
    scoutId = createTaskId(gen);
    children.push({
      taskId: scoutId,
      role: "scout",
      objective: investigationOnly
        ? `Investigate without writing files: ${objective}`
        : `Survey the workspace and constraints for: ${objective}`,
      dependsOn: [plannerId]
    });
  }
  if (investigationOnly) {
    return children;
  }
  const implId = createTaskId(gen);
  children.push({
    taskId: implId,
    role: "implementer",
    objective: `Implement: ${objective}`,
    dependsOn: scoutId !== undefined ? [scoutId] : [plannerId]
  });
  if (includeReviewer) {
    const reviewId = createTaskId(gen);
    children.push({
      taskId: reviewId,
      role: "reviewer",
      objective: `Review the change against: ${objective}`,
      dependsOn: [implId]
    });
  }
  if (includeTests) {
    const testId = createTaskId(gen);
    children.push({
      taskId: testId,
      role: "tester",
      objective: `Verify tests for: ${objective}`,
      dependsOn: [implId]
    });
  }
  return children;
}

export function acceptanceForRole(
  role: AgentRole,
  contract: RequirementContract
): { id: string; description: string }[] {
  if (role === "scout") {
    const fromContract = contract.acceptanceCriteria
      .filter((criterion) => criterion.id !== "ac-tests")
      .map((criterion) => ({ id: criterion.id, description: criterion.description }));
    return [
      { id: "ac-facts", description: "Report observed files, commands, and risks with paths" },
      ...fromContract
    ];
  }
  if (role === "tester") {
    const tests = contract.acceptanceCriteria.filter(
      (criterion) => criterion.id === "ac-tests" || /\btests?\b/i.test(criterion.description)
    );
    if (tests.length > 0) {
      return tests.map((criterion) => ({ id: criterion.id, description: criterion.description }));
    }
    return [{ id: "ac-tests", description: "Tests ran" }];
  }
  return contract.acceptanceCriteria
    .filter((criterion) => criterion.id !== "ac-tests")
    .map((criterion) => ({ id: criterion.id, description: criterion.description }));
}
