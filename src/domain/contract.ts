import { DomainValidationError } from "./errors.js";
import { isRecord } from "./record.js";
import type { TaskId } from "./ids.js";

export interface Deliverable {
  readonly id: string;
  readonly description: string;
  readonly artifactKind: string;
  /** Where this deliverable came from; every item must be sourced or assumed (M3-T2). */
  readonly sourceRefs?: readonly SourceRef[];
  /** Assumption ids (must resolve in contract.assumptions) covering this item. */
  readonly assumptionIds?: readonly string[];
}

export interface Constraint {
  readonly id: string;
  readonly description: string;
  readonly enforceable: boolean;
  readonly sourceRefs?: readonly SourceRef[];
  readonly assumptionIds?: readonly string[];
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly observableCheck: string;
  readonly sourceRefs?: readonly SourceRef[];
  readonly assumptionIds?: readonly string[];
}

export interface Assumption {
  readonly id: string;
  readonly statement: string;
  readonly source: string;
}

export interface DecisionQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: string[];
  readonly default?: string;
}

export interface AuthorityGrant {
  readonly scope: string;
  readonly actions: string[];
  readonly expiresAt?: string;
}

export interface SourceRef {
  readonly kind: "message" | "file" | "git" | "spec";
  readonly ref: string;
  readonly excerpt?: string;
}

export interface RequirementContract {
  readonly schemaVersion: 1;
  readonly objective: string;
  readonly deliverables: readonly Deliverable[];
  readonly constraints: readonly Constraint[];
  readonly nonGoals: readonly string[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly assumptions: readonly Assumption[];
  readonly questions: readonly DecisionQuestion[];
  readonly authority: readonly AuthorityGrant[];
  readonly sourceRefs: readonly SourceRef[];
}

export function validateRequirementContract(input: unknown): RequirementContract {
  if (!isRecord(input)) throw new DomainValidationError("Contract must be an object");
  const {
    schemaVersion,
    objective,
    deliverables,
    constraints,
    nonGoals,
    acceptanceCriteria,
    assumptions,
    questions,
    authority,
    sourceRefs
  } = input as Record<string, unknown>;

  if (schemaVersion !== 1) throw new DomainValidationError("Contract.schemaVersion must be 1");
  if (typeof objective !== "string" || objective.trim() === "") {
    throw new DomainValidationError("Contract.objective must be non-empty");
  }
  if (!Array.isArray(deliverables)) throw new DomainValidationError("deliverables must be array");
  if (!Array.isArray(constraints)) throw new DomainValidationError("constraints must be array");
  if (!Array.isArray(nonGoals)) throw new DomainValidationError("nonGoals must be array");
  if (!Array.isArray(acceptanceCriteria)) throw new DomainValidationError("acceptanceCriteria must be array");
  if (!Array.isArray(assumptions)) throw new DomainValidationError("assumptions must be array");
  if (!Array.isArray(questions)) throw new DomainValidationError("questions must be array");
  if (!Array.isArray(authority)) throw new DomainValidationError("authority must be array");
  if (!Array.isArray(sourceRefs)) throw new DomainValidationError("sourceRefs must be array");

  const provenanceFields = [
    ...deliverables,
    ...constraints,
    ...acceptanceCriteria
  ] as Array<{ sourceRefs?: unknown; assumptionIds?: unknown }>;
  for (const item of provenanceFields) {
    if (item.sourceRefs !== undefined && !Array.isArray(item.sourceRefs)) {
      throw new DomainValidationError("item sourceRefs must be array when present");
    }
    if (
      item.assumptionIds !== undefined &&
      (!Array.isArray(item.assumptionIds) || item.assumptionIds.some((id) => typeof id !== "string"))
    ) {
      throw new DomainValidationError("item assumptionIds must be an array of strings when present");
    }
  }

  return {
    schemaVersion: 1,
    objective,
    deliverables: deliverables as Deliverable[],
    constraints: constraints as Constraint[],
    nonGoals: nonGoals as string[],
    acceptanceCriteria: acceptanceCriteria as AcceptanceCriterion[],
    assumptions: assumptions as Assumption[],
    questions: questions as DecisionQuestion[],
    authority: authority as AuthorityGrant[],
    sourceRefs: sourceRefs as SourceRef[]
  };
}

export interface CoverageMatrix {
  readonly contractVersion: number;
  readonly requirementToTasks: Record<string, readonly TaskId[]>;
  readonly taskToChecks: Record<string, readonly string[]>;
  readonly orphanRequirements: readonly string[];
}

export function validateCoverageMatrix(input: unknown): CoverageMatrix {
  if (!isRecord(input)) throw new DomainValidationError("CoverageMatrix must be an object");
  const { contractVersion, requirementToTasks, taskToChecks, orphanRequirements } = input as Record<string, unknown>;
  if (typeof contractVersion !== "number") throw new DomainValidationError("contractVersion must be number");
  if (!isRecord(requirementToTasks)) throw new DomainValidationError("requirementToTasks must be object");
  if (!isRecord(taskToChecks)) throw new DomainValidationError("taskToChecks must be object");
  if (!Array.isArray(orphanRequirements)) throw new DomainValidationError("orphanRequirements must be array");
  return {
    contractVersion,
    requirementToTasks: requirementToTasks as Record<string, readonly TaskId[]>,
    taskToChecks: taskToChecks as Record<string, readonly string[]>,
    orphanRequirements: orphanRequirements as string[]
  };
}
