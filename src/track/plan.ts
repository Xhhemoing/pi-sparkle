import { DomainValidationError } from "../domain/errors.js";
import { createTaskId, type IdGenerator, type TaskId } from "../domain/ids.js";
import type { AgentRole } from "../domain/roles.js";
import type { RequirementContract } from "../domain/contract.js";
import { namedTargets, shouldScout, type HeuristicHabits } from "../requirement/heuristic.js";

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
 * primary model). Skips implementation for investigation-only answers, and
 * carries the `q-scope` answer into every child objective so the files the
 * operator named bound the work the children are told to do.
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
  const scope = readScopeAnswer(answers["q-scope"], objective);
  const investigationOnly = doneAnswer.includes("investigation") || writeAnswer.includes("investigation");
  const includeTests =
    !investigationOnly &&
    (input.habits?.requireTests === true ||
      input.contract.constraints.some((constraint) => constraint.id === "c-tests") ||
      testsAnswer === "yes" ||
      /\b(tests?|coverage)\b/i.test(objective));
  const includeScout = investigationOnly || scope.deferToScout || shouldScout(objective);
  const includeReviewer = !investigationOnly && input.habits?.preferReview !== false;
  const scoped = (text: string): string =>
    scope.targets === "" ? text : `${text} (scope: ${scope.targets})`;

  const gen = input.generateId;
  const children: PlannedChild[] = [];
  const plannerId = createTaskId(gen);
  children.push({
    taskId: plannerId,
    role: "planner",
    objective: scoped(`Decompose and route: ${objective}`),
    dependsOn: []
  });
  let scoutId: TaskId | undefined;
  if (includeScout) {
    scoutId = createTaskId(gen);
    children.push({
      taskId: scoutId,
      role: "scout",
      objective: scoped(
        investigationOnly
          ? `Investigate without writing files: ${objective}`
          : `Survey the workspace and constraints for: ${objective}`
      ),
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
    objective: scoped(`Implement: ${objective}`),
    dependsOn: scoutId !== undefined ? [scoutId] : [plannerId]
  });
  if (includeReviewer) {
    const reviewId = createTaskId(gen);
    children.push({
      taskId: reviewId,
      role: "reviewer",
      objective: scoped(`Review the change against: ${objective}`),
      dependsOn: [implId]
    });
  }
  if (includeTests) {
    const testId = createTaskId(gen);
    children.push({
      taskId: testId,
      role: "tester",
      objective: scoped(`Verify tests for: ${objective}`),
      dependsOn: [implId]
    });
  }
  return children;
}

interface ScopeAnswer {
  /** Scope text to carry into child objectives; empty when the answer names none. */
  readonly targets: string;
  /** The operator asked for discovery, so the scout node is planned regardless of {@link shouldScout}. */
  readonly deferToScout: boolean;
}

const NO_SCOPE: ScopeAnswer = { targets: "", deferToScout: false };

/**
 * Reads the `q-scope` answer ("Which files or modules should this change
 * touch?"). The question is only asked when the objective names no paths, so
 * the answer is the only place the plan can learn the operator's scope:
 * pasted paths (or any free text) ground every child objective, and the
 * discovery option plans a scout instead. The other two options carry no
 * scope of their own — one points back at the objective's own file names, the
 * other only promises paths the operator has not typed yet.
 */
function readScopeAnswer(answer: string | undefined, objective: string): ScopeAnswer {
  const value = answer?.trim() ?? "";
  if (value === "") return NO_SCOPE;
  const option = value.toLowerCase();
  if (option === "let scout discover them") return { targets: "", deferToScout: true };
  if (option === "i will paste paths") return NO_SCOPE;
  if (option === "the files named in the objective") {
    return { targets: namedTargets(objective).join(", "), deferToScout: false };
  }
  return { targets: value, deferToScout: false };
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
