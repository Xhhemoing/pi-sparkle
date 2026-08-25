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
import {
  isConfidenceScore,
  validateApprovalPlan,
  validateApprovalReplyAgainstPlan,
  validateApprovalReplyShape,
  type ApprovalPlan,
  type ApprovalReply,
  type ConfidenceScore
} from "../domain/flowchart.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import type { AcceptanceCriterion } from "../domain/task.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";

export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = [
  "TASK_REQUEST",
  "PROGRESS",
  "QUESTION",
  "PEER_MESSAGE",
  "TASK_RESULT"
] as const;
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

/**
 * Per-child budget carried on a TASK_REQUEST. Shape validation here is not
 * enforcement: `maxAttempts`, `timeoutMs`, and `maxWallTimeMs` are read and
 * honored by `run/child-coordinator.ts`; `maxCostUsd` is not (see below).
 */
export interface ChildRunLimits {
  maxAttempts: number;
  timeoutMs: number;
  maxWallTimeMs: number;
  /**
   * Declared cost ceiling in USD. Validated for shape but **not enforced** at
   * the child level: no component stops or fails a child run for exceeding it.
   * Spend is not derivable where the child runs — the executor stream reports
   * token usage only (`TURN_FINISHED.usage`), and no price catalog is
   * populated behind it (`ModelInvocation.pricing` in
   * `telemetry/model-invocation.ts` is optional and never filled in), so a
   * ceiling here could only be enforced by first building model pricing. The
   * one cost gate that does run is the experiments plane's own
   * `thresholds.maxCostUsd` (`experiments/shadow.ts`), fed by externally
   * supplied per-outcome costs; it never reads this field.
   */
  maxCostUsd?: number;
}

export interface TaskRequest extends MessageBase {
  type: "TASK_REQUEST";
  objective: string;
  inputArtifactIds: ArtifactId[];
  acceptanceCriteria: AcceptanceCriterion[];
  limits: ChildRunLimits;
  approvalPlan?: ApprovalPlan;
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
  confidence?: ConfidenceScore;
  rationale?: string;
  approvalPlan?: ApprovalPlan;
}

/**
 * One acceptance criterion's own outcome, inside the verdict that reported it.
 *
 * `id` is not correlated against the task's `TASK_REQUEST` here: this validator
 * never sees the request, so correlation belongs to the tracking layer, where
 * an id nobody asked for is ignored rather than fatal — a reporting slip must
 * not destroy an otherwise sound result.
 *
 * A `FAILED` criterion must cite at least one evidence id, the same rule
 * `tracking/types.ts` already enforces on a FAIL dimension. A criterion failure
 * that gates a run has to be auditable back to something, and the alternative —
 * accepting it unreferenced — is a verdict that vanishes between here and the
 * gate, because `assessChildObservation` discards an unreferenced FAIL.
 */
export interface CriterionVerification {
  id: string;
  kind: VerificationKind;
  evidenceIds: EvidenceId[];
}

export interface VerificationResult {
  kind: VerificationKind;
  evidenceIds: EvidenceId[];
  /**
   * Per-criterion outcomes, when the verifier reported any. Absent means the
   * verifier spoke only about the task as a whole, and absence keeps exactly
   * the meaning it had before this field existed — every log written without
   * it still says what it always said.
   *
   * Optional rather than a `PROTOCOL_VERSION` bump on purpose: `messageError`
   * does not reject unknown keys, so this is additive-compatible in both
   * directions, while a bump would invalidate every persisted `CHILD_MESSAGE`
   * payload on an append-only log. When present it must be non-empty — two
   * spellings of "nothing" is how a channel rots — and its ids unique, because
   * a repeated id is a protocol violation, not a last-wins merge.
   *
   * `UNOBSERVED` is expressible per criterion and means "the verifier did not
   * look at this one", which is a different fact from omitting the criterion
   * and a different fact again from `FAILED`. Only `FAILED` gates
   * (`tracking/gates.ts::unmet-acceptance-criterion`).
   */
  criteria?: CriterionVerification[];
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

/** Peer-to-peer cluster message. Role-cast uses to=SUPERVISOR plus addressRole. */
export interface PeerMessage extends MessageBase {
  type: "PEER_MESSAGE";
  body: string;
  addressRole?: AgentRole;
  inReplyTo?: MessageId;
  topic?: string;
}

export type AgentMessage = TaskRequest | ProgressUpdate | AgentQuestion | PeerMessage | TaskResult;

export type { ApprovalPlan, ApprovalReply } from "../domain/flowchart.js";

/**
 * Validates a reply's own shape. Callers holding the authoritative plan must
 * additionally use {@link validateApprovalReplyForPlan}, because a subset can
 * only be judged against persisted state.
 */
export function validateApprovalReply(value: unknown): ApprovalReply {
  return validateApprovalReplyShape(value);
}

export function isApprovalReply(value: unknown): value is ApprovalReply {
  try {
    validateApprovalReplyShape(value);
    return true;
  } catch {
    return false;
  }
}

/** Correlates a reply with the authoritative plan it claims to answer. */
export function validateApprovalReplyForPlan(plan: unknown, reply: unknown): ApprovalReply {
  return validateApprovalReplyAgainstPlan(plan, reply);
}

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

function isCriterionVerification(value: unknown): value is CriterionVerification {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.trim() === "") return false;
  if (!isOneOf(VERIFICATION_KINDS, value.kind)) return false;
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isEvidenceId)) return false;
  if (value.kind === "FAILED" && value.evidenceIds.length === 0) return false;
  return true;
}

function isVerificationResult(value: unknown): value is VerificationResult {
  if (!isRecord(value)) return false;
  if (!isOneOf(VERIFICATION_KINDS, value.kind)) return false;
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(isEvidenceId)) return false;
  if (value.criteria === undefined) return true;
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) return false;
  if (!value.criteria.every(isCriterionVerification)) return false;
  const ids = new Set(value.criteria.map((criterion: CriterionVerification) => criterion.id));
  return ids.size === value.criteria.length;
}

function isFailureClassification(value: unknown): value is FailureClassification {
  if (!isRecord(value)) return false;
  if (!isOneOf(FAILURE_CATEGORIES, value.category)) return false;
  if (value.detail !== undefined && (typeof value.detail !== "string" || value.detail.trim() === "")) return false;
  return true;
}

function isApprovalPlan(value: unknown): value is ApprovalPlan {
  try {
    validateApprovalPlan(value);
    return true;
  } catch {
    return false;
  }
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
      if (value.approvalPlan !== undefined && !isApprovalPlan(value.approvalPlan)) {
        return "approvalPlan must be a valid ApprovalPlan";
      }
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
      if (value.confidence !== undefined && !isConfidenceScore(value.confidence)) {
        return "confidence must be a finite number between 0 and 1";
      }
      if (value.rationale !== undefined && (typeof value.rationale !== "string" || value.rationale.trim() === "")) {
        return "rationale must be a non-empty string";
      }
      if (value.approvalPlan !== undefined && !isApprovalPlan(value.approvalPlan)) {
        return "approvalPlan must be a valid ApprovalPlan";
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
    case "PEER_MESSAGE": {
      if (typeof value.body !== "string" || value.body.trim() === "") return "body must be a non-empty string";
      if (value.addressRole !== undefined && !isAgentRole(value.addressRole)) {
        return "addressRole must be a known AgentRole";
      }
      if (value.inReplyTo !== undefined && !isMessageId(value.inReplyTo)) {
        return "inReplyTo must be a valid MessageId";
      }
      if (value.topic !== undefined && (typeof value.topic !== "string" || value.topic.trim() === "")) {
        return "topic must be a non-empty string";
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

/**
 * Rejects a second terminal message; an agent emits at most one TASK_RESULT.
 * This is the whole-transcript check, used where a batch of messages arrives
 * at once. A live coordinator that sees messages one at a time enforces the
 * same invariant incrementally (see `AttemptTranscript` in
 * `run/child-coordinator.ts`) rather than re-scanning the prefix per message.
 */
export function assertAtMostOneTerminal(messages: readonly AgentMessage[]): void {
  let sawTerminal = false;
  for (const value of messages) {
    const message = validateAgentMessage(value);
    if (!isTerminalMessage(message)) continue;
    if (sawTerminal) {
      throw new DomainValidationError("Duplicate terminal TASK_RESULT message");
    }
    sawTerminal = true;
  }
}
