import type { RequirementContract, CoverageMatrix } from "../domain/contract.js";
import { DomainValidationError } from "../domain/errors.js";
import type { TaskId } from "../domain/ids.js";

export interface CoverageGateResult {
  readonly ok: boolean;
  readonly orphans: readonly string[];
  readonly uncoveredCriteria: readonly string[];
  readonly blockingDecisions: readonly string[];
}

export interface CoverageTaskRef {
  readonly id: TaskId;
  readonly acceptanceCriteria: readonly { readonly id: string }[];
}

export interface CoverageStartOptions {
  readonly resolvedQuestionIds?: readonly string[];
}

export function checkCoverageGate(contract: RequirementContract, matrix: CoverageMatrix): CoverageGateResult {
  const orphans = [...matrix.orphanRequirements];
  const uncoveredCriteria: string[] = [];
  const blockingDecisions: string[] = [];

  for (const criterion of contract.acceptanceCriteria) {
    const covered = Object.keys(matrix.requirementToTasks).includes(criterion.id) &&
      (matrix.requirementToTasks[criterion.id]?.length ?? 0) > 0;
    if (!covered) {
      uncoveredCriteria.push(criterion.id);
    }
  }

  for (const q of contract.questions) {
    if (!q.default) {
      blockingDecisions.push(q.id);
    }
  }

  const ok = orphans.length === 0 && uncoveredCriteria.length === 0 && blockingDecisions.length === 0;
  return { ok, orphans, uncoveredCriteria, blockingDecisions };
}

export function isSkipContract(contract: RequirementContract): boolean {
  return contract.assumptions.some((assumption) => assumption.id === "skip-contract");
}

export function coverageMatrixFromTasks(
  contract: RequirementContract,
  tasks: readonly CoverageTaskRef[]
): CoverageMatrix {
  const contractIds = new Set(contract.acceptanceCriteria.map((criterion) => criterion.id));
  const requirementToTasks: Record<string, TaskId[]> = {};
  const taskToChecks: Record<string, string[]> = {};

  for (const task of tasks) {
    const mapped: string[] = [];
    for (const criterion of task.acceptanceCriteria) {
      if (!contractIds.has(criterion.id)) continue;
      mapped.push(criterion.id);
      const owners = requirementToTasks[criterion.id] ?? [];
      owners.push(task.id);
      requirementToTasks[criterion.id] = owners;
    }
    taskToChecks[task.id] = mapped;
  }

  return {
    contractVersion: contract.schemaVersion,
    requirementToTasks,
    taskToChecks,
    orphanRequirements: []
  };
}

export function assertCoverageAllowsStart(
  contract: RequirementContract,
  tasks: readonly CoverageTaskRef[],
  options?: CoverageStartOptions
): void {
  if (isSkipContract(contract)) return;
  const resolved = new Set(options?.resolvedQuestionIds ?? []);
  const gated: RequirementContract = {
    ...contract,
    questions: contract.questions.map((question) => {
      if (question.default !== undefined || !resolved.has(question.id)) return question;
      return { ...question, default: question.options[0] ?? "resolved" };
    })
  };
  const result = checkCoverageGate(gated, coverageMatrixFromTasks(gated, tasks));
  if (result.ok) return;
  const parts = [
    result.uncoveredCriteria.length > 0 ? `uncovered=${result.uncoveredCriteria.join(",")}` : undefined,
    result.blockingDecisions.length > 0 ? `blocking=${result.blockingDecisions.join(",")}` : undefined,
    result.orphans.length > 0 ? `orphans=${result.orphans.join(",")}` : undefined
  ].filter((part): part is string => part !== undefined);
  throw new DomainValidationError(
    `coverage gate blocked start: ${parts.join("; ") || "mandatory criteria uncovered"}`
  );
}
