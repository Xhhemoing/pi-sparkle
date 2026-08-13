import { DomainValidationError } from "../domain/errors.js";
import {
  isAgentInstanceId,
  isArtifactId,
  isEvidenceId,
  isMessageId,
  isRunId,
  isTaskId,
  type AgentInstanceId,
  type ArtifactId,
  type EvidenceId,
  type MessageId,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import type { AcceptanceCriterion } from "../domain/task.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";

export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = ["TASK_REQUEST", "PROGRESS", "QUESTION", "TASK_RESULT"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const PROGRESS_STATUSES = ["STARTED", "WORKING", "WAITING", "BLOCKED"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const BLOCKER_KINDS = ["NEEDS_INFO", "DEPENDENCY", "EXTERNAL", "UNKNOWN"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export const TASK_OUTCOMES = ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

export const VERIFICATION_KINDS = ["PASSED", "FAILED", "UNOBSERVED"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const FAILURE_CATEGORIES = ["TIMEOUT", "TOOL_ERROR", "MODEL_ERROR", "VALIDATION", "UNKNOWN"] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Recipient value used when a message targets the coordinating supervisor. */
export const SUPERVISOR = "SUPERVISOR" as const;
export type SupervisorAddress = typeof SUPERVISOR;

export interface MessageBase {
  protocolVersion: 1;
  id: MessageId;
  occurredAt: IsoTimestamp;
  runId: RunId;
  taskId: TaskId;
  from: AgentInstanceId;
  to: AgentInstanceId | SupervisorAddress;
}

export interface ChildRunLimits {
  maxAttempts: number;
  timeoutMs: number;
  maxWallTimeMs: number;
  maxCostUsd?: number;
}

export interface TaskRequest extends MessageBase {
  type: "TASK_REQUEST";
  objective: string;
  inputArtifactIds: ArtifactId[];
  acceptanceCriteria: AcceptanceCriterion[];
  limits: ChildRunLimits;
}

export interface Blocker {
  kind: BlockerKind;
  description: string;
}

export interface ProgressUpdate extends MessageBase {
  type: "PROGRESS";
  status: ProgressStatus;
  summary: string;
  evidenceIds: EvidenceId[];
  blocker?: Blocker;
}

export interface AgentQuestion extends MessageBase {
  type: "QUESTION";
  question: string;
  options?: string[];
}

export interface VerificationResult {
  kind: VerificationKind;
  evidenceIds: EvidenceId[];
}

export interface FailureClassification {
  category: FailureCategory;
  detail?: string;
}

export interface TaskResult extends MessageBase {
  type: "TASK_RESULT";
  outcome: TaskOutcome;
  summary: string;
  artifactIds: ArtifactId[];
  evidenceIds: EvidenceId[];
  verification: VerificationResult;
  failure?: FailureClassification;
}

export type AgentMessage = TaskRequest | ProgressUpdate | AgentQuestion | TaskResult;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isAcceptanceCriterion(value: unknown): value is AcceptanceCriterion {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    typeof value.description === "string" &&
    value.description.trim() !== ""
  );
}

function isChildRunLimits(value: unknown): value is ChildRunLimits {
  if (!isRecord(value)) return false;
  const intFields: Array<keyof ChildRunLimits> = ["maxAttempts", "timeoutMs", "maxWallTimeMs"];
  for (const field of intFields) {
    const n = value[field];
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return false;
  }
  const maxCostUsd = value.maxCostUsd;
  if (maxCostUsd !== undefined && (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0)) {
    return false;
  }
  return true;
}

function isBlocker(value: unknown): value is Blocker {
  if (!isRecord(value)) return false;
  return isOneOf(BLOCKER_KINDS, value.kind) && typeof value.description === "string" && value.description.trim() !== "";
}

function isVerificationResult(value: unknown): value is VerificationResult {
  if (!isRecord(value)) return false;
  return (
    isOneOf(VERIFICATION_KINDS, value.kind) &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.every(isEvidenceId)
  );
}

function isFailureClassification(value: unknown): value is FailureClassification {
  if (!isRecord(value)) return false;
  if (!isOneOf(FAILURE_CATEGORIES, value.category)) return false;
  if (value.detail !== undefined && (typeof value.detail !== "string" || value.detail.trim() === "")) return false;
  return true;
}

function baseError(value: Record<string, unknown>): string | undefined {
  if (value.protocolVersion !== PROTOCOL_VERSION) return "protocolVersion must be 1";
  if (!isMessageId(value.id)) return "id must be a valid MessageId";
  if (!isIsoTimestamp(value.occurredAt)) return "occurredAt must be a valid IsoTimestamp";
  if (!isRunId(value.runId)) return "runId must be a valid RunId";
  if (!isTaskId(value.taskId)) return "taskId must be a valid TaskId";
  if (!isAgentInstanceId(value.from)) return "from must be a valid AgentInstanceId";
  if (value.to !== SUPERVISOR && !isAgentInstanceId(value.to)) {
    return "to must be a valid AgentInstanceId or \"SUPERVISOR\"";
  }
  return undefined;
}

function messageError(value: unknown): string | undefined {
  if (!isRecord(value)) return "expected an object";
  const base = baseError(value);
  if (base !== undefined) return base;
  switch (value.type) {
    case "TASK_REQUEST": {
      if (typeof value.objective !== "string" || value.objective.trim() === "") return "objective must be a non-empty string";
      if (!Array.isArray(value.inputArtifactIds) || !value.inputArtifactIds.every(isArtifactId)) {
        return "inputArtifactIds must be an array of ArtifactIds";
      }
      if (!Array.isArray(value.acceptanceCriteria) || !value.acceptanceCriteria.every(isAcceptanceCriterion)) {
        return "acceptanceCriteria must be an array of {id, description}";
      }
      if (!isChildRunLimits(value.limits)) return "limits must be valid ChildRunLimits";
      return undefined;
    }
    case "PROGRESS": {
      if (!isOneOf(PROGRESS_STATUSES, value.status)) return "status must be a known ProgressStatus";
      if (typeof value.summary !== "string" || value.summary.trim() === "") return "summary must be a non-empty string";
      if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isEvidenceId)) {
        return "evidenceIds must be an array of EvidenceIds";
      }
      if (value.blocker !== undefined && !isBlocker(value.blocker)) {
        return "blocker must be a valid Blocker";
      }
      return undefined;
    }
    case "QUESTION": {
      if (typeof value.question !== "string" || value.question.trim() === "") return "question must be a non-empty string";
      if (value.options !== undefined) {
        if (!Array.isArray(value.options) || value.options.length === 0) return "options must be a non-empty array";
        if (!value.options.every((option) => typeof option === "string" && option.trim() !== "")) {
          return "options must contain non-empty strings";
        }
      }
      return undefined;
    }
    case "TASK_RESULT": {
      if (!isOneOf(TASK_OUTCOMES, value.outcome)) return "outcome must be a known TaskOutcome";
      if (typeof value.summary !== "string" || value.summary.trim() === "") return "summary must be a non-empty string";
      if (!Array.isArray(value.artifactIds) || !value.artifactIds.every(isArtifactId)) {
        return "artifactIds must be an array of ArtifactIds";
      }
      if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isEvidenceId)) {
        return "evidenceIds must be an array of EvidenceIds";
      }
      if (!isVerificationResult(value.verification)) return "verification must be a valid VerificationResult";
      if (value.failure !== undefined && !isFailureClassification(value.failure)) {
        return "failure must be a valid FailureClassification";
      }
      return undefined;
    }
    default:
      return "type must be a known MessageType";
  }
}

export function isAgentMessage(value: unknown): value is AgentMessage {
  return messageError(value) === undefined;
}

export function validateAgentMessage(value: unknown): AgentMessage {
  const reason = messageError(value);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid AgentMessage: ${reason}`);
  }
  return value as AgentMessage;
}

export function isTerminalMessage(message: AgentMessage): message is TaskResult {
  return message.type === "TASK_RESULT";
}

/** Rejects a second terminal message; an agent emits at most one TASK_RESULT. */
export function assertAtMostOneTerminal(messages: readonly AgentMessage[]): void {
  let sawTerminal = false;
  for (const message of messages) {
    if (!isTerminalMessage(message)) continue;
    if (sawTerminal) {
      throw new DomainValidationError("Duplicate terminal TASK_RESULT message");
    }
    sawTerminal = true;
  }
}
