import { DomainValidationError } from "./errors.js";
import { isTaskId, type TaskId } from "./ids.js";
import { isRecord } from "./record.js";

export const DEFAULT_HUMAN_CONFIDENCE = 0.7;

export type ConfidenceScore = number;

export function isConfidenceScore(value: unknown): value is ConfidenceScore {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateConfidenceScore(value: unknown, field = "confidence"): ConfidenceScore {
  if (!isConfidenceScore(value)) {
    throw new DomainValidationError(`${field} must be a finite number between 0 and 1`);
  }
  return value;
}

export interface ApprovalItem {
  readonly id: string;
  readonly label: string;
  readonly selectable: boolean;
  readonly defaultSelected?: boolean;
}

export interface ApprovalPlan {
  readonly id: string;
  readonly items: readonly ApprovalItem[];
}

/**
 * A user's reply to an approval plan. It references the plan by id; the plan
 * itself is only ever read from authoritative persisted state, never from the
 * reply.
 */
export interface ApprovalReply {
  readonly approvalPlanId: string;
  readonly selectedActionIds: readonly string[];
}

function approvalPlanError(value: unknown): string | undefined {
  if (!isRecord(value)) return "must be an object";
  if (!nonEmpty(value.id)) return "id must be a non-empty string";
  if (!Array.isArray(value.items) || value.items.length === 0) return "items must be a non-empty array";
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item)) return "each item must be an object";
    if (typeof item.id !== "string" || item.id.trim() === "") return "item id must be a non-empty string";
    if (ids.has(item.id)) return `duplicate item id: ${item.id}`;
    ids.add(item.id);
    if (typeof item.label !== "string" || item.label.trim() === "") return "item label must be a non-empty string";
    if (typeof item.selectable !== "boolean") return "item selectable must be a boolean";
    if (item.defaultSelected !== undefined && typeof item.defaultSelected !== "boolean") {
      return "item defaultSelected must be a boolean";
    }
    if (item.defaultSelected === true && item.selectable !== true) {
      return "a non-selectable item cannot be selected by default";
    }
  }
  return undefined;
}

export function validateApprovalPlan(value: unknown): ApprovalPlan {
  const reason = approvalPlanError(value);
  if (reason !== undefined) throw new DomainValidationError(`Invalid ApprovalPlan: ${reason}`);
  return value as ApprovalPlan;
}

function selectedActionIdsError(value: unknown): string | undefined {
  if (!Array.isArray(value)) return "selectedActionIds must be an array";
  if (!value.every((id) => nonEmpty(id))) return "selectedActionIds must contain non-empty strings";
  if (new Set(value as string[]).size !== value.length) return "selectedActionIds must be unique";
  return undefined;
}

/**
 * Validates the wire shape of a reply in isolation. This deliberately cannot
 * decide whether the selection is a legal subset: that requires the
 * authoritative plan, so callers must also use
 * {@link validateApprovalReplyAgainstPlan}.
 */
export function validateApprovalReplyShape(value: unknown): ApprovalReply {
  if (!isRecord(value)) throw new DomainValidationError("Invalid ApprovalReply: expected an object");
  if (!nonEmpty(value.approvalPlanId)) {
    throw new DomainValidationError("Invalid ApprovalReply: approvalPlanId must be a non-empty string");
  }
  const reason = selectedActionIdsError(value.selectedActionIds);
  if (reason !== undefined) throw new DomainValidationError(`Invalid ApprovalReply: ${reason}`);
  return value as unknown as ApprovalReply;
}

/** Validates a selection against an authoritative plan's selectable items. */
export function validateApprovalSelection(
  planValue: unknown,
  selectedActionIdsValue: unknown
): readonly string[] {
  const plan = validateApprovalPlan(planValue);
  const reason = selectedActionIdsError(selectedActionIdsValue);
  if (reason !== undefined) throw new DomainValidationError(reason);
  const selectedActionIds = selectedActionIdsValue as string[];
  const selectableIds = new Set(plan.items.filter((item) => item.selectable).map((item) => item.id));
  for (const id of selectedActionIds) {
    if (!selectableIds.has(id)) {
      throw new DomainValidationError(`selectedActionIds contains unknown or non-selectable action: ${id}`);
    }
  }
  return selectedActionIds;
}

/**
 * Correlates a reply with the plan that was persisted when the run started
 * waiting. The plan argument must come from authoritative state, never from the
 * reply itself.
 */
export function validateApprovalReplyAgainstPlan(planValue: unknown, replyValue: unknown): ApprovalReply {
  const plan = validateApprovalPlan(planValue);
  const reply = validateApprovalReplyShape(replyValue);
  if (reply.approvalPlanId !== plan.id) {
    throw new DomainValidationError(
      `approvalPlanId ${reply.approvalPlanId} does not match the pending plan ${plan.id}`
    );
  }
  validateApprovalSelection(plan, reply.selectedActionIds);
  return reply;
}

export type FlowchartNodeRole = "actor" | "critic" | "router" | "judge" | "tool" | "human";
export type TaskComplexity = "LOW" | "MEDIUM" | "HIGH";

export interface ModelPolicy {
  readonly allowedModels: readonly string[];
  readonly preferredModel?: string;
}

export interface JoinPolicy {
  readonly mode: "all" | "any" | "quorum";
  readonly requiredNodeIds: readonly string[];
  readonly quorum?: number;
}

export interface FlowNode {
  readonly id: string;
  readonly taskId: TaskId;
  readonly role: FlowchartNodeRole;
  readonly objective: string;
  readonly modelPolicy: ModelPolicy;
  readonly confidenceThreshold: ConfidenceScore;
  readonly approvalRequired: boolean;
  readonly parallelGroup?: string;
  readonly joinPolicy?: JoinPolicy;
}

export type SuccessCondition = {
  readonly type: "success";
  readonly expected: boolean;
};

export type EvidenceCountCondition = {
  readonly type: "evidence-count";
  readonly operator: "eq" | "gte" | "lte";
  readonly value: number;
};

export type ConfidenceCondition = {
  readonly type: "confidence";
  readonly operator: "gt" | "gte" | "lt" | "lte";
  readonly value: ConfidenceScore;
};

export type UserDecisionCondition = {
  readonly type: "user-decision";
  readonly decisionId: string;
  readonly equals: string | boolean;
};

export type CustomCondition = {
  readonly type: "custom";
  readonly key: string;
  readonly operator: "eq" | "neq";
  readonly value: string | number | boolean;
};

export type FlowEdgeCondition =
  | SuccessCondition
  | EvidenceCountCondition
  | ConfidenceCondition
  | UserDecisionCondition
  | CustomCondition;

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly condition: FlowEdgeCondition;
  /** When a decision gate auto-selects, this successor is included iff true (default true). */
  readonly defaultSelected?: boolean;
}

/** Compatibility name retained for existing supervisor imports. */
export type FlowchartEdge = FlowEdge;

/** Legacy join representation retained for import compatibility. */
export interface JoinRule {
  readonly required: readonly string[];
  readonly policy: "all" | "any" | "quorum";
  readonly quorum?: number;
}

export interface Flowchart {
  readonly id: string;
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  /** @deprecated Declare joins on the destination node with joinPolicy. */
  readonly joinRules?: Readonly<Record<string, JoinRule>>;
}

export interface DecisionPolicy {
  readonly version: string;
  readonly minHumanConfidence: ConfidenceScore;
  requiresApproval(confidence: ConfidenceScore, approvalRequired: boolean): boolean;
}

export interface EvidencePolicy {
  readonly version: string;
  accepts(confidence: ConfidenceScore): boolean;
}

export function defaultDecisionPolicy(
  minHumanConfidence: ConfidenceScore = DEFAULT_HUMAN_CONFIDENCE as ConfidenceScore
): DecisionPolicy {
  validateConfidenceScore(minHumanConfidence, "minHumanConfidence");
  return {
    version: "decision-v1",
    minHumanConfidence,
    requiresApproval: (confidence, approvalRequired) =>
      approvalRequired || confidence < minHumanConfidence
  };
}

export function defaultEvidencePolicy(
  minimumConfidence: ConfidenceScore = DEFAULT_HUMAN_CONFIDENCE as ConfidenceScore
): EvidencePolicy {
  validateConfidenceScore(minimumConfidence, "minimumConfidence");
  return {
    version: "evidence-v1",
    accepts: (confidence) => confidence >= minimumConfidence
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validateModelPolicy(policy: unknown, nodeId: string): asserts policy is ModelPolicy {
  if (!isRecord(policy) || !Array.isArray(policy.allowedModels) || policy.allowedModels.length === 0) {
    throw new DomainValidationError(`node ${nodeId} modelPolicy.allowedModels must be a non-empty array`);
  }
  if (!policy.allowedModels.every(nonEmpty) || new Set(policy.allowedModels).size !== policy.allowedModels.length) {
    throw new DomainValidationError(`node ${nodeId} modelPolicy.allowedModels must contain unique non-empty strings`);
  }
  if (policy.preferredModel !== undefined) {
    if (!nonEmpty(policy.preferredModel) || !policy.allowedModels.includes(policy.preferredModel)) {
      throw new DomainValidationError(`node ${nodeId} preferredModel must be in allowedModels`);
    }
  }
}

function validateCondition(condition: unknown): void {
  if (!isRecord(condition) || !nonEmpty(condition.type)) {
    throw new DomainValidationError("edge condition must be an object with a type");
  }
  switch (condition.type) {
    case "success":
      if (typeof condition.expected !== "boolean") {
        throw new DomainValidationError("success condition expected must be a boolean");
      }
      return;
    case "evidence-count":
      if (!["eq", "gte", "lte"].includes(String(condition.operator))) {
        throw new DomainValidationError("evidence-count condition has an invalid operator");
      }
      if (typeof condition.value !== "number" || !Number.isInteger(condition.value) || condition.value < 0) {
        throw new DomainValidationError("evidence-count condition value must be a non-negative integer");
      }
      return;
    case "confidence":
      if (!["gt", "gte", "lt", "lte"].includes(String(condition.operator))) {
        throw new DomainValidationError("confidence condition has an invalid operator");
      }
      validateConfidenceScore(condition.value, "confidence condition value");
      return;
    case "user-decision":
      if (!nonEmpty(condition.decisionId)) {
        throw new DomainValidationError("user-decision condition decisionId must be non-empty");
      }
      if (typeof condition.equals !== "string" && typeof condition.equals !== "boolean") {
        throw new DomainValidationError("user-decision condition equals must be a string or boolean");
      }
      return;
    case "custom":
      if (!nonEmpty(condition.key)) throw new DomainValidationError("custom condition key must be non-empty");
      if (!["eq", "neq"].includes(String(condition.operator))) {
        throw new DomainValidationError("custom condition has an invalid operator");
      }
      if (!["string", "number", "boolean"].includes(typeof condition.value) ||
          (typeof condition.value === "number" && !Number.isFinite(condition.value))) {
        throw new DomainValidationError("custom condition value must be a finite primitive");
      }
      return;
    default:
      throw new DomainValidationError(`unknown edge condition type: ${condition.type}`);
  }
}

function validateJoin(
  nodeId: string,
  joinValue: unknown,
  nodeIds: ReadonlySet<string>,
  edges: readonly FlowEdge[]
): void {
  if (!isRecord(joinValue)) {
    throw new DomainValidationError(`node ${nodeId} joinPolicy must be an object`);
  }
  const join = joinValue as unknown as JoinPolicy;
  if (!["all", "any", "quorum"].includes(join.mode)) {
    throw new DomainValidationError(`node ${nodeId} joinPolicy mode is invalid`);
  }
  if (!Array.isArray(join.requiredNodeIds) || join.requiredNodeIds.length === 0 ||
      !join.requiredNodeIds.every(nonEmpty) ||
      new Set(join.requiredNodeIds).size !== join.requiredNodeIds.length) {
    throw new DomainValidationError(`node ${nodeId} joinPolicy requires unique non-empty node references`);
  }
  for (const required of join.requiredNodeIds) {
    if (!nodeIds.has(required) || required === nodeId || !edges.some((edge) => edge.from === required && edge.to === nodeId)) {
      throw new DomainValidationError(`node ${nodeId} has malformed join reference: ${required}`);
    }
  }
  if (join.mode === "quorum") {
    if (!Number.isInteger(join.quorum) || join.quorum! < 1 || join.quorum! > join.requiredNodeIds.length) {
      throw new DomainValidationError(`node ${nodeId} quorum must be within requiredNodeIds`);
    }
  } else if (join.quorum !== undefined) {
    throw new DomainValidationError(`node ${nodeId} quorum is only valid for quorum joins`);
  }
}

export function validateFlowchart(value: unknown): Flowchart {
  if (!isRecord(value)) throw new DomainValidationError("Invalid Flowchart: expected an object");
  if (!nonEmpty(value.id)) throw new DomainValidationError("Invalid Flowchart: id must be non-empty");
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw new DomainValidationError("Invalid Flowchart: nodes must be a non-empty array");
  }
  if (!Array.isArray(value.edges)) throw new DomainValidationError("Invalid Flowchart: edges must be an array");

  const nodes = value.nodes as unknown[];
  const nodeIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const rawNode of nodes) {
    if (!isRecord(rawNode) || !nonEmpty(rawNode.id)) {
      throw new DomainValidationError("flowchart node id must be non-empty");
    }
    if (nodeIds.has(rawNode.id)) throw new DomainValidationError(`duplicate node id: ${rawNode.id}`);
    nodeIds.add(rawNode.id);
    if (!isTaskId(rawNode.taskId)) throw new DomainValidationError(`node ${rawNode.id} taskId is invalid`);
    if (taskIds.has(rawNode.taskId)) throw new DomainValidationError(`duplicate taskId: ${rawNode.taskId}`);
    taskIds.add(rawNode.taskId);
    if (!["actor", "critic", "router", "judge", "tool", "human"].includes(String(rawNode.role))) {
      throw new DomainValidationError(`node ${rawNode.id} role is invalid`);
    }
    if (!nonEmpty(rawNode.objective)) throw new DomainValidationError(`node ${rawNode.id} objective must be non-empty`);
    validateModelPolicy(rawNode.modelPolicy, rawNode.id);
    validateConfidenceScore(rawNode.confidenceThreshold, `node ${rawNode.id} confidenceThreshold`);
    if (typeof rawNode.approvalRequired !== "boolean") {
      throw new DomainValidationError(`node ${rawNode.id} approvalRequired must be a boolean`);
    }
    if (rawNode.parallelGroup !== undefined && !nonEmpty(rawNode.parallelGroup)) {
      throw new DomainValidationError(`node ${rawNode.id} parallelGroup must be non-empty`);
    }
  }

  const edges = value.edges as unknown[];
  const edgePairs = new Set<string>();
  for (const rawEdge of edges) {
    if (!isRecord(rawEdge) || !nonEmpty(rawEdge.from) || !nonEmpty(rawEdge.to)) {
      throw new DomainValidationError("flowchart edge endpoints must be non-empty");
    }
    if (!nodeIds.has(rawEdge.from) || !nodeIds.has(rawEdge.to)) {
      throw new DomainValidationError(`edge references unknown node: ${rawEdge.from}->${rawEdge.to}`);
    }
    if (rawEdge.from === rawEdge.to) throw new DomainValidationError(`self edge is not allowed: ${rawEdge.from}`);
    const pair = `${rawEdge.from}\u0000${rawEdge.to}`;
    if (edgePairs.has(pair)) {
      throw new DomainValidationError(`duplicate edge: ${rawEdge.from}->${rawEdge.to}`);
    }
    edgePairs.add(pair);
    validateCondition(rawEdge.condition);
    if (rawEdge.defaultSelected !== undefined && typeof rawEdge.defaultSelected !== "boolean") {
      throw new DomainValidationError("edge defaultSelected must be a boolean");
    }
  }

  const flowchart = value as unknown as Flowchart;
  for (const node of flowchart.nodes) {
    if (node.joinPolicy !== undefined) validateJoin(node.id, node.joinPolicy, nodeIds, flowchart.edges);
  }
  if (flowchart.joinRules !== undefined) {
    if (!isRecord(flowchart.joinRules)) {
      throw new DomainValidationError("joinRules must be an object");
    }
    for (const [nodeId, rule] of Object.entries(flowchart.joinRules)) {
      if (!isRecord(rule)) throw new DomainValidationError(`joinRules.${nodeId} must be an object`);
      validateJoin(nodeId, {
        mode: rule.policy,
        requiredNodeIds: rule.required,
        ...(rule.quorum !== undefined ? { quorum: rule.quorum } : {})
      }, nodeIds, flowchart.edges);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of flowchart.edges) {
    const destinations = adjacency.get(edge.from) ?? [];
    destinations.push(edge.to);
    adjacency.set(edge.from, destinations);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new DomainValidationError("flowchart contains a cycle");
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const destination of adjacency.get(nodeId) ?? []) visit(destination);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodeIds) visit(nodeId);
  return flowchart;
}

/** Compatibility name retained for existing supervisor imports. */
export type FlowchartNode = FlowNode;
