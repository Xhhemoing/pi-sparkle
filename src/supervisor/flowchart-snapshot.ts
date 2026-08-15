import { DomainValidationError } from "../domain/errors.js";
import {
  isConfidenceScore,
  validateApprovalPlan,
  type ApprovalPlan,
  type FlowchartNodeRole,
  type TaskComplexity
} from "../domain/flowchart.js";
import { isEventId, isTaskId } from "../domain/ids.js";
import { isRecord } from "../domain/record.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import { validateAgentMessage, type AgentQuestion } from "../protocol/v1.js";
import type { RoutingDecision } from "./model-router.js";
import {
  type LedgerBlocker,
  type LedgerFact,
  type LedgerNextAction,
  type LedgerProgressEntry,
  type LedgerRoundEvent,
  type RequiredEvidence,
  type RunLedger
} from "./ledger.js";
import type {
  ActiveRoute,
  ApprovalKind,
  FactValue,
  FlowchartRunLimits,
  FlowchartRunStatus,
  FlowchartSupervisorSnapshot,
  FlowNodeRuntime,
  FlowNodeState,
  PendingApproval
} from "./flowchart-supervisor.js";

const FLOW_NODE_STATES: readonly FlowNodeState[] = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING_FOR_USER",
  "COMPLETED",
  "FAILED",
  "SKIPPED"
];

const FLOWCHART_RUN_STATUSES: readonly FlowchartRunStatus[] = [
  "RUNNING",
  "WAITING_FOR_USER",
  "PAUSED",
  "COMPLETED",
  "BLOCKED",
  "FAILED"
];

const ROLES: readonly FlowchartNodeRole[] = ["actor", "critic", "router", "judge", "tool", "human"];
const COMPLEXITIES: readonly TaskComplexity[] = ["LOW", "MEDIUM", "HIGH"];
const APPROVAL_KINDS: readonly ApprovalKind[] = ["ROUTE", "BRANCH"];
const PROGRESS_WHATS: readonly LedgerProgressEntry["what"][] = [
  "TASK_COMPLETED",
  "EVIDENCE",
  "FACT",
  "BLOCKER_RESOLVED",
  "USER_DECISION"
];
const BLOCKER_KINDS: readonly LedgerBlocker["kind"][] = ["NEEDS_INFO", "DEPENDENCY", "EXTERNAL", "UNKNOWN"];
const NEXT_ACTIONS: readonly LedgerNextAction["action"][] = ["RETRY", "SKIP", "RUN", "WAIT_FOR_USER"];

function snapshotError(detail: string): DomainValidationError {
  return new DomainValidationError(`Invalid FlowchartSupervisorSnapshot: ${detail}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFactValue(value: unknown): value is FactValue {
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isFinite(value);
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function validateNodeRuntime(nodeId: string, value: unknown): FlowNodeRuntime {
  if (!isRecord(value)) throw snapshotError(`nodes.${nodeId} must be an object`);
  if (!isOneOf(FLOW_NODE_STATES, value.state)) {
    throw snapshotError(`nodes.${nodeId}.state must be a known FlowNodeState`);
  }
  if (!isNonNegativeInteger(value.evidenceCount)) {
    throw snapshotError(`nodes.${nodeId}.evidenceCount must be a non-negative integer`);
  }
  if (value.confidence !== undefined && !isConfidenceScore(value.confidence)) {
    throw snapshotError(`nodes.${nodeId}.confidence must be a finite number between 0 and 1`);
  }
  if (value.success !== undefined && typeof value.success !== "boolean") {
    throw snapshotError(`nodes.${nodeId}.success must be a boolean`);
  }
  if (value.model !== undefined && !isNonEmptyString(value.model)) {
    throw snapshotError(`nodes.${nodeId}.model must be a non-empty string`);
  }
  if (value.parallelGroup !== undefined && !isNonEmptyString(value.parallelGroup)) {
    throw snapshotError(`nodes.${nodeId}.parallelGroup must be a non-empty string`);
  }
  return value as unknown as FlowNodeRuntime;
}

function validateActiveRoute(nodeId: string, value: unknown): ActiveRoute {
  if (!isRecord(value)) throw snapshotError(`activeRoutes.${nodeId} must be an object`);
  if (!isNonEmptyString(value.nodeId)) {
    throw snapshotError(`activeRoutes.${nodeId}.nodeId must be a non-empty string`);
  }
  if (value.nodeId !== nodeId) {
    throw snapshotError(`activeRoutes.${nodeId}.nodeId must equal its key`);
  }
  if (!isNonEmptyString(value.model)) {
    throw snapshotError(`activeRoutes.${nodeId}.model must be a non-empty string`);
  }
  if (!isNonNegativeInteger(value.decisionIndex)) {
    throw snapshotError(`activeRoutes.${nodeId}.decisionIndex must be a non-negative integer`);
  }
  return value as unknown as ActiveRoute;
}

function validateRoutingDecision(value: unknown, index: number): RoutingDecision {
  if (!isRecord(value)) throw snapshotError(`decisions[${index}] must be an object`);
  if (value.eventType !== "MODEL_ROUTED") {
    throw snapshotError(`decisions[${index}].eventType must be MODEL_ROUTED`);
  }
  if (!isTaskId(value.taskId)) throw snapshotError(`decisions[${index}].taskId must be a valid TaskId`);
  if (!isOneOf(ROLES, value.role)) throw snapshotError(`decisions[${index}].role must be a known flowchart role`);
  if (!isOneOf(COMPLEXITIES, value.complexity)) {
    throw snapshotError(`decisions[${index}].complexity must be a known task complexity`);
  }
  if (!isNonEmptyString(value.model)) throw snapshotError(`decisions[${index}].model must be a non-empty string`);
  if (!isNonEmptyString(value.justification)) {
    throw snapshotError(`decisions[${index}].justification must be a non-empty string`);
  }
  if (!isConfidenceScore(value.confidence)) {
    throw snapshotError(`decisions[${index}].confidence must be a finite number between 0 and 1`);
  }
  try {
    validateApprovalPlan(value.approvalPlan);
  } catch (error) {
    throw snapshotError(`decisions[${index}].approvalPlan: ${messageOf(error)}`);
  }
  if (value.statusAfterRoute !== "RUNNING" && value.statusAfterRoute !== "WAITING_FOR_USER") {
    throw snapshotError(`decisions[${index}].statusAfterRoute must be RUNNING or WAITING_FOR_USER`);
  }
  if (!isNonEmptyString(value.policyVersion)) {
    throw snapshotError(`decisions[${index}].policyVersion must be a non-empty string`);
  }
  if (!isFiniteNonNegative(value.estimatedCostUsd)) {
    throw snapshotError(`decisions[${index}].estimatedCostUsd must be a non-negative finite number`);
  }
  if (typeof value.estimatedDurationMs !== "number" || !Number.isFinite(value.estimatedDurationMs) || value.estimatedDurationMs <= 0) {
    throw snapshotError(`decisions[${index}].estimatedDurationMs must be a positive finite number`);
  }
  return value as unknown as RoutingDecision;
}

function validateLedgerFact(value: unknown, label: string): LedgerFact {
  if (!isRecord(value)) throw snapshotError(`${label} must be an object`);
  if (!isNonEmptyString(value.key)) throw snapshotError(`${label}.key must be a non-empty string`);
  if (typeof value.value !== "string") throw snapshotError(`${label}.value must be a string`);
  if (!isConfidenceScore(value.confidence)) {
    throw snapshotError(`${label}.confidence must be a finite number between 0 and 1`);
  }
  return value as unknown as LedgerFact;
}

function validateProgressEntry(value: unknown, index: number): LedgerProgressEntry {
  if (!isRecord(value)) throw snapshotError(`ledger.progress[${index}] must be an object`);
  if (!isNonNegativeInteger(value.round)) {
    throw snapshotError(`ledger.progress[${index}].round must be a non-negative integer`);
  }
  if (!isOneOf(PROGRESS_WHATS, value.what)) {
    throw snapshotError(`ledger.progress[${index}].what must be a known progress kind`);
  }
  if (value.taskId !== undefined && !isTaskId(value.taskId)) {
    throw snapshotError(`ledger.progress[${index}].taskId must be a valid TaskId`);
  }
  if (value.detail !== undefined && !isNonEmptyString(value.detail)) {
    throw snapshotError(`ledger.progress[${index}].detail must be a non-empty string`);
  }
  return value as unknown as LedgerProgressEntry;
}

function validateBlocker(value: unknown, label: string): LedgerBlocker {
  if (!isRecord(value)) throw snapshotError(`${label} must be an object`);
  if (!isOneOf(BLOCKER_KINDS, value.kind)) throw snapshotError(`${label}.kind is invalid`);
  if (!isNonEmptyString(value.description)) throw snapshotError(`${label}.description must be a non-empty string`);
  if (value.taskId !== undefined && !isTaskId(value.taskId)) {
    throw snapshotError(`${label}.taskId must be a valid TaskId`);
  }
  return value as unknown as LedgerBlocker;
}

function validateNextAction(value: unknown, index: number): LedgerNextAction {
  if (!isRecord(value)) throw snapshotError(`ledger.nextActions[${index}] must be an object`);
  if (!isTaskId(value.taskId)) throw snapshotError(`ledger.nextActions[${index}].taskId must be a valid TaskId`);
  if (!isOneOf(NEXT_ACTIONS, value.action)) {
    throw snapshotError(`ledger.nextActions[${index}].action is invalid`);
  }
  return value as unknown as LedgerNextAction;
}

function validateRequiredEvidence(value: unknown, index: number): RequiredEvidence {
  if (!isRecord(value)) throw snapshotError(`ledger.requiredEvidence[${index}] must be an object`);
  if (!isNonEmptyString(value.description)) {
    throw snapshotError(`ledger.requiredEvidence[${index}].description must be a non-empty string`);
  }
  return value as unknown as RequiredEvidence;
}

function validateLedger(value: unknown): RunLedger {
  if (!isRecord(value)) throw snapshotError("ledger must be an object");
  if (!isNonNegativeInteger(value.revision)) throw snapshotError("ledger.revision must be a non-negative integer");
  if (!isNonEmptyString(value.objective)) throw snapshotError("ledger.objective must be a non-empty string");
  if (!Array.isArray(value.facts)) throw snapshotError("ledger.facts must be an array");
  value.facts.forEach((fact, index) => validateLedgerFact(fact, `ledger.facts[${index}]`));
  if (!Array.isArray(value.progress)) throw snapshotError("ledger.progress must be an array");
  value.progress.forEach((entry, index) => validateProgressEntry(entry, index));
  if (!Array.isArray(value.blockers)) throw snapshotError("ledger.blockers must be an array");
  value.blockers.forEach((blocker, index) => validateBlocker(blocker, `ledger.blockers[${index}]`));
  if (!Array.isArray(value.nextActions)) throw snapshotError("ledger.nextActions must be an array");
  value.nextActions.forEach((action, index) => validateNextAction(action, index));
  if (!isNonNegativeInteger(value.round)) throw snapshotError("ledger.round must be a non-negative integer");
  if (!isNonNegativeInteger(value.consecutiveStalls)) {
    throw snapshotError("ledger.consecutiveStalls must be a non-negative integer");
  }
  if (!isPositiveInteger(value.maxConsecutiveStalls)) {
    throw snapshotError("ledger.maxConsecutiveStalls must be a positive integer");
  }
  if (typeof value.isBlocked !== "boolean") throw snapshotError("ledger.isBlocked must be a boolean");
  if (!Array.isArray(value.requiredEvidence)) throw snapshotError("ledger.requiredEvidence must be an array");
  value.requiredEvidence.forEach((entry, index) => validateRequiredEvidence(entry, index));
  if (value.updatedByEventId !== undefined && !isEventId(value.updatedByEventId)) {
    throw snapshotError("ledger.updatedByEventId must be a valid EventId");
  }
  if (value.updatedAt !== undefined && !isIsoTimestamp(value.updatedAt)) {
    throw snapshotError("ledger.updatedAt must be a valid IsoTimestamp");
  }
  return value as unknown as RunLedger;
}

function validateRoundEvent(value: unknown): LedgerRoundEvent {
  if (!isRecord(value)) throw snapshotError("pendingRoundEvent must be an object");
  if (value.taskId !== undefined && !isTaskId(value.taskId)) {
    throw snapshotError("pendingRoundEvent.taskId must be a valid TaskId");
  }
  if (!Array.isArray(value.completedTasks) || !value.completedTasks.every((id) => isTaskId(id))) {
    throw snapshotError("pendingRoundEvent.completedTasks must be an array of TaskIds");
  }
  if (!Array.isArray(value.newEvidenceIds) || !value.newEvidenceIds.every((id) => typeof id === "string" && id !== "")) {
    throw snapshotError("pendingRoundEvent.newEvidenceIds must be an array of non-empty strings");
  }
  if (!Array.isArray(value.newFacts)) throw snapshotError("pendingRoundEvent.newFacts must be an array");
  value.newFacts.forEach((fact, index) => validateLedgerFact(fact, `pendingRoundEvent.newFacts[${index}]`));
  if (!Array.isArray(value.resolvedBlockers)) throw snapshotError("pendingRoundEvent.resolvedBlockers must be an array");
  value.resolvedBlockers.forEach((blocker, index) =>
    validateBlocker(blocker, `pendingRoundEvent.resolvedBlockers[${index}]`)
  );
  if (typeof value.userDecision !== "boolean") {
    throw snapshotError("pendingRoundEvent.userDecision must be a boolean");
  }
  return value as unknown as LedgerRoundEvent;
}

function validatePendingApproval(value: unknown, decisions: readonly RoutingDecision[]): PendingApproval {
  if (!isRecord(value)) throw snapshotError("pendingApproval must be an object");
  if (!isOneOf(APPROVAL_KINDS, value.kind)) throw snapshotError("pendingApproval.kind must be ROUTE or BRANCH");
  if (!isNonEmptyString(value.nodeId)) throw snapshotError("pendingApproval.nodeId must be a non-empty string");
  let plan: ApprovalPlan;
  try {
    plan = validateApprovalPlan(value.plan);
  } catch (error) {
    throw snapshotError(`pendingApproval.plan: ${messageOf(error)}`);
  }
  if (!isNonNegativeInteger(value.decisionIndex)) {
    throw snapshotError("pendingApproval.decisionIndex must be a non-negative integer");
  }
  if (value.decisionIndex >= decisions.length) {
    throw snapshotError("pendingApproval.decisionIndex is out of range for decisions");
  }
  if (value.kind === "ROUTE") {
    if (!isNonEmptyString(value.approveActionId)) {
      throw snapshotError("pendingApproval.approveActionId is required for ROUTE approvals");
    }
  } else if (value.approveActionId !== undefined && !isNonEmptyString(value.approveActionId)) {
    throw snapshotError("pendingApproval.approveActionId must be a non-empty string");
  }
  let question: AgentQuestion;
  try {
    const message = validateAgentMessage(value.question);
    if (message.type !== "QUESTION") {
      throw new DomainValidationError("pendingApproval.question must be a QUESTION");
    }
    question = message;
  } catch (error) {
    throw snapshotError(`pendingApproval.question: ${messageOf(error)}`);
  }
  if (question.approvalPlan === undefined || question.approvalPlan.id !== plan.id) {
    throw snapshotError("pendingApproval.question.approvalPlan must match pendingApproval.plan");
  }
  if (!isConfidenceScore(value.routedConfidence)) {
    throw snapshotError("pendingApproval.routedConfidence must be a finite number between 0 and 1");
  }
  return value as unknown as PendingApproval;
}

function assertWaiterInvariant(
  nodes: Readonly<Record<string, FlowNodeRuntime>>,
  pendingApproval: PendingApproval | undefined
): void {
  const waiters = Object.entries(nodes).filter(([, runtime]) => runtime.state === "WAITING_FOR_USER");
  if (waiters.length > 1) {
    throw snapshotError("at most one WAITING_FOR_USER node is allowed");
  }
  if (pendingApproval === undefined) {
    if (waiters.length > 0) {
      throw snapshotError(`WAITING_FOR_USER node ${waiters[0]![0]} requires pendingApproval`);
    }
    return;
  }
  const runtime = nodes[pendingApproval.nodeId];
  if (runtime === undefined) {
    throw snapshotError(`pendingApproval.nodeId ${pendingApproval.nodeId} is not in nodes`);
  }
  if (waiters.length === 0 || runtime.state !== "WAITING_FOR_USER") {
    throw snapshotError("pendingApproval requires that node to be WAITING_FOR_USER");
  }
  if (waiters[0]![0] !== pendingApproval.nodeId) {
    throw snapshotError("pendingApproval.nodeId must be the WAITING_FOR_USER node");
  }
}

/**
 * Fail-closed structural validation of a flowchart supervisor snapshot.
 * Restore still checks that the snapshot matches a concrete flowchart.
 */
export function validateFlowchartSupervisorSnapshot(value: unknown): FlowchartSupervisorSnapshot {
  if (!isRecord(value)) throw snapshotError("expected an object");
  if (!isNonEmptyString(value.flowchartId)) throw snapshotError("flowchartId must be a non-empty string");
  if (!isOneOf(FLOWCHART_RUN_STATUSES, value.status)) {
    throw snapshotError("status must be a known FlowchartRunStatus");
  }
  if (!isRecord(value.nodes)) throw snapshotError("nodes must be an object");
  const nodes: Record<string, FlowNodeRuntime> = {};
  for (const [nodeId, runtime] of Object.entries(value.nodes)) {
    if (!isNonEmptyString(nodeId)) throw snapshotError("node ids must be non-empty strings");
    nodes[nodeId] = validateNodeRuntime(nodeId, runtime);
  }
  if (Object.keys(nodes).length === 0) throw snapshotError("nodes must not be empty");

  if (!Array.isArray(value.decisions)) throw snapshotError("decisions must be an array");
  const decisions = value.decisions.map((decision, index) => validateRoutingDecision(decision, index));

  if (!isRecord(value.activeRoutes)) throw snapshotError("activeRoutes must be an object");
  for (const [nodeId, route] of Object.entries(value.activeRoutes)) {
    if (!nodes[nodeId]) throw snapshotError(`activeRoutes references unknown node ${nodeId}`);
    const validated = validateActiveRoute(nodeId, route);
    if (validated.decisionIndex >= decisions.length) {
      throw snapshotError(`activeRoutes.${nodeId}.decisionIndex is out of range for decisions`);
    }
  }

  if (!Array.isArray(value.approvedActionIds) || !value.approvedActionIds.every((id) => isNonEmptyString(id))) {
    throw snapshotError("approvedActionIds must be an array of non-empty strings");
  }

  if (!isRecord(value.userDecisions)) throw snapshotError("userDecisions must be an object");
  for (const [id, decision] of Object.entries(value.userDecisions)) {
    if (!isNonEmptyString(id)) throw snapshotError("userDecisions keys must be non-empty strings");
    if (typeof decision !== "string" && typeof decision !== "boolean") {
      throw snapshotError(`userDecisions.${id} must be a string or boolean`);
    }
  }

  if (!isRecord(value.facts)) throw snapshotError("facts must be an object");
  for (const [key, fact] of Object.entries(value.facts)) {
    if (!isNonEmptyString(key)) throw snapshotError("facts keys must be non-empty strings");
    if (!isFactValue(fact)) throw snapshotError(`facts.${key} must be a string, boolean, or finite number`);
  }

  validateLedger(value.ledger);
  validateRoundEvent(value.pendingRoundEvent);
  const pendingApproval =
    value.pendingApproval === undefined ? undefined : validatePendingApproval(value.pendingApproval, decisions);

  assertWaiterInvariant(nodes, pendingApproval);

  if (value.remainingTimeMs !== undefined && !isFiniteNonNegative(value.remainingTimeMs)) {
    throw snapshotError("remainingTimeMs must be a non-negative finite number");
  }
  if (value.remainingCostUsd !== undefined && !isFiniteNonNegative(value.remainingCostUsd)) {
    throw snapshotError("remainingCostUsd must be a non-negative finite number");
  }

  return value as unknown as FlowchartSupervisorSnapshot;
}

export function validateFlowchartRunLimits(value: unknown): FlowchartRunLimits {
  if (!isRecord(value)) {
    throw new DomainValidationError("Invalid flowchart limits: expected an object");
  }
  if (!isPositiveInteger(value.maxConcurrentNodes)) {
    throw new DomainValidationError("Invalid flowchart limits: maxConcurrentNodes must be a positive integer");
  }
  if (!isPositiveInteger(value.maxConsecutiveStalls)) {
    throw new DomainValidationError("Invalid flowchart limits: maxConsecutiveStalls must be a positive integer");
  }
  if (value.remainingTimeMs !== undefined && !isFiniteNonNegative(value.remainingTimeMs)) {
    throw new DomainValidationError("Invalid flowchart limits: remainingTimeMs must be a non-negative finite number");
  }
  if (value.remainingCostUsd !== undefined && !isFiniteNonNegative(value.remainingCostUsd)) {
    throw new DomainValidationError("Invalid flowchart limits: remainingCostUsd must be a non-negative finite number");
  }
  if (value.minHumanConfidence !== undefined && !isConfidenceScore(value.minHumanConfidence)) {
    throw new DomainValidationError(
      "Invalid flowchart limits: minHumanConfidence must be a finite number between 0 and 1"
    );
  }
  return value as unknown as FlowchartRunLimits;
}

export function snapshotValidationRouter(): import("./model-router.js").ModelRouter {
  return {
    config: {
      policyVersion: "snapshot-validation",
      models: [
        {
          id: "validation-stub",
          roles: ROLES,
          maxComplexity: "HIGH",
          estimatedCostUsd: 0,
          estimatedDurationMs: 1
        }
      ]
    },
    route(): RoutingDecision {
      throw new DomainValidationError("snapshot validation must not route");
    }
  };
}
