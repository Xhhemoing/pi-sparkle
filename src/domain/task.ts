import { DomainValidationError } from "./errors.js";
import {
  isArtifactId,
  isEvidenceId,
  isRunId,
  isTaskId,
  type ArtifactId,
  type EvidenceId,
  type RunId,
  type TaskId
} from "./ids.js";
import { isAgentRole, type AgentRole } from "./roles.js";
import { isTaskStatus, type TaskStatus } from "./status.js";

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface TaskNode {
  id: TaskId;
  title: string;
  objective: string;
  role: AgentRole;
  dependencies: TaskId[];
  acceptanceCriteria: AcceptanceCriterion[];
  status: TaskStatus;
  attempt: number;
  maxAttempts: number;
  timeoutMs: number;
  assignedRunId?: RunId;
  artifactIds: ArtifactId[];
  evidenceIds: EvidenceId[];
}

function isAcceptanceCriterion(value: unknown): value is AcceptanceCriterion {
  if (typeof value !== "object" || value === null) return false;
  const criterion = value as Record<string, unknown>;
  return (
    typeof criterion.id === "string" &&
    criterion.id.trim() !== "" &&
    typeof criterion.description === "string" &&
    criterion.description.trim() !== ""
  );
}

function taskNodeError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "expected an object";
  const task = value as Record<string, unknown>;
  if (!isTaskId(task.id)) return "id must be a valid TaskId";
  if (typeof task.title !== "string" || task.title.trim() === "") return "title must be a non-empty string";
  if (typeof task.objective !== "string" || task.objective.trim() === "") {
    return "objective must be a non-empty string";
  }
  if (!isAgentRole(task.role)) return "role must be a known AgentRole";
  if (!Array.isArray(task.dependencies) || !task.dependencies.every(isTaskId)) {
    return "dependencies must be an array of TaskIds";
  }
  if ((task.dependencies as readonly TaskId[]).includes(task.id as TaskId)) {
    return "dependencies must not reference the task itself";
  }
  if (!Array.isArray(task.acceptanceCriteria) || !task.acceptanceCriteria.every(isAcceptanceCriterion)) {
    return "acceptanceCriteria must be an array of {id, description}";
  }
  if (!isTaskStatus(task.status)) return "status must be a known TaskStatus";
  if (typeof task.attempt !== "number" || !Number.isInteger(task.attempt) || task.attempt < 0) {
    return "attempt must be a non-negative integer";
  }
  if (typeof task.maxAttempts !== "number" || !Number.isInteger(task.maxAttempts) || task.maxAttempts < 1) {
    return "maxAttempts must be a positive integer";
  }
  if (typeof task.timeoutMs !== "number" || !Number.isInteger(task.timeoutMs) || task.timeoutMs < 1) {
    return "timeoutMs must be a positive integer";
  }
  if (task.assignedRunId !== undefined && !isRunId(task.assignedRunId)) {
    return "assignedRunId must be a valid RunId";
  }
  if (!Array.isArray(task.artifactIds) || !task.artifactIds.every(isArtifactId)) {
    return "artifactIds must be an array of ArtifactIds";
  }
  if (!Array.isArray(task.evidenceIds) || !task.evidenceIds.every(isEvidenceId)) {
    return "evidenceIds must be an array of EvidenceIds";
  }
  return undefined;
}

export function validateTaskNode(value: unknown): TaskNode {
  const reason = taskNodeError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid TaskNode: ${reason}`);
  }
  return value as TaskNode;
}

export function validateTaskCollection(tasks: readonly TaskNode[]): TaskNode[] {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      throw new DomainValidationError(`Duplicate TaskId in collection: ${task.id}`);
    }
    seen.add(task.id);
  }
  return [...tasks];
}
