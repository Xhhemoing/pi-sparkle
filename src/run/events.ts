import { DomainValidationError, type RoutingRefusal } from "../domain/errors.js";
import {
  isAgentInstanceId,
  isEventId,
  isMessageId,
  isRunId,
  isTaskId,
  isEpisodeId,
  type AgentInstanceId,
  type EventId,
  type MessageId,
  type RunId,
  type TaskId,
  type EpisodeId
} from "../domain/ids.js";
import { validateProjectSnapshot } from "../domain/project.js";
import { isRecord } from "../domain/record.js";
import { validateRun } from "../domain/run.js";
import { isTaskStatus } from "../domain/status.js";
import { validateTaskNode } from "../domain/task.js";
import { isIsoTimestamp, type IsoTimestamp } from "../domain/timestamp.js";
import { validateAgentMessage, type AgentMessage } from "../protocol/v1.js";
import type { ProjectEpisode } from "../domain/episode.js";
import {
  isConfidenceScore,
  validateApprovalPlan,
  validateApprovalReplyShape,
  type ApprovalPlan,
  type ApprovalReply,
  type ConfidenceScore,
  type FlowchartNodeRole,
  type TaskComplexity
} from "../domain/flowchart.js";
import { isAgentRole, type AgentRole } from "../domain/roles.js";
import { injectionPayloadError } from "./injection.js";
import { hashAssessment, parseTrackingAssessment, type TrackingAssessment } from "../tracking/types.js";

export const EVENT_TYPES = [
  "PROJECT_DISCOVERED",
  "RUN_CREATED",
  "RUN_STARTED",
  "AGENT_STARTED",
  "AGENT_EVENT",
  "AGENT_FINISHED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_CANCEL_REQUESTED",
  "CHILD_RUN_CREATED",
  "CHILD_MESSAGE",
  "TASK_TIMEOUT",
  "TASK_RETRY",
  "RUN_WAITING_FOR_USER",
  "USER_ANSWER",
  "TASK_GRAPH_ACCEPTED",
  "TASK_LEASED",
  "TASK_LEASE_EXPIRED",
  "TASK_STATUS_CHANGED",
  "LEDGER_UPDATED",
  "STALL_DETECTED",
  "JUDGE_DECISION",
  "MODEL_ROUTED",
  "RUN_BLOCKED",
  "PAUSE_REQUESTED",
  "PAUSE_CLEARED",
  "INJECTION_REQUESTED",
  "EPISODE_OPENED",
  "RUN_ATTACHED",
  "EPISODE_WAITING",
  "EPISODE_CLOSED",
  "TRACKING_ASSESSMENT",
  "GATE_TRANSITION"
] as const;

export type M0EventType = (typeof EVENT_TYPES)[number];

export const AGENT_EVENT_KINDS = ["TEXT_DELTA", "TOOL_STARTED", "TOOL_FINISHED", "TURN_FINISHED"] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export const AGENT_OUTCOMES = ["SUCCESS", "FAILURE", "CANCELLED"] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

export type EmptyPayload = Record<string, never>;

export type GateDirective = "none" | "repair_check" | "wait_user" | "queue_analysis";

export type GateRunStatus = "RUNNING" | "WAITING_FOR_USER" | "BLOCKED";

const GATE_DIRECTIVES: readonly GateDirective[] = ["none", "repair_check", "wait_user", "queue_analysis"];

const GATE_RUN_STATUSES: readonly GateRunStatus[] = ["RUNNING", "WAITING_FOR_USER", "BLOCKED"];

export function isGateDirective(value: unknown): value is GateDirective {
  return typeof value === "string" && (GATE_DIRECTIVES as readonly string[]).includes(value);
}

export function isGateRunStatus(value: unknown): value is GateRunStatus {
  return typeof value === "string" && (GATE_RUN_STATUSES as readonly string[]).includes(value);
}

export interface ProjectDiscoveredPayload {
  project: import("../domain/project.js").ProjectSnapshot;
}

export interface RunCreatedPayload {
  run: import("../domain/run.js").Run;
}

export interface AgentStartedPayload {
  agentInstanceId: AgentInstanceId;
  taskId: TaskId;
}

export interface AgentEventPayload {
  agentInstanceId: AgentInstanceId;
  kind: AgentEventKind;
  summary: string;
}

export interface AgentFinishedPayload {
  agentInstanceId: AgentInstanceId;
  outcome: AgentOutcome;
}

export interface RunFailedPayload {
  reason: string;
}

export interface ChildRunCreatedPayload {
  childRun: import("../domain/run.js").Run;
}

export interface ChildMessagePayload {
  message: AgentMessage;
}

export interface TaskTimeoutPayload {
  childRunId: RunId;
  attempt: number;
}

export interface TaskRetryPayload {
  childRunId: RunId;
  attempt: number;
  reason: string;
  previousModel?: string;
  nextModel?: string;
  nextModelVersion?: string;
}

/**
 * The authoritative record of what the user was asked to approve. Replies are
 * correlated against this plan, never against a plan supplied by the client.
 */
export interface RunWaitingForUserPayload {
  messageId: MessageId;
  approvalPlan?: ApprovalPlan;
}

export const ANSWER_SOURCES = ["user", "assume-defaults-auto"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export function isAnswerSource(value: unknown): value is AnswerSource {
  return typeof value === "string" && (ANSWER_SOURCES as readonly string[]).includes(value);
}

export interface UserAnswerPayload {
  messageId: MessageId;
  answer: string;
  approvalReply?: ApprovalReply;
  /**
   * Who satisfied the gate. Absent on pre-increment logs (legacy; do not
   * fail closed). `assume-defaults-auto` is flag-sourced consent, not a human.
   */
  answeredBy?: AnswerSource;
}

export interface TaskGraphAcceptedPayload {
  tasks: import("../domain/task.js").TaskNode[];
}

export interface TaskLeasedPayload {
  taskId: TaskId;
  childRunId: RunId;
  expiresAt: IsoTimestamp;
}

export interface TaskLeaseExpiredPayload {
  taskId: TaskId;
  childRunId: RunId;
}

export interface TaskStatusChangedPayload {
  taskId: TaskId;
  status: import("../domain/status.js").TaskStatus;
  attempt: number;
}

export interface LedgerUpdatedPayload {
  revision: number;
  round: number;
  consecutiveStalls: number;
  isBlocked: boolean;
}

export interface StallDetectedPayload {
  round: number;
  consecutiveStalls: number;
  requiredEvidence: string[];
}

export interface JudgeDecisionPayload {
  taskId: TaskId;
  verdict: "APPROVED" | "REJECTED" | "NEEDS_USER_DECISION";
  evidenceIds: import("../domain/ids.js").EvidenceId[];
  reason?: string;
}

export interface ModelRoutedPayload {
  taskId: TaskId;
  role: FlowchartNodeRole;
  complexity: TaskComplexity;
  model: string;
  justification: string;
  /** Cold-start lookup score. Not a calibrated probability. */
  confidence: ConfidenceScore;
  coldStartRoutingScore?: ConfidenceScore;
  approvalPlan: ApprovalPlan;
  statusAfterRoute: "RUNNING" | "WAITING_FOR_USER";
  policyVersion: string;
  estimatedCostUsd: number;
  estimatedDurationMs: number;
  family: string;
  featureVersion: string;
  modelVersion: string;
  highRisk: boolean;
  eligibleModels: readonly string[];
  rejections: readonly RoutingRefusal[];
  behaviorDistribution: Readonly<Record<string, number>>;
  agentRole?: AgentRole;
}

export interface RunBlockedPayload {
  reason: string;
  requiredEvidence: string[];
}

export interface PauseRequestedPayload {
  reason?: string;
}

export interface InjectionRequestedPayload {
  kind: "fact" | "override" | "skip";
  actor: string;
  confidence: number;
  nodeId?: string;
  key?: string;
  value?: string | number | boolean;
}

export interface EpisodeOpenedPayload {
  episode: ProjectEpisode;
}

export interface EpisodeClosedPayload {
  episodeId: EpisodeId;
  status: import("../domain/episode.js").EpisodeStatus;
  closedAt: IsoTimestamp;
  outcomeId?: string;
}

export interface RunAttachedPayload {
  episodeId: EpisodeId;
  runId: RunId;
  attachedAt: IsoTimestamp;
}

export interface EpisodeWaitingPayload {
  episodeId: EpisodeId;
  reason: string;
  requiredEvidence: string[];
}

export interface TrackingAssessmentPayload {
  assessment: TrackingAssessment;
  assessmentHash: string;
  seq: number;
}

export interface GateTransitionPayload {
  transitionId: string;
  episodeId: string;
  turnId: string;
  seq: number;
  from: GateRunStatus;
  to: GateRunStatus;
  reasonCode: string;
  assessmentHash: string;
  evidenceRefs: readonly string[];
  policyVersion: string;
  idempotencyKey: string;
  directive: GateDirective;
}

export interface EventBase {
  id: EventId;
  schemaVersion: 1;
  occurredAt: IsoTimestamp;
  runId: RunId;
  taskId?: TaskId;
  type: M0EventType;
  actor: string;
}

export type Event =
  | (EventBase & { type: "PROJECT_DISCOVERED"; payload: ProjectDiscoveredPayload })
  | (EventBase & { type: "RUN_CREATED"; payload: RunCreatedPayload })
  | (EventBase & { type: "RUN_STARTED"; payload: EmptyPayload })
  | (EventBase & { type: "AGENT_STARTED"; payload: AgentStartedPayload })
  | (EventBase & { type: "AGENT_EVENT"; payload: AgentEventPayload })
  | (EventBase & { type: "AGENT_FINISHED"; payload: AgentFinishedPayload })
  | (EventBase & { type: "RUN_COMPLETED"; payload: EmptyPayload })
  | (EventBase & { type: "RUN_FAILED"; payload: RunFailedPayload })
  | (EventBase & { type: "RUN_CANCEL_REQUESTED"; payload: EmptyPayload })
  | (EventBase & { type: "CHILD_RUN_CREATED"; payload: ChildRunCreatedPayload })
  | (EventBase & { type: "CHILD_MESSAGE"; payload: ChildMessagePayload })
  | (EventBase & { type: "TASK_TIMEOUT"; payload: TaskTimeoutPayload })
  | (EventBase & { type: "TASK_RETRY"; payload: TaskRetryPayload })
  | (EventBase & { type: "RUN_WAITING_FOR_USER"; payload: RunWaitingForUserPayload })
  | (EventBase & { type: "USER_ANSWER"; payload: UserAnswerPayload })
  | (EventBase & { type: "TASK_GRAPH_ACCEPTED"; payload: TaskGraphAcceptedPayload })
  | (EventBase & { type: "TASK_LEASED"; payload: TaskLeasedPayload })
  | (EventBase & { type: "TASK_LEASE_EXPIRED"; payload: TaskLeaseExpiredPayload })
  | (EventBase & { type: "TASK_STATUS_CHANGED"; payload: TaskStatusChangedPayload })
  | (EventBase & { type: "LEDGER_UPDATED"; payload: LedgerUpdatedPayload })
  | (EventBase & { type: "STALL_DETECTED"; payload: StallDetectedPayload })
  | (EventBase & { type: "JUDGE_DECISION"; payload: JudgeDecisionPayload })
  | (EventBase & { type: "MODEL_ROUTED"; payload: ModelRoutedPayload })
  | (EventBase & { type: "RUN_BLOCKED"; payload: RunBlockedPayload })
  | (EventBase & { type: "PAUSE_REQUESTED"; payload: PauseRequestedPayload })
  | (EventBase & { type: "PAUSE_CLEARED"; payload: EmptyPayload })
  | (EventBase & { type: "INJECTION_REQUESTED"; payload: InjectionRequestedPayload })
  | (EventBase & { type: "EPISODE_OPENED"; payload: EpisodeOpenedPayload })
  | (EventBase & { type: "EPISODE_CLOSED"; payload: EpisodeClosedPayload })
  | (EventBase & { type: "RUN_ATTACHED"; payload: RunAttachedPayload })
  | (EventBase & { type: "EPISODE_WAITING"; payload: EpisodeWaitingPayload })
  | (EventBase & { type: "TRACKING_ASSESSMENT"; payload: TrackingAssessmentPayload })
  | (EventBase & { type: "GATE_TRANSITION"; payload: GateTransitionPayload });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRoutingRefusal(value: unknown): value is RoutingRefusal {
  return (
    isRecord(value) &&
    typeof value.modelId === "string" &&
    value.modelId.trim() !== "" &&
    typeof value.constraint === "string" &&
    value.constraint.trim() !== "" &&
    typeof value.detail === "string"
  );
}

function isBehaviorDistribution(
  value: unknown,
  eligible: readonly string[],
  selected: string
): value is Readonly<Record<string, number>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== eligible.length) return false;
  const eligibleSet = new Set(eligible);
  let selectedMass = 0;
  for (const key of keys) {
    if (!eligibleSet.has(key)) return false;
    const p = value[key];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return false;
    if (key === selected) selectedMass = p;
    else if (p !== 0) return false;
  }
  return selectedMass === 1 && eligibleSet.has(selected);
}

export function routingContextFields(source: {
  readonly family: string;
  readonly featureVersion: string;
  readonly modelVersion: string;
  readonly highRisk: boolean;
  readonly eligibleModels: readonly string[];
  readonly rejections: readonly RoutingRefusal[];
  readonly behaviorDistribution: Readonly<Record<string, number>>;
  readonly agentRole?: AgentRole | undefined;
  readonly coldStartRoutingScore?: ConfidenceScore | undefined;
}): Pick<
  ModelRoutedPayload,
  | "family"
  | "featureVersion"
  | "modelVersion"
  | "highRisk"
  | "eligibleModels"
  | "rejections"
  | "behaviorDistribution"
> &
  Partial<Pick<ModelRoutedPayload, "agentRole" | "coldStartRoutingScore">> {
  return {
    family: source.family,
    featureVersion: source.featureVersion,
    modelVersion: source.modelVersion,
    highRisk: source.highRisk,
    eligibleModels: source.eligibleModels,
    rejections: source.rejections,
    behaviorDistribution: source.behaviorDistribution,
    ...(source.agentRole !== undefined ? { agentRole: source.agentRole } : {}),
    ...(source.coldStartRoutingScore !== undefined
      ? { coldStartRoutingScore: source.coldStartRoutingScore }
      : {})
  };
}

function isEmptyPayload(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).length === 0;
}

function payloadError(type: M0EventType, payload: unknown): string | undefined {
  if (!isRecord(payload)) return "payload must be an object";
  switch (type) {
    case "PROJECT_DISCOVERED": {
      if (payload.project === undefined) return "payload.project is required";
      try {
        validateProjectSnapshot(payload.project);
      } catch (error) {
        return `payload.project: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "RUN_CREATED": {
      if (payload.run === undefined) return "payload.run is required";
      try {
        validateRun(payload.run);
      } catch (error) {
        return `payload.run: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "RUN_STARTED":
    case "RUN_COMPLETED":
    case "RUN_CANCEL_REQUESTED":
      return isEmptyPayload(payload) ? undefined : "payload must be an empty object";
    case "AGENT_STARTED": {
      if (!isAgentInstanceId(payload.agentInstanceId)) return "payload.agentInstanceId must be a valid AgentInstanceId";
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      return undefined;
    }
    case "AGENT_EVENT": {
      if (!isAgentInstanceId(payload.agentInstanceId)) return "payload.agentInstanceId must be a valid AgentInstanceId";
      if (!(AGENT_EVENT_KINDS as readonly string[]).includes(String(payload.kind))) {
        return "payload.kind must be a known AgentEventKind";
      }
      if (typeof payload.summary !== "string" || payload.summary.trim() === "") {
        return "payload.summary must be a non-empty string";
      }
      return undefined;
    }
    case "AGENT_FINISHED": {
      if (!isAgentInstanceId(payload.agentInstanceId)) return "payload.agentInstanceId must be a valid AgentInstanceId";
      if (!(AGENT_OUTCOMES as readonly string[]).includes(String(payload.outcome))) {
        return "payload.outcome must be a known AgentOutcome";
      }
      return undefined;
    }
    case "RUN_FAILED": {
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
        return "payload.reason must be a non-empty string";
      }
      return undefined;
    }
    case "CHILD_RUN_CREATED": {
      if (payload.childRun === undefined) return "payload.childRun is required";
      try {
        validateRun(payload.childRun);
      } catch (error) {
        return `payload.childRun: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "CHILD_MESSAGE": {
      try {
        validateAgentMessage(payload.message);
      } catch (error) {
        return `payload.message: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "TASK_TIMEOUT": {
      if (!isRunId(payload.childRunId)) return "payload.childRunId must be a valid RunId";
      if (typeof payload.attempt !== "number" || !Number.isInteger(payload.attempt) || payload.attempt < 1) {
        return "payload.attempt must be a positive integer";
      }
      return undefined;
    }
    case "TASK_RETRY": {
      if (!isRunId(payload.childRunId)) return "payload.childRunId must be a valid RunId";
      if (typeof payload.attempt !== "number" || !Number.isInteger(payload.attempt) || payload.attempt < 1) {
        return "payload.attempt must be a positive integer";
      }
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
        return "payload.reason must be a non-empty string";
      }
      for (const key of ["previousModel", "nextModel", "nextModelVersion"] as const) {
        const value = payload[key];
        if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
          return `payload.${key} must be a non-empty string when present`;
        }
      }
      return undefined;
    }
    case "RUN_WAITING_FOR_USER": {
      if (!isMessageId(payload.messageId)) return "payload.messageId must be a valid MessageId";
      if (payload.approvalPlan !== undefined) {
        try {
          validateApprovalPlan(payload.approvalPlan);
        } catch (error) {
          return `payload.approvalPlan: ${messageOf(error)}`;
        }
      }
      return undefined;
    }
    case "USER_ANSWER": {
      if (!isMessageId(payload.messageId)) return "payload.messageId must be a valid MessageId";
      if (typeof payload.answer !== "string" || payload.answer.trim() === "") {
        return "payload.answer must be a non-empty string";
      }
      if ("approvalPlan" in payload) {
        return "payload must not include approvalPlan; replies reference a plan by id only";
      }
      // Only the reply shape can be checked statically. Whether the selection
      // is a legal subset depends on the plan persisted with
      // RUN_WAITING_FOR_USER, so callers must correlate it separately with
      // validateApprovalReplyAgainstPlan.
      if (payload.approvalReply !== undefined) {
        try {
          validateApprovalReplyShape(payload.approvalReply);
        } catch (error) {
          return `payload.approvalReply: ${messageOf(error)}`;
        }
      }
      if (payload.answeredBy !== undefined && !isAnswerSource(payload.answeredBy)) {
        return "payload.answeredBy must be user or assume-defaults-auto when present";
      }
      return undefined;
    }
    case "TASK_GRAPH_ACCEPTED": {
      if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
        return "payload.tasks must be a non-empty array";
      }
      try {
        for (const task of payload.tasks) validateTaskNode(task);
      } catch (error) {
        return `payload.tasks: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "TASK_LEASED": {
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      if (!isRunId(payload.childRunId)) return "payload.childRunId must be a valid RunId";
      if (!isIsoTimestamp(payload.expiresAt)) return "payload.expiresAt must be a valid IsoTimestamp";
      return undefined;
    }
    case "TASK_LEASE_EXPIRED": {
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      if (!isRunId(payload.childRunId)) return "payload.childRunId must be a valid RunId";
      return undefined;
    }
    case "TASK_STATUS_CHANGED": {
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      if (!isTaskStatus(payload.status)) return "payload.status must be a known TaskStatus";
      if (typeof payload.attempt !== "number" || !Number.isInteger(payload.attempt) || payload.attempt < 0) {
        return "payload.attempt must be a non-negative integer";
      }
      return undefined;
    }
    case "LEDGER_UPDATED": {
      if (typeof payload.revision !== "number" || !Number.isInteger(payload.revision) || payload.revision < 0) {
        return "payload.revision must be a non-negative integer";
      }
      if (typeof payload.round !== "number" || !Number.isInteger(payload.round) || payload.round < 0) {
        return "payload.round must be a non-negative integer";
      }
      if (typeof payload.consecutiveStalls !== "number" || !Number.isInteger(payload.consecutiveStalls) || payload.consecutiveStalls < 0) {
        return "payload.consecutiveStalls must be a non-negative integer";
      }
      if (typeof payload.isBlocked !== "boolean") return "payload.isBlocked must be a boolean";
      return undefined;
    }
    case "STALL_DETECTED": {
      if (typeof payload.round !== "number" || !Number.isInteger(payload.round) || payload.round < 1) {
        return "payload.round must be a positive integer";
      }
      if (typeof payload.consecutiveStalls !== "number" || !Number.isInteger(payload.consecutiveStalls) || payload.consecutiveStalls < 1) {
        return "payload.consecutiveStalls must be a positive integer";
      }
      if (!Array.isArray(payload.requiredEvidence) || !payload.requiredEvidence.every((e) => typeof e === "string" && e !== "")) {
        return "payload.requiredEvidence must be an array of non-empty strings";
      }
      return undefined;
    }
    case "JUDGE_DECISION": {
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      const verdicts = ["APPROVED", "REJECTED", "NEEDS_USER_DECISION"];
      if (typeof payload.verdict !== "string" || !verdicts.includes(payload.verdict)) {
        return "payload.verdict must be a known verdict";
      }
      if (
        !Array.isArray(payload.evidenceIds) ||
        !payload.evidenceIds.every((id) => typeof id === "string" && id.startsWith("evd_"))
      ) {
        return "payload.evidenceIds must be an array of EvidenceIds";
      }
      if (payload.reason !== undefined && (typeof payload.reason !== "string" || payload.reason.trim() === "")) {
        return "payload.reason must be a non-empty string";
      }
      return undefined;
    }
    case "MODEL_ROUTED": {
      if (!isTaskId(payload.taskId)) return "payload.taskId must be a valid TaskId";
      if (!["actor", "critic", "router", "judge", "tool", "human"].includes(String(payload.role))) {
        return "payload.role must be a known flowchart role";
      }
      if (!["LOW", "MEDIUM", "HIGH"].includes(String(payload.complexity))) {
        return "payload.complexity must be a known task complexity";
      }
      if (typeof payload.model !== "string" || payload.model.trim() === "") {
        return "payload.model must be a non-empty string";
      }
      if (typeof payload.justification !== "string" || payload.justification.trim() === "") {
        return "payload.justification must be a non-empty string";
      }
      if (!isConfidenceScore(payload.confidence)) {
        return "payload.confidence must be a finite number between 0 and 1";
      }
      try {
        validateApprovalPlan(payload.approvalPlan);
      } catch (error) {
        return `payload.approvalPlan: ${messageOf(error)}`;
      }
      if (!["RUNNING", "WAITING_FOR_USER"].includes(String(payload.statusAfterRoute))) {
        return "payload.statusAfterRoute must be RUNNING or WAITING_FOR_USER";
      }
      if (typeof payload.policyVersion !== "string" || payload.policyVersion.trim() === "") {
        return "payload.policyVersion must be a non-empty string";
      }
      if (typeof payload.estimatedCostUsd !== "number" ||
          !Number.isFinite(payload.estimatedCostUsd) ||
          payload.estimatedCostUsd < 0) {
        return "payload.estimatedCostUsd must be a non-negative finite number";
      }
      if (typeof payload.estimatedDurationMs !== "number" ||
          !Number.isFinite(payload.estimatedDurationMs) ||
          payload.estimatedDurationMs <= 0) {
        return "payload.estimatedDurationMs must be a positive finite number";
      }
      if (typeof payload.family !== "string" || payload.family.trim() === "") {
        return "payload.family must be a non-empty string";
      }
      if (typeof payload.featureVersion !== "string" || payload.featureVersion.trim() === "") {
        return "payload.featureVersion must be a non-empty string";
      }
      if (typeof payload.modelVersion !== "string" || payload.modelVersion.trim() === "") {
        return "payload.modelVersion must be a non-empty string";
      }
      if (typeof payload.highRisk !== "boolean") {
        return "payload.highRisk must be a boolean";
      }
      if (!Array.isArray(payload.eligibleModels) ||
          !payload.eligibleModels.every((id) => typeof id === "string" && id.trim() !== "")) {
        return "payload.eligibleModels must be an array of non-empty strings";
      }
      if (!Array.isArray(payload.rejections) || !payload.rejections.every(isRoutingRefusal)) {
        return "payload.rejections must be an array of { modelId, constraint, detail }";
      }
      if (!isBehaviorDistribution(payload.behaviorDistribution, payload.eligibleModels, payload.model)) {
        return "payload.behaviorDistribution must be a one-hot map over eligibleModels";
      }
      if (payload.agentRole !== undefined && !isAgentRole(payload.agentRole)) {
        return "payload.agentRole must be a known agent role";
      }
      if (payload.coldStartRoutingScore !== undefined && !isConfidenceScore(payload.coldStartRoutingScore)) {
        return "payload.coldStartRoutingScore must be a finite number between 0 and 1";
      }
      return undefined;
    }
    case "RUN_BLOCKED": {
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
        return "payload.reason must be a non-empty string";
      }
      if (!Array.isArray(payload.requiredEvidence) || !payload.requiredEvidence.every((e) => typeof e === "string" && e !== "")) {
        return "payload.requiredEvidence must be an array of non-empty strings";
      }
      return undefined;
    }
    case "PAUSE_REQUESTED": {
      const keys = Object.keys(payload);
      if (keys.some((key) => key !== "reason")) return "payload may only include reason";
      if (payload.reason !== undefined && (typeof payload.reason !== "string" || payload.reason.trim() === "")) {
        return "payload.reason must be a non-empty string";
      }
      return undefined;
    }
    case "PAUSE_CLEARED":
      return isEmptyPayload(payload) ? undefined : "payload must be an empty object";
    case "INJECTION_REQUESTED":
      return injectionPayloadError(payload);
    case "EPISODE_OPENED": {
      if (payload.episode === undefined || payload.episode === null) return "payload.episode is required";
      const ep = payload.episode as Record<string, unknown>;
      if (typeof ep.id !== "string" || !ep.id.startsWith("ep_")) {
        return "payload.episode.id must be a valid EpisodeId";
      }
      return undefined;
    }
    case "EPISODE_CLOSED": {
      if (!isEpisodeId(payload.episodeId)) return "payload.episodeId must be a valid EpisodeId";
      const closedStatuses = ["COMPLETED", "FAILED", "ABANDONED", "WAITING_FOR_USER"] as const;
      if (typeof payload.status !== "string" || !(closedStatuses as readonly string[]).includes(payload.status)) {
        return "payload.status must be a valid closed EpisodeStatus";
      }
      if (!isIsoTimestamp(payload.closedAt)) return "payload.closedAt must be a valid IsoTimestamp";
      if (payload.outcomeId !== undefined && typeof payload.outcomeId !== "string") {
        return "payload.outcomeId must be a string when present";
      }
      return undefined;
    }
    case "RUN_ATTACHED": {
      if (!isEpisodeId(payload.episodeId)) return "payload.episodeId must be a valid EpisodeId";
      if (!isRunId(payload.runId)) return "payload.runId must be a valid RunId";
      if (typeof payload.attachedAt !== "string" || !isIsoTimestamp(payload.attachedAt)) return "payload.attachedAt must be a valid IsoTimestamp";
      return undefined;
    }
    case "EPISODE_WAITING": {
      if (!isEpisodeId(payload.episodeId)) return "payload.episodeId must be a valid EpisodeId";
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") return "payload.reason must be a non-empty string";
      if (!Array.isArray(payload.requiredEvidence)) return "payload.requiredEvidence must be an array";
      return undefined;
    }
    case "TRACKING_ASSESSMENT": {
      if (typeof payload.assessmentHash !== "string" || payload.assessmentHash.trim() === "") {
        return "payload.assessmentHash must be a non-empty string";
      }
      if (typeof payload.seq !== "number" || !Number.isInteger(payload.seq) || payload.seq < 0) {
        return "payload.seq must be a non-negative integer";
      }
      try {
        const parsed = parseTrackingAssessment(payload.assessment);
        if (hashAssessment(parsed) !== payload.assessmentHash) {
          return "payload.assessmentHash mismatch: does not match hashAssessment(assessment)";
        }
      } catch (error) {
        return `payload.assessment: ${messageOf(error)}`;
      }
      return undefined;
    }
    case "GATE_TRANSITION": {
      if (typeof payload.transitionId !== "string" || payload.transitionId.trim() === "") {
        return "payload.transitionId must be a non-empty string";
      }
      if (typeof payload.episodeId !== "string" || payload.episodeId.trim() === "") {
        return "payload.episodeId must be a non-empty string";
      }
      if (typeof payload.turnId !== "string" || payload.turnId.trim() === "") {
        return "payload.turnId must be a non-empty string";
      }
      if (typeof payload.seq !== "number" || !Number.isInteger(payload.seq) || payload.seq < 0) {
        return "payload.seq must be a non-negative integer";
      }
      if (!isGateRunStatus(payload.from)) {
        return "payload.from must be RUNNING, WAITING_FOR_USER, or BLOCKED";
      }
      if (!isGateRunStatus(payload.to)) {
        return "payload.to must be RUNNING, WAITING_FOR_USER, or BLOCKED";
      }
      if (typeof payload.reasonCode !== "string" || payload.reasonCode.trim() === "") {
        return "payload.reasonCode must be a non-empty string";
      }
      if (typeof payload.assessmentHash !== "string" || payload.assessmentHash.trim() === "") {
        return "payload.assessmentHash must be a non-empty string";
      }
      if (
        !Array.isArray(payload.evidenceRefs) ||
        !payload.evidenceRefs.every((ref) => typeof ref === "string" && ref !== "")
      ) {
        return "payload.evidenceRefs must be an array of non-empty strings";
      }
      if (typeof payload.policyVersion !== "string" || payload.policyVersion.trim() === "") {
        return "payload.policyVersion must be a non-empty string";
      }
      if (typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.trim() === "") {
        return "payload.idempotencyKey must be a non-empty string";
      }
      if (!isGateDirective(payload.directive)) {
        return "payload.directive must be a known GateDirective";
      }
      return undefined;
    }
  }
}

export function validateEvent(value: unknown): Event {
  if (!isRecord(value)) {
    throw new DomainValidationError("Invalid Event: expected an object");
  }
  if (!isEventId(value.id)) throw new DomainValidationError("Invalid Event: id must be a valid EventId");
  if (value.schemaVersion !== 1) throw new DomainValidationError("Invalid Event: schemaVersion must be 1");
  if (!isIsoTimestamp(value.occurredAt)) throw new DomainValidationError("Invalid Event: occurredAt must be a valid IsoTimestamp");
  if (!isRunId(value.runId)) throw new DomainValidationError("Invalid Event: runId must be a valid RunId");
  if (value.taskId !== undefined && !isTaskId(value.taskId)) {
    throw new DomainValidationError("Invalid Event: taskId must be a valid TaskId");
  }
  if (!(EVENT_TYPES as readonly string[]).includes(String(value.type))) {
    throw new DomainValidationError("Invalid Event: type must be a known event type");
  }
  if (typeof value.actor !== "string" || value.actor.trim() === "") {
    throw new DomainValidationError("Invalid Event: actor must be a non-empty string");
  }
  const reason = payloadError(value.type as M0EventType, value.payload);
  if (reason !== undefined) {
    throw new DomainValidationError(`Invalid Event: ${reason}`);
  }
  return value as unknown as Event;
}
