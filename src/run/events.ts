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
  "RUN_UNBLOCKED",
  "RUN_UNBLOCKED_WITH_DISCARD",
  "PAUSE_REQUESTED",
  "PAUSE_CLEARED",
  "INJECTION_REQUESTED",
  "STEER_INJECTED",
  "EPISODE_OPENED",
  "RUN_ATTACHED",
  "EPISODE_WAITING",
  "EPISODE_CLOSED",
  "TRACKING_ASSESSMENT",
  "GATE_TRANSITION"
] as const;

export type M0EventType = (typeof EVENT_TYPES)[number];

export const AGENT_EVENT_KINDS = [
  "TEXT_DELTA",
  "THINKING_DELTA",
  "TOOL_STARTED",
  "TOOL_FINISHED",
  "TURN_FINISHED"
] as const;
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

export interface UserAnswerPayload {
  messageId: MessageId;
  answer: string;
  approvalReply?: ApprovalReply;
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

/**
 * The operator's authorization to end one specific block.
 *
 * `blockedEventId` names the exact `RUN_BLOCKED` this clears, which is what
 * makes repeated BLOCKED → RUNNING → BLOCKED cycles unambiguous and stops a
 * stale command from clearing a block it never saw. `reason` is the audit
 * rationale; the event's own `actor` records who authorized it. No evidence is
 * copied here — facts stay in the events that already carry them
 * (`INJECTION_REQUESTED` above all), so this event cannot become a second,
 * unverifiable evidence vocabulary.
 *
 * `retryNodeId` is absent for a run-level stall block and names the FAILED
 * flowchart node to re-drive for a gate block. It is a flowchart node id, not a
 * `TaskId`: the reopen is a `FlowNodeState` transition, not a DAG one.
 */
export interface RunUnblockedPayload {
  blockedEventId: EventId;
  reason: string;
  retryNodeId?: string;
}

/** The node states a discard authorization may supersede, ordered as the transform reports them. */
export const REWOUND_DESCENDANT_STATES = [
  "READY",
  "SKIPPED",
  "RUNNING",
  "WAITING_FOR_USER",
  "COMPLETED",
  "FAILED"
] as const;

export type RewoundDescendantState = (typeof REWOUND_DESCENDANT_STATES)[number];

/** The four states that mean work actually happened, so discarding one needs authorizing. */
const EXECUTED_DESCENDANT_STATES: readonly RewoundDescendantState[] = [
  "RUNNING",
  "WAITING_FOR_USER",
  "COMPLETED",
  "FAILED"
];

/**
 * One node whose control-state result a discard authorization supersedes.
 *
 * `nodeId` plus `taskId` pins both identities: the reopen moves a
 * `FlowNodeState`, while everything the attempt left on the log is keyed by
 * task. `modelRouteEventIds` and `childRunIds` name the exact attempts being
 * superseded — the original rows stay on the log and stay factual, so this
 * event makes the supersession queryable rather than deleting history.
 *
 * The charged estimates are the sums of `estimatedCostUsd` and
 * `estimatedDurationMs` over exactly the `MODEL_ROUTED` rows referenced above,
 * and the producer re-derives them from those rows and refuses on any mismatch.
 * They are deliberately not a provider bill: invocation telemetry is
 * best-effort and asynchronous, so a missing usage record means unknown, not
 * zero, and this event may not claim complete actual spend. A `READY` or
 * `SKIPPED` descendant carries no references and zeroes, which mean "no route
 * was charged for this state" — not "the run cost nothing".
 */
export interface RewoundDescendant {
  nodeId: string;
  taskId: TaskId;
  previousState: RewoundDescendantState;
  modelRouteEventIds: readonly EventId[];
  childRunIds: readonly RunId[];
  chargedEstimatedCostUsd: number;
  chargedEstimatedDurationMs: number;
}

/**
 * The operator's authorization to end one block *and* discard the executed work
 * downstream of the node being re-driven.
 *
 * This is a distinct event rather than a fourth key on
 * {@link RunUnblockedPayload}, for two reasons that both outlive the flag. The
 * ordinary authorization is exact-key frozen and deliberately narrow: a
 * strength field on it would make every existing reader branch on how much the
 * operator was permitted to erase, and would retire the refusals that freeze
 * says. And keeping the whole authorization in one append means no crash window
 * can leave half of it durable — the alternative, a discard event followed by
 * an ordinary `RUN_UNBLOCKED`, would need cross-event pairing and orphan rules
 * to represent a single operator act.
 *
 * `retryNodeId` is required here: discarding downstream work is only meaningful
 * relative to the node being re-driven, so the targetless stall shape cannot
 * carry this event at all. `rewoundDescendants` is the full consequence set the
 * transform computed under the run lifecycle lock — never an operator-supplied
 * list — and excludes the retry target, which `retryNodeId` already names. At
 * least one entry must record an executed prior state; without one there was
 * nothing to authorize and the ordinary event is the honest record.
 */
export interface RunUnblockedWithDiscardPayload {
  blockedEventId: EventId;
  reason: string;
  retryNodeId: string;
  rewoundDescendants: readonly RewoundDescendant[];
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

/**
 * User-authored text pushed into a live agent loop. Distinct from
 * INJECTION_REQUESTED, which records a typed flowchart policy fact; this
 * records a conversational turn the user added mid-run.
 *
 * The text is stored verbatim, which is safe for the same reason it is
 * required: it is the user's own instruction, not model reasoning. Nothing
 * derived from a `THINKING_DELTA` may ever be routed here.
 *
 * The steering principal is the event's `actor`, not a payload field.
 */
export interface SteerInjectedPayload {
  text: string;
  /** Present when the steer targeted one known agent instance. */
  agentInstanceId?: AgentInstanceId;
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
  | (EventBase & { type: "RUN_UNBLOCKED"; payload: RunUnblockedPayload })
  | (EventBase & {
      type: "RUN_UNBLOCKED_WITH_DISCARD";
      payload: RunUnblockedWithDiscardPayload;
    })
  | (EventBase & { type: "PAUSE_REQUESTED"; payload: PauseRequestedPayload })
  | (EventBase & { type: "PAUSE_CLEARED"; payload: EmptyPayload })
  | (EventBase & { type: "INJECTION_REQUESTED"; payload: InjectionRequestedPayload })
  | (EventBase & { type: "STEER_INJECTED"; payload: SteerInjectedPayload })
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

/**
 * One `rewoundDescendants` entry, checked exactly.
 *
 * The entry is an audit claim about work that is being superseded, so every
 * field it carries has to be readable on its own: an unresolvable node or task,
 * a state outside the transform's vocabulary, or a reference that names no
 * event makes the claim unauditable rather than merely imprecise. The
 * `READY`/`SKIPPED` rule is the same discipline pointed the other way — those
 * states never held a route, so a non-empty reference or a non-zero charge
 * there would be an invented one.
 */
function rewoundDescendantError(value: unknown, index: number): string | undefined {
  const at = `payload.rewoundDescendants[${index}]`;
  if (!isRecord(value)) return `${at} must be an object`;
  const allowed = [
    "nodeId",
    "taskId",
    "previousState",
    "modelRouteEventIds",
    "childRunIds",
    "chargedEstimatedCostUsd",
    "chargedEstimatedDurationMs"
  ];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return `${at} may only include ${allowed.join(", ")}; unknown: ${unknown.join(", ")}`;
  }
  if (typeof value.nodeId !== "string" || value.nodeId.trim() === "") {
    return `${at}.nodeId must be a non-empty string`;
  }
  if (!isTaskId(value.taskId)) return `${at}.taskId must be a valid TaskId`;
  if (
    typeof value.previousState !== "string" ||
    !(REWOUND_DESCENDANT_STATES as readonly string[]).includes(value.previousState)
  ) {
    return `${at}.previousState must be one of ${REWOUND_DESCENDANT_STATES.join(", ")}`;
  }
  if (!Array.isArray(value.modelRouteEventIds) || !value.modelRouteEventIds.every(isEventId)) {
    return `${at}.modelRouteEventIds must be an array of EventIds`;
  }
  if (!Array.isArray(value.childRunIds) || !value.childRunIds.every(isRunId)) {
    return `${at}.childRunIds must be an array of RunIds`;
  }
  for (const key of ["chargedEstimatedCostUsd", "chargedEstimatedDurationMs"] as const) {
    const charged = value[key];
    if (typeof charged !== "number" || !Number.isFinite(charged) || charged < 0) {
      return `${at}.${key} must be a non-negative finite number`;
    }
  }
  const executed = (EXECUTED_DESCENDANT_STATES as readonly string[]).includes(value.previousState);
  if (
    !executed &&
    (value.modelRouteEventIds.length > 0 ||
      value.childRunIds.length > 0 ||
      value.chargedEstimatedCostUsd !== 0 ||
      value.chargedEstimatedDurationMs !== 0)
  ) {
    return `${at} is ${value.previousState}, which never held a route: it must carry no references and zero charged estimates`;
  }
  return undefined;
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
    case "RUN_UNBLOCKED": {
      // Exact keys: an unblock is an authorization record, and a payload
      // carrying anything the reader does not understand is not one.
      const allowed = ["blockedEventId", "reason", "retryNodeId"];
      const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
      if (unknown.length > 0) {
        return `payload may only include ${allowed.join(", ")}; unknown: ${unknown.join(", ")}`;
      }
      if (!isEventId(payload.blockedEventId)) {
        return "payload.blockedEventId must be a valid EventId";
      }
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
        return "payload.reason must be a non-empty string";
      }
      if (
        payload.retryNodeId !== undefined &&
        (typeof payload.retryNodeId !== "string" || payload.retryNodeId.trim() === "")
      ) {
        return "payload.retryNodeId must be a non-empty string when present";
      }
      return undefined;
    }
    case "RUN_UNBLOCKED_WITH_DISCARD": {
      // Exact keys again, and for the same reason: the stronger authorization
      // is still an authorization record, so a reader that cannot account for
      // every field it carries must not honour it.
      const allowed = ["blockedEventId", "reason", "retryNodeId", "rewoundDescendants"];
      const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
      if (unknown.length > 0) {
        return `payload may only include ${allowed.join(", ")}; unknown: ${unknown.join(", ")}`;
      }
      if (!isEventId(payload.blockedEventId)) {
        return "payload.blockedEventId must be a valid EventId";
      }
      if (typeof payload.reason !== "string" || payload.reason.trim() === "") {
        return "payload.reason must be a non-empty string";
      }
      if (typeof payload.retryNodeId !== "string" || payload.retryNodeId.trim() === "") {
        return "payload.retryNodeId must be a non-empty string";
      }
      if (!Array.isArray(payload.rewoundDescendants) || payload.rewoundDescendants.length === 0) {
        return "payload.rewoundDescendants must be a non-empty array";
      }
      let previousNodeId: string | undefined;
      let sawExecuted = false;
      for (const [index, entry] of payload.rewoundDescendants.entries()) {
        const reason = rewoundDescendantError(entry, index);
        if (reason !== undefined) return reason;
        const descendant = entry as RewoundDescendant;
        if (descendant.nodeId === payload.retryNodeId) {
          return `payload.rewoundDescendants must not repeat the retry target ${payload.retryNodeId}`;
        }
        // Canonical order also settles uniqueness: a duplicate cannot be
        // strictly greater than the entry before it.
        if (previousNodeId !== undefined && descendant.nodeId <= previousNodeId) {
          return "payload.rewoundDescendants must be unique and ordered by nodeId";
        }
        previousNodeId = descendant.nodeId;
        if ((EXECUTED_DESCENDANT_STATES as readonly string[]).includes(descendant.previousState)) {
          sawExecuted = true;
        }
      }
      if (!sawExecuted) {
        return `payload.rewoundDescendants must include at least one descendant in ${EXECUTED_DESCENDANT_STATES.join(", ")}`;
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
    case "STEER_INJECTED": {
      if (typeof payload.text !== "string" || payload.text.trim() === "") {
        return "payload.text must be a non-empty string";
      }
      if (payload.agentInstanceId !== undefined && !isAgentInstanceId(payload.agentInstanceId)) {
        return "payload.agentInstanceId must be a valid AgentInstanceId when present";
      }
      const keys = Object.keys(payload);
      if (keys.some((key) => key !== "text" && key !== "agentInstanceId")) {
        return "payload may only include text and agentInstanceId";
      }
      return undefined;
    }
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
