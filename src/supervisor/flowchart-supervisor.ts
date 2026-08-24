import { DomainValidationError } from "../domain/errors.js";
import {
  validateApprovalReplyAgainstPlan,
  validateFlowchart,
  type ApprovalItem,
  type ApprovalPlan,
  type ApprovalReply,
  type ConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowEdgeCondition,
  type FlowNode,
  type JoinPolicy,
  type ModelRouter,
  type RoutingDecision,
  type TaskComplexity
} from "./flowchart.js";
import {
  createAgentInstanceId,
  createMessageId,
  createRunId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import { SUPERVISOR, validateAgentMessage, type AgentQuestion } from "../protocol/v1.js";
import {
  advanceLedgerRound,
  classifyRoundProgress,
  createLedger,
  type LedgerFact,
  type LedgerRoundEvent,
  type RunLedger
} from "./ledger.js";
import { validateFlowchartSupervisorSnapshot } from "./flowchart-snapshot.js";

export { validateFlowchartSupervisorSnapshot } from "./flowchart-snapshot.js";

/** Per-node lifecycle state tracked by the deterministic flowchart engine. */
export type FlowNodeState =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

/** Overall run status derived from node states, pending approval, and stalls. */
export type FlowchartRunStatus = "RUNNING" | "WAITING_FOR_USER" | "PAUSED" | "COMPLETED" | "BLOCKED" | "FAILED";

export type FactValue = string | number | boolean;

/** Serializable per-node runtime record. */
export interface FlowNodeRuntime {
  readonly state: FlowNodeState;
  readonly confidence?: ConfidenceScore;
  readonly success?: boolean;
  readonly evidenceCount: number;
  /** The most recently routed model, retained across RUNNING/WAITING/COMPLETED. */
  readonly model?: string;
  readonly parallelGroup?: string;
}

/** An active model route attributable to a leased (RUNNING or WAITING) node. */
export interface ActiveRoute {
  readonly nodeId: string;
  readonly model: string;
  readonly decisionIndex: number;
}

/**
 * Approvals have two distinct meanings and must never be conflated:
 *
 * - `ROUTE` authorizes an executable node to run on its routed model. Approving
 *   it returns the node to RUNNING with its active route retained; the node is
 *   only COMPLETED once a child result arrives.
 * - `BRANCH` resolves a decision gate (a `human` or `router` node that performs
 *   no child execution). Approving it completes the gate and skips every
 *   successor the user did not select.
 */
export type ApprovalKind = "ROUTE" | "BRANCH";

/** The item id that authorizes cancelling a routed execution. */
export const ROUTE_CANCEL_ACTION_ID = "route:cancel";

/** The authoritative approval the run is currently blocked on. */
export interface PendingApproval {
  readonly kind: ApprovalKind;
  readonly nodeId: string;
  /**
   * The plan actually shown to and persisted for the user. For `ROUTE` this is
   * verbatim `decisions[decisionIndex].approvalPlan`; for `BRANCH` it is the
   * supervisor-built successor plan. Nothing silently replaces it.
   */
  readonly plan: ApprovalPlan;
  /** Index into `decisions` of the route that raised this approval. */
  readonly decisionIndex: number;
  /** For `ROUTE` approvals, the item id that authorizes execution. */
  readonly approveActionId?: string;
  readonly question: AgentQuestion;
  readonly routedConfidence: ConfidenceScore;
}

/** Fully serializable snapshot usable for restore (T14 persists it durably). */
export interface FlowchartSupervisorSnapshot {
  readonly flowchartId: string;
  readonly status: FlowchartRunStatus;
  readonly nodes: Readonly<Record<string, FlowNodeRuntime>>;
  readonly decisions: readonly RoutingDecision[];
  readonly activeRoutes: Readonly<Record<string, ActiveRoute>>;
  readonly approvedActionIds: readonly string[];
  readonly userDecisions: Readonly<Record<string, string | boolean>>;
  readonly facts: Readonly<Record<string, FactValue>>;
  readonly ledger: RunLedger;
  readonly pendingApproval?: PendingApproval;
  readonly pendingRoundEvent: LedgerRoundEvent;
  /** Remaining per-run budget after successful MODEL_ROUTED decisions. */
  readonly remainingTimeMs?: number;
  readonly remainingCostUsd?: number;
}

export interface FlowchartRunLimits {
  readonly maxConcurrentNodes: number;
  readonly maxConsecutiveStalls: number;
  readonly remainingTimeMs?: number;
  readonly remainingCostUsd?: number;
  readonly minHumanConfidence?: ConfidenceScore;
}

export interface FlowchartSupervisorConfig {
  readonly flowchart: Flowchart;
  readonly router: ModelRouter;
  readonly limits?: Partial<FlowchartRunLimits>;
  readonly complexityOf?: (node: FlowNode) => TaskComplexity;
  readonly objective?: string;
  readonly runId?: RunId;
  readonly generateId?: IdGenerator;
  readonly now?: () => IsoTimestamp;
  /** When present, the supervisor restores from this snapshot instead of a fresh run. */
  readonly snapshot?: FlowchartSupervisorSnapshot;
}

/** The outcome of leasing one ready node through the ModelRouter. */
export interface NodeLease {
  readonly nodeId: string;
  readonly taskId: TaskId;
  readonly model: string;
  readonly decision: RoutingDecision;
  /** COMPLETED is a decision gate that auto-selected defaultSelected successors. */
  readonly status: "RUNNING" | "WAITING_FOR_USER" | "COMPLETED";
  readonly parallelGroup?: string;
  readonly question?: AgentQuestion;
}

/** A child TASK_RESULT projected onto node/ledger state. */
export interface ChildNodeResult {
  readonly outcome: "SUCCESS" | "PARTIAL" | "FAILURE";
  readonly confidence?: ConfidenceScore;
  readonly evidenceIds?: readonly string[];
  readonly facts?: readonly LedgerFact[];
}

/** A mid-flight progress signal from a running child. */
export interface ChildNodeProgress {
  readonly evidenceIds?: readonly string[];
  readonly facts?: readonly LedgerFact[];
}

/** Typed injection the coordinator may apply without executing user strings. */
export type FlowchartInjection =
  | { readonly kind: "fact"; readonly key: string; readonly value: FactValue; readonly confidence: ConfidenceScore }
  | { readonly kind: "override"; readonly nodeId: string; readonly confidence: ConfidenceScore }
  | { readonly kind: "skip"; readonly nodeId: string };

/**
 * What an authorized `RUN_UNBLOCKED` asks the flowchart state machine to undo.
 *
 * `retryNodeId` names the FAILED node to re-drive for a gate block; a
 * run-level stall unblock leaves it absent and only clears the ledger latch.
 */
export interface FlowchartReopenRequest {
  readonly retryNodeId?: string;
}

/**
 * What a `RUN_UNBLOCKED_WITH_DISCARD` asks for. The target is required: the
 * discard is defined relative to one node's consequences, so a run-level stall
 * unblock has nothing for it to mean.
 */
export interface FlowchartDiscardRequest {
  readonly retryNodeId: string;
}

/** Node states a reopen refuses to rewind, because they represent work already done. */
const EXECUTED_NODE_STATES: ReadonlySet<FlowNodeState> = new Set([
  "RUNNING",
  "WAITING_FOR_USER",
  "COMPLETED",
  "FAILED"
]);

/**
 * One node the discard transform rewound, as the state machine saw it.
 *
 * The plan carries control-state identity only. Attempt references, charged
 * estimates and everything else the audit record needs live on the run log, and
 * the supervisor has no view of it — deriving them here would mean inventing a
 * second source for facts the log already holds.
 */
export interface RewoundNodeRecord {
  readonly nodeId: string;
  readonly taskId: TaskId;
  readonly previousState: Exclude<FlowNodeState, "PENDING">;
}

/** A discard transform's result: the reopened snapshot and what it superseded. */
export interface FlowchartDiscardPlan {
  readonly snapshot: FlowchartSupervisorSnapshot;
  readonly rewound: readonly RewoundNodeRecord[];
}

export interface AdvanceRoundResult {
  readonly round: number;
  readonly consecutiveStalls: number;
  readonly blocked: boolean;
  readonly progress: boolean;
}

export interface FlowchartSupervisor {
  readonly status: FlowchartRunStatus;
  readonly decisions: readonly RoutingDecision[];
  readonly pendingApproval: PendingApproval | undefined;
  nodeState(nodeId: string): FlowNodeState;
  nodeRuntime(nodeId: string): FlowNodeRuntime;
  readyNodeIds(): readonly string[];
  leaseReadyNodes(): readonly NodeLease[];
  applyChildResult(nodeId: string, result: ChildNodeResult): void;
  applyProgress(nodeId: string, progress: ChildNodeProgress): void;
  applyUserDecision(decisionId: string, value: string | boolean): void;
  applyApprovalReply(reply: ApprovalReply): readonly string[];
  applyInjection(injection: FlowchartInjection): void;
  advanceRound(): AdvanceRoundResult;
  snapshot(): FlowchartSupervisorSnapshot;
}

type EdgeStatus = "SATISFIED" | "UNSATISFIED" | "PENDING";
type JoinStatus = "READY" | "PENDING" | "DEAD";

const DEFAULT_LIMITS: FlowchartRunLimits = {
  maxConcurrentNodes: 4,
  maxConsecutiveStalls: 3,
  remainingTimeMs: Number.MAX_SAFE_INTEGER
};

function defaultComplexity(node: FlowNode): TaskComplexity {
  return node.role === "judge" || node.role === "router" ? "HIGH" : "MEDIUM";
}

/**
 * Only `human` and `router` nodes are decision gates: they choose successors
 * instead of executing work, so resolving their approval legitimately completes
 * them. Every other role must still run a child before it can complete.
 */
function isDecisionGate(node: FlowNode): boolean {
  return node.role === "human" || node.role === "router";
}

function emptyRoundEvent(): LedgerRoundEvent {
  return {
    completedTasks: [],
    newEvidenceIds: [],
    newFacts: [],
    resolvedBlockers: [],
    userDecision: false
  };
}

class FlowchartSupervisorImpl implements FlowchartSupervisor {
  private readonly flowchart: Flowchart;
  private readonly router: ModelRouter;
  private readonly limits: FlowchartRunLimits;
  private readonly complexityOf: (node: FlowNode) => TaskComplexity;
  private readonly runId: RunId;
  private readonly generateId: IdGenerator | undefined;
  private readonly now: () => IsoTimestamp;

  private readonly nodesById = new Map<string, FlowNode>();
  private readonly incoming = new Map<string, FlowEdge[]>();
  private readonly outgoing = new Map<string, FlowEdge[]>();
  /** Node joins plus normalized deprecated `flowchart.joinRules` entries. */
  private readonly joinPolicies = new Map<string, JoinPolicy>();

  private readonly runtime = new Map<string, FlowNodeRuntime>();
  private readonly activeRoutes = new Map<string, ActiveRoute>();
  private readonly userDecisions = new Map<string, string | boolean>();
  private readonly facts = new Map<string, FactValue>();
  private routingDecisions: RoutingDecision[] = [];
  private ledger: RunLedger;
  private pending: PendingApproval | undefined;
  private roundEvent: LedgerRoundEvent = emptyRoundEvent();
  private approvedActionIds: string[] = [];
  private remainingTimeMs: number;
  private remainingCostUsd?: number;

  constructor(config: FlowchartSupervisorConfig) {
    this.flowchart = validateFlowchart(config.flowchart);
    this.router = config.router;
    this.limits = { ...DEFAULT_LIMITS, ...config.limits };
    if (!Number.isInteger(this.limits.maxConcurrentNodes) || this.limits.maxConcurrentNodes < 1) {
      throw new DomainValidationError("maxConcurrentNodes must be a positive integer");
    }
    if (!Number.isInteger(this.limits.maxConsecutiveStalls) || this.limits.maxConsecutiveStalls < 1) {
      throw new DomainValidationError("maxConsecutiveStalls must be a positive integer");
    }
    this.complexityOf = config.complexityOf ?? defaultComplexity;
    this.runId = config.runId ?? createRunId(config.generateId);
    this.generateId = config.generateId;
    this.now = config.now ?? nowIso;
    this.remainingTimeMs = this.limits.remainingTimeMs ?? Number.MAX_SAFE_INTEGER;
    if (this.limits.remainingCostUsd !== undefined) {
      this.remainingCostUsd = this.limits.remainingCostUsd;
    }

    for (const node of this.flowchart.nodes) {
      this.nodesById.set(node.id, node);
      this.incoming.set(node.id, []);
      this.outgoing.set(node.id, []);
    }
    for (const edge of this.flowchart.edges) {
      this.incoming.get(edge.to)!.push(edge);
      this.outgoing.get(edge.from)!.push(edge);
    }
    this.normalizeJoins();

    if (config.snapshot !== undefined) {
      this.restore(config.snapshot);
      this.ledger = structuredClone(config.snapshot.ledger);
    } else {
      this.ledger = createLedger(config.objective ?? this.flowchart.id, this.limits.maxConsecutiveStalls);
      for (const node of this.flowchart.nodes) {
        this.runtime.set(node.id, {
          state: "PENDING",
          evidenceCount: 0,
          ...(node.parallelGroup !== undefined ? { parallelGroup: node.parallelGroup } : {})
        });
      }
      this.propagate();
    }
  }

  /**
   * T12 still validates the deprecated `joinRules` map, so execution honours it
   * by folding each rule into the destination node's join policy. Declaring a
   * join twice for one node is rejected rather than silently resolved.
   */
  private normalizeJoins(): void {
    for (const node of this.flowchart.nodes) {
      if (node.joinPolicy !== undefined) this.joinPolicies.set(node.id, node.joinPolicy);
    }
    const legacy = this.flowchart.joinRules;
    if (legacy === undefined) return;
    for (const [nodeId, rule] of Object.entries(legacy)) {
      if (!this.nodesById.has(nodeId)) {
        throw new DomainValidationError(`joinRules references unknown node: ${nodeId}`);
      }
      if (this.joinPolicies.has(nodeId)) {
        throw new DomainValidationError(
          `node ${nodeId} declares both joinPolicy and a deprecated joinRules entry`
        );
      }
      this.joinPolicies.set(nodeId, {
        mode: rule.policy,
        requiredNodeIds: rule.required,
        ...(rule.quorum !== undefined ? { quorum: rule.quorum } : {})
      });
    }
  }

  private restore(snapshot: FlowchartSupervisorSnapshot): void {
    const validated = validateFlowchartSupervisorSnapshot(snapshot);
    if (validated.flowchartId !== this.flowchart.id) {
      throw new DomainValidationError(
        `snapshot flowchartId ${validated.flowchartId} does not match flowchart ${this.flowchart.id}`
      );
    }
    for (const nodeId of Object.keys(validated.nodes)) {
      if (!this.nodesById.has(nodeId)) {
        throw new DomainValidationError(`snapshot has runtime for unknown node ${nodeId}`);
      }
    }
    for (const node of this.flowchart.nodes) {
      const runtime = validated.nodes[node.id];
      if (runtime === undefined) {
        throw new DomainValidationError(`snapshot is missing runtime for node ${node.id}`);
      }
      this.runtime.set(node.id, structuredClone(runtime));
    }
    this.routingDecisions = structuredClone(validated.decisions) as RoutingDecision[];
    for (const [nodeId, route] of Object.entries(validated.activeRoutes)) {
      if (!this.nodesById.has(nodeId)) {
        throw new DomainValidationError(`snapshot activeRoutes references unknown node ${nodeId}`);
      }
      this.activeRoutes.set(nodeId, structuredClone(route));
    }
    for (const [id, value] of Object.entries(validated.userDecisions)) {
      this.userDecisions.set(id, value);
    }
    for (const [key, value] of Object.entries(validated.facts)) {
      this.facts.set(key, value);
    }
    this.approvedActionIds = [...validated.approvedActionIds];
    this.pending = validated.pendingApproval === undefined ? undefined : structuredClone(validated.pendingApproval);
    this.roundEvent = structuredClone(validated.pendingRoundEvent);
    if (validated.remainingTimeMs !== undefined) {
      this.remainingTimeMs = validated.remainingTimeMs;
    }
    if (validated.remainingCostUsd !== undefined) {
      this.remainingCostUsd = validated.remainingCostUsd;
    }
    this.assertWaiterInvariant();
  }

  /** WAITING_FOR_USER ⇔ pendingApproval, and at most one waiter. */
  private assertWaiterInvariant(): void {
    const waiters: string[] = [];
    for (const [nodeId, runtime] of this.runtime) {
      if (runtime.state === "WAITING_FOR_USER") waiters.push(nodeId);
    }
    if (waiters.length > 1) {
      throw new DomainValidationError("at most one WAITING_FOR_USER node is allowed");
    }
    if (this.pending === undefined) {
      if (waiters.length > 0) {
        throw new DomainValidationError(`WAITING_FOR_USER node ${waiters[0]} requires pendingApproval`);
      }
      return;
    }
    if (waiters.length === 0) {
      throw new DomainValidationError(
        `pendingApproval node ${this.pending.nodeId} must be WAITING_FOR_USER`
      );
    }
    if (waiters[0] !== this.pending.nodeId) {
      throw new DomainValidationError(
        `pendingApproval node ${this.pending.nodeId} must be the WAITING_FOR_USER node`
      );
    }
  }

  private node(nodeId: string): FlowNode {
    const node = this.nodesById.get(nodeId);
    if (node === undefined) throw new DomainValidationError(`unknown node: ${nodeId}`);
    return node;
  }

  private getRuntime(nodeId: string): FlowNodeRuntime {
    const runtime = this.runtime.get(nodeId);
    if (runtime === undefined) throw new DomainValidationError(`unknown node: ${nodeId}`);
    return runtime;
  }

  private setRuntime(nodeId: string, patch: Partial<FlowNodeRuntime>): void {
    this.runtime.set(nodeId, { ...this.getRuntime(nodeId), ...patch });
  }

  nodeState(nodeId: string): FlowNodeState {
    return this.getRuntime(nodeId).state;
  }

  nodeRuntime(nodeId: string): FlowNodeRuntime {
    return structuredClone(this.getRuntime(nodeId));
  }

  get status(): FlowchartRunStatus {
    return this.computeStatus();
  }

  get pendingApproval(): PendingApproval | undefined {
    return this.pending === undefined ? undefined : structuredClone(this.pending);
  }

  private computeStatus(): FlowchartRunStatus {
    if (this.ledger.isBlocked) return "BLOCKED";
    if (this.pending !== undefined) return "WAITING_FOR_USER";
    let hasFailed = false;
    for (const runtime of this.runtime.values()) {
      if (
        runtime.state === "PENDING" ||
        runtime.state === "READY" ||
        runtime.state === "RUNNING" ||
        runtime.state === "WAITING_FOR_USER"
      ) {
        return "RUNNING";
      }
      if (runtime.state === "FAILED") hasFailed = true;
    }
    if (hasFailed && !this.failurePathCompletedGraph()) return "FAILED";
    return "COMPLETED";
  }

  /**
   * A FAILED node does not fail the run when a `success: expected false` recovery
   * path actually completed the graph. Unhandled failures (no such completed
   * successor, directly or through a chain of failed recoveries) keep the run FAILED.
   */
  private failurePathCompletedGraph(): boolean {
    const failedIds: string[] = [];
    for (const [nodeId, runtime] of this.runtime) {
      if (runtime.state === "FAILED") failedIds.push(nodeId);
    }
    if (failedIds.length === 0) return true;
    const visiting = new Set<string>();
    const handled = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const edge of this.outgoing.get(nodeId) ?? []) {
        if (edge.condition.type !== "success" || edge.condition.expected !== false) continue;
        const dest = this.getRuntime(edge.to).state;
        if (dest === "COMPLETED") return true;
        if (dest === "FAILED" && handled(edge.to)) return true;
      }
      visiting.delete(nodeId);
      return false;
    };
    return failedIds.every((nodeId) => handled(nodeId));
  }

  private conditionHolds(condition: FlowEdgeCondition, fromId: string): boolean {
    const runtime = this.getRuntime(fromId);
    switch (condition.type) {
      case "success":
        return (runtime.success ?? false) === condition.expected;
      case "evidence-count": {
        const count = runtime.evidenceCount;
        if (condition.operator === "eq") return count === condition.value;
        if (condition.operator === "gte") return count >= condition.value;
        return count <= condition.value;
      }
      case "confidence": {
        const confidence = runtime.confidence ?? 0;
        if (condition.operator === "gt") return confidence > condition.value;
        if (condition.operator === "gte") return confidence >= condition.value;
        if (condition.operator === "lt") return confidence < condition.value;
        return confidence <= condition.value;
      }
      case "user-decision": {
        if (!this.userDecisions.has(condition.decisionId)) return false;
        return this.userDecisions.get(condition.decisionId) === condition.equals;
      }
      case "custom": {
        if (!this.facts.has(condition.key)) return false;
        const value = this.facts.get(condition.key);
        return condition.operator === "eq" ? value === condition.value : value !== condition.value;
      }
    }
  }

  /**
   * Edge status is read purely from declared state. A branch whose source is
   * SKIPPED (unselected) or FAILED can never satisfy a success/evidence join,
   * so it cannot accidentally unblock a downstream node.
   */
  private edgeStatus(edge: FlowEdge): EdgeStatus {
    const from = this.getRuntime(edge.from).state;
    if (from === "SKIPPED") return "UNSATISFIED";
    if (from === "FAILED") {
      if (edge.condition.type === "success" && edge.condition.expected === false) return "SATISFIED";
      return "UNSATISFIED";
    }
    if (from !== "COMPLETED") return "PENDING";

    // A user decision or custom fact may legitimately arrive after its source
    // node finishes, so an absent datum is undetermined rather than false.
    // Treating it as false would wrongly skip the branch that is still waiting.
    const condition = edge.condition;
    if (condition.type === "user-decision" && !this.userDecisions.has(condition.decisionId)) return "PENDING";
    if (condition.type === "custom" && !this.facts.has(condition.key)) return "PENDING";
    return this.conditionHolds(condition, edge.from) ? "SATISFIED" : "UNSATISFIED";
  }

  private joinStatus(nodeId: string): JoinStatus {
    const incoming = this.incoming.get(nodeId)!;
    if (incoming.length === 0) return "READY";

    const join = this.joinPolicies.get(nodeId);
    const relevant =
      join === undefined ? incoming : incoming.filter((edge) => join.requiredNodeIds.includes(edge.from));
    if (relevant.length === 0) return "READY";

    const statuses = relevant.map((edge) => this.edgeStatus(edge));
    const satisfied = statuses.filter((status) => status === "SATISFIED").length;
    const pending = statuses.filter((status) => status === "PENDING").length;
    const mode = join?.mode ?? "all";

    if (mode === "all") {
      if (satisfied === statuses.length) return "READY";
      if (pending === 0) return "DEAD";
      return "PENDING";
    }
    if (mode === "any") {
      if (satisfied > 0) return "READY";
      if (pending === 0) return "DEAD";
      return "PENDING";
    }
    const quorum = join?.quorum ?? statuses.length;
    if (satisfied >= quorum) return "READY";
    if (satisfied + pending < quorum) return "DEAD";
    return "PENDING";
  }

  /** Fixpoint that promotes satisfied PENDING nodes to READY and kills dead ones. */
  private propagate(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.flowchart.nodes) {
        if (this.getRuntime(node.id).state !== "PENDING") continue;
        const join = this.joinStatus(node.id);
        if (join === "READY") {
          this.setRuntime(node.id, { state: "READY" });
          changed = true;
        } else if (join === "DEAD") {
          this.setRuntime(node.id, { state: "SKIPPED" });
          changed = true;
        }
      }
    }
  }

  readyNodeIds(): readonly string[] {
    return this.flowchart.nodes
      .filter((node) => this.getRuntime(node.id).state === "READY")
      .map((node) => node.id);
  }

  private routingLimits(): {
    remainingTimeMs: number;
    remainingCostUsd?: number;
    minHumanConfidence?: ConfidenceScore;
  } {
    return {
      remainingTimeMs: this.remainingTimeMs,
      ...(this.remainingCostUsd !== undefined ? { remainingCostUsd: this.remainingCostUsd } : {}),
      ...(this.limits.minHumanConfidence !== undefined
        ? { minHumanConfidence: this.limits.minHumanConfidence }
        : {})
    };
  }

  private consumeRoute(decision: RoutingDecision): void {
    this.remainingTimeMs = Math.max(0, this.remainingTimeMs - decision.estimatedDurationMs);
    if (this.remainingCostUsd !== undefined) {
      this.remainingCostUsd = Math.max(0, this.remainingCostUsd - decision.estimatedCostUsd);
    }
  }

  /**
   * A node awaiting route approval still holds its lease, so it occupies a
   * concurrency slot: approving it must never oversubscribe maxConcurrentNodes.
   */
  private activeCount(): number {
    let count = 0;
    for (const runtime of this.runtime.values()) {
      if (runtime.state === "RUNNING" || runtime.state === "WAITING_FOR_USER") count += 1;
    }
    return count;
  }

  private buildBranchPlan(node: FlowNode): ApprovalPlan {
    const targets: Array<{ id: string; defaultSelected: boolean }> = [];
    const seen = new Set<string>();
    for (const edge of this.outgoing.get(node.id)!) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      targets.push({ id: edge.to, defaultSelected: edge.defaultSelected !== false });
    }
    const items: ApprovalItem[] =
      targets.length === 0
        ? [{ id: node.id, label: `Run ${node.id}`, selectable: true, defaultSelected: true }]
        : targets.map((target) => ({
            id: target.id,
            label: `Execute ${target.id}`,
            selectable: true,
            defaultSelected: target.defaultSelected
          }));
    return { id: `approval:branch:${node.id}`, items };
  }

  private buildQuestion(
    node: FlowNode,
    decision: RoutingDecision,
    plan: ApprovalPlan,
    kind: ApprovalKind
  ): AgentQuestion {
    const prompt =
      kind === "ROUTE"
        ? `Approve running node ${node.id} (${node.objective}) on ${decision.model}?`
        : `Choose which successors of node ${node.id} (${node.objective}) to execute.`;
    const question: AgentQuestion = {
      protocolVersion: 1,
      id: createMessageId(this.generateId),
      occurredAt: this.now(),
      runId: this.runId,
      taskId: node.taskId,
      from: createAgentInstanceId(this.generateId),
      to: SUPERVISOR,
      type: "QUESTION",
      question: prompt,
      confidence: decision.confidence,
      rationale: decision.justification,
      approvalPlan: plan
    };
    return validateAgentMessage(question) as AgentQuestion;
  }

  leaseReadyNodes(): readonly NodeLease[] {
    if (this.computeStatus() !== "RUNNING") return [];

    const leases: NodeLease[] = [];
    for (const node of this.flowchart.nodes) {
      if (this.pending !== undefined) break;
      if (this.computeStatus() !== "RUNNING") break;
      const available = this.limits.maxConcurrentNodes - this.activeCount();
      if (available <= 0) break;
      if (this.getRuntime(node.id).state !== "READY") continue;

      let decision: RoutingDecision;
      try {
        decision = this.router.route({
          taskId: node.taskId,
          role: node.role,
          complexity: this.complexityOf(node),
          modelPolicy: node.modelPolicy,
          confidenceThreshold: node.confidenceThreshold,
          approvalRequired: node.approvalRequired,
          limits: this.routingLimits()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/fits the remaining cost and time limits/i.test(message)) {
          this.setRuntime(node.id, { state: "FAILED", success: false });
          this.propagate();
          break;
        }
        throw error;
      }
      const decisionIndex = this.routingDecisions.length;
      this.routingDecisions.push(decision);
      this.consumeRoute(decision);
      this.setRuntime(node.id, { model: decision.model });

      if (isDecisionGate(node)) {
        const plan = this.buildBranchPlan(node);
        if (decision.statusAfterRoute === "WAITING_FOR_USER") {
          const question = this.buildQuestion(node, decision, plan, "BRANCH");
          this.activeRoutes.set(node.id, { nodeId: node.id, model: decision.model, decisionIndex });
          this.pending = {
            kind: "BRANCH",
            nodeId: node.id,
            plan,
            decisionIndex,
            question,
            routedConfidence: decision.confidence
          };
          this.setRuntime(node.id, { state: "WAITING_FOR_USER" });
          leases.push({
            nodeId: node.id,
            taskId: node.taskId,
            model: decision.model,
            decision,
            status: "WAITING_FOR_USER",
            question,
            ...(node.parallelGroup !== undefined ? { parallelGroup: node.parallelGroup } : {})
          });
          break;
        }
        const selected = plan.items
          .filter((item) => item.selectable && item.defaultSelected === true)
          .map((item) => item.id);
        this.resolveBranchGate(node.id, plan, selected, decision.confidence);
        this.approvedActionIds = [...this.approvedActionIds, ...selected];
        this.propagate();
        leases.push({
          nodeId: node.id,
          taskId: node.taskId,
          model: decision.model,
          decision,
          status: "COMPLETED",
          ...(node.parallelGroup !== undefined ? { parallelGroup: node.parallelGroup } : {})
        });
        continue;
      }

      this.activeRoutes.set(node.id, { nodeId: node.id, model: decision.model, decisionIndex });
      if (decision.statusAfterRoute === "WAITING_FOR_USER") {
        const plan = decision.approvalPlan;
        const question = this.buildQuestion(node, decision, plan, "ROUTE");
        this.pending = {
          kind: "ROUTE",
          nodeId: node.id,
          plan,
          decisionIndex,
          question,
          routedConfidence: decision.confidence,
          approveActionId: `route:${decision.model}`
        };
        this.setRuntime(node.id, { state: "WAITING_FOR_USER" });
        leases.push({
          nodeId: node.id,
          taskId: node.taskId,
          model: decision.model,
          decision,
          status: "WAITING_FOR_USER",
          question,
          ...(node.parallelGroup !== undefined ? { parallelGroup: node.parallelGroup } : {})
        });
        break;
      }

      this.setRuntime(node.id, { state: "RUNNING" });
      leases.push({
        nodeId: node.id,
        taskId: node.taskId,
        model: decision.model,
        decision,
        status: "RUNNING",
        ...(node.parallelGroup !== undefined ? { parallelGroup: node.parallelGroup } : {})
      });
    }
    return leases;
  }

  applyChildResult(nodeId: string, result: ChildNodeResult): void {
    const node = this.node(nodeId);
    if (this.getRuntime(nodeId).state !== "RUNNING") {
      throw new DomainValidationError(`node ${nodeId} is not RUNNING and cannot accept a result`);
    }
    this.activeRoutes.delete(nodeId);

    const evidence = result.evidenceIds ?? [];
    const facts = result.facts ?? [];
    const success = result.outcome !== "FAILURE";
    const evidenceCount = this.getRuntime(nodeId).evidenceCount + evidence.length;

    this.setRuntime(nodeId, {
      state: success ? "COMPLETED" : "FAILED",
      success,
      evidenceCount,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {})
    });

    for (const fact of facts) this.facts.set(fact.key, fact.value);

    if (success) this.roundEvent.completedTasks.push(node.taskId);
    this.roundEvent.newEvidenceIds.push(...evidence);
    this.roundEvent.newFacts.push(...facts);

    this.propagate();
  }

  applyProgress(nodeId: string, progress: ChildNodeProgress): void {
    if (this.getRuntime(nodeId).state !== "RUNNING") {
      throw new DomainValidationError(`node ${nodeId} is not RUNNING and cannot report progress`);
    }
    const evidence = progress.evidenceIds ?? [];
    const facts = progress.facts ?? [];
    this.setRuntime(nodeId, { evidenceCount: this.getRuntime(nodeId).evidenceCount + evidence.length });
    for (const fact of facts) this.facts.set(fact.key, fact.value);
    this.roundEvent.newEvidenceIds.push(...evidence);
    this.roundEvent.newFacts.push(...facts);
  }

  applyUserDecision(decisionId: string, value: string | boolean): void {
    if (typeof decisionId !== "string" || decisionId.trim() === "") {
      throw new DomainValidationError("decisionId must be a non-empty string");
    }
    this.userDecisions.set(decisionId, value);
    this.roundEvent.userDecision = true;
    this.propagate();
  }

  applyApprovalReply(reply: ApprovalReply): readonly string[] {
    if (this.pending === undefined) {
      throw new DomainValidationError("No pending approval to answer");
    }
    const validated = validateApprovalReplyAgainstPlan(this.pending.plan, reply);
    const selected = validated.selectedActionIds;
    const { kind, nodeId, plan, routedConfidence, approveActionId } = this.pending;

    if (kind === "ROUTE") {
      // Authorizing a route only lets the node start: it still has to produce a
      // child result before it can be considered COMPLETED.
      const cancelled = selected.includes(ROUTE_CANCEL_ACTION_ID);
      const authorized = !cancelled && approveActionId !== undefined && selected.includes(approveActionId);
      if (authorized) {
        this.setRuntime(nodeId, { state: "RUNNING" });
      } else {
        this.setRuntime(nodeId, { state: "SKIPPED" });
        this.activeRoutes.delete(nodeId);
      }
    } else {
      this.resolveBranchGate(nodeId, plan, selected, routedConfidence);
      this.activeRoutes.delete(nodeId);
    }

    this.approvedActionIds = [...this.approvedActionIds, ...selected];
    this.roundEvent.userDecision = true;
    this.pending = undefined;
    this.propagate();
    return selected;
  }

  applyInjection(injection: FlowchartInjection): void {
    switch (injection.kind) {
      case "fact": {
        this.facts.set(injection.key, injection.value);
        this.roundEvent.newFacts.push({
          key: injection.key,
          value: typeof injection.value === "string" ? injection.value : String(injection.value),
          confidence: injection.confidence
        });
        this.propagate();
        return;
      }
      case "override": {
        const runtime = this.getRuntime(injection.nodeId);
        if (runtime.state === "FAILED") {
          throw new DomainValidationError(`cannot override confidence of FAILED node ${injection.nodeId}`);
        }
        this.setRuntime(injection.nodeId, { confidence: injection.confidence });
        return;
      }
      case "skip": {
        const runtime = this.getRuntime(injection.nodeId);
        if (runtime.state !== "PENDING" && runtime.state !== "READY") {
          throw new DomainValidationError(
            `cannot skip node ${injection.nodeId} in state ${runtime.state}`
          );
        }
        this.setRuntime(injection.nodeId, { state: "SKIPPED" });
        this.roundEvent.userDecision = true;
        this.propagate();
        this.assertWaiterInvariant();
        return;
      }
    }
  }

  /**
   * Resolves a `human`/`router` decision gate. The gate performs no child work,
   * so the user's choice is its whole outcome; every unselected successor is
   * skipped. An empty selection legitimately skips all optional branches.
   */
  private resolveBranchGate(
    nodeId: string,
    plan: ApprovalPlan,
    selected: readonly string[],
    routedConfidence: ConfidenceScore
  ): void {
    const selfGate = plan.items.length === 1 && plan.items[0]!.id === nodeId;
    if (selfGate) {
      const chosen = selected.includes(nodeId);
      this.setRuntime(nodeId, {
        state: chosen ? "COMPLETED" : "SKIPPED",
        success: chosen,
        confidence: routedConfidence
      });
      if (chosen) this.roundEvent.completedTasks.push(this.node(nodeId).taskId);
      return;
    }

    this.setRuntime(nodeId, { state: "COMPLETED", success: true, confidence: routedConfidence });
    for (const item of plan.items) {
      if (!item.selectable) continue;
      if (!selected.includes(item.id) && this.nodesById.has(item.id)) {
        this.setRuntime(item.id, { state: "SKIPPED" });
      }
    }
    this.roundEvent.completedTasks.push(this.node(nodeId).taskId);
  }

  /**
   * Undoes one block so the run can be driven again.
   *
   * This is the flowchart plane's own reopen and it is deliberately not the DAG
   * scheduler's: that one moves a `TaskNode` from `TaskStatus` BLOCKED to READY
   * and stays the sole producer of that transition, with its sole caller in
   * `runSupervisorRounds`. This one moves a `FlowNodeState`, fabricates no
   * `TaskNode`, and appends no `TASK_STATUS_CHANGED`. Two state machines, two
   * transitions, no shared helper to blur them.
   *
   * The ledger latch is cleared for both block shapes, not only the stall one.
   * A gate block leaves the ledger untouched (the failing round still recorded
   * evidence, so it never stalled), which makes the clear a no-op there — but a
   * run that is blocked in *both* senses must not have a reopened node
   * immediately re-blocked by a ledger nobody authorized to stay set.
   *
   * With `retryNodeId` the node must be FAILED, its failed outcome fields and
   * its stale active route go, and the consequences that failure had on nodes
   * downstream are rewound to PENDING before the normal propagation fixpoint
   * re-derives them. Rewinding a descendant that already executed would discard
   * real work, so that fails closed instead: it needs its own contract, not a
   * silent erase. Evidence counts and every logged event survive untouched —
   * the old attempt stays visible, this only decides what runs next.
   */
  reopenAfterUnblock(request: FlowchartReopenRequest): void {
    this.ledger = { ...this.ledger, isBlocked: false, consecutiveStalls: 0, requiredEvidence: [] };
    const retryNodeId = request.retryNodeId;
    if (retryNodeId === undefined) return;

    const runtime = this.getRuntime(retryNodeId);
    if (runtime.state !== "FAILED") {
      throw new DomainValidationError(
        `cannot reopen node ${retryNodeId} in state ${runtime.state}: only a FAILED node can be re-driven`
      );
    }
    const consequences = this.downstreamConsequences(retryNodeId);
    const executed = consequences.filter((nodeId) =>
      EXECUTED_NODE_STATES.has(this.getRuntime(nodeId).state)
    );
    if (executed.length > 0) {
      throw new DomainValidationError(
        `cannot reopen node ${retryNodeId}: ${executed.join(", ")} already executed, and rewinding executed work is not authorized by an unblock`
      );
    }
    for (const nodeId of consequences) {
      const state = this.getRuntime(nodeId).state;
      if (state === "READY" || state === "SKIPPED") this.setRuntime(nodeId, { state: "PENDING" });
    }
    this.reopenFailedTarget(retryNodeId, runtime);
    this.propagate();
    this.assertWaiterInvariant();
  }

  /**
   * The same reopen, plus the executed descendants the ordinary one refuses.
   *
   * It is a separate method rather than a flag on {@link reopenAfterUnblock}
   * because the guard above is the contract: an ordinary unblock must keep
   * failing closed on executed work no matter what this one grows into. What
   * the caller gets back is a *plan* — the nodes that were rewound and the
   * state each was in — because the durable authorization has to record what it
   * superseded, and only the state machine knows the consequence set.
   *
   * Discarding is a control-state operation, not an undo. Evidence counts, the
   * routed model, the ledger's facts and both remaining budgets survive
   * untouched: the attempts really happened and really cost what they cost, and
   * re-execution has to pass the remaining-budget checks again. What does not
   * survive is `success`/`confidence` on a rewound node — leaving a stale
   * success behind would let it keep satisfying the very edges this rewind
   * exists to re-decide.
   */
  reopenAfterUnblockWithDiscard(request: FlowchartDiscardRequest): RewoundNodeRecord[] {
    this.ledger = { ...this.ledger, isBlocked: false, consecutiveStalls: 0, requiredEvidence: [] };
    const retryNodeId = request.retryNodeId;
    const runtime = this.getRuntime(retryNodeId);
    if (runtime.state !== "FAILED") {
      throw new DomainValidationError(
        `cannot reopen node ${retryNodeId} in state ${runtime.state}: only a FAILED node can be re-driven`
      );
    }
    const rewound: RewoundNodeRecord[] = [];
    for (const nodeId of this.downstreamConsequences(retryNodeId).toSorted()) {
      const state = this.getRuntime(nodeId).state;
      // A PENDING consequence is already where the rewind would put it, so it
      // changes nothing and claiming it in the audit record would overstate
      // what the authorization did.
      if (state === "PENDING") continue;
      rewound.push({ nodeId, taskId: this.node(nodeId).taskId, previousState: state });
      this.rewindToPending(nodeId);
    }
    if (!rewound.some((entry) => EXECUTED_NODE_STATES.has(entry.previousState))) {
      throw new DomainValidationError(
        `cannot discard executed work for node ${retryNodeId}: no descendant of it has executed; nothing to discard; omit --discard-executed`
      );
    }
    this.reopenFailedTarget(retryNodeId, runtime);
    this.propagate();
    this.assertWaiterInvariant();
    return rewound;
  }

  /** The FAILED retry target itself, returned to READY with its history intact. */
  private reopenFailedTarget(retryNodeId: string, runtime: FlowNodeRuntime): void {
    this.runtime.set(retryNodeId, {
      state: "READY",
      evidenceCount: runtime.evidenceCount,
      ...(runtime.model !== undefined ? { model: runtime.model } : {}),
      ...(runtime.parallelGroup !== undefined ? { parallelGroup: runtime.parallelGroup } : {})
    });
    this.activeRoutes.delete(retryNodeId);
  }

  /** One superseded descendant: outcome fields cleared, everything factual kept. */
  private rewindToPending(nodeId: string): void {
    const runtime = this.getRuntime(nodeId);
    this.runtime.set(nodeId, {
      state: "PENDING",
      evidenceCount: runtime.evidenceCount,
      ...(runtime.model !== undefined ? { model: runtime.model } : {}),
      ...(runtime.parallelGroup !== undefined ? { parallelGroup: runtime.parallelGroup } : {})
    });
    this.activeRoutes.delete(nodeId);
    // A node that was WAITING_FOR_USER holds the run's single approval, and the
    // waiter invariant is checked at the end of the transform: leaving the
    // approval pointed at a node that no longer waits would fail it.
    if (this.pending?.nodeId === nodeId) this.pending = undefined;
  }

  /**
   * The nodes whose state is a consequence of one node's result: everything
   * reachable through outgoing edges that the destination's join actually
   * reads. An edge a join policy does not require carries no consequence, so
   * following it would rewind a node for a reason it never depended on.
   */
  private downstreamConsequences(nodeId: string): string[] {
    const seen = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.outgoing.get(current) ?? []) {
        if (edge.to === nodeId || seen.has(edge.to)) continue;
        const join = this.joinPolicies.get(edge.to);
        if (join !== undefined && !join.requiredNodeIds.includes(edge.from)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return [...seen];
  }

  advanceRound(): AdvanceRoundResult {
    const event = this.roundEvent;
    const progress = classifyRoundProgress(event, this.ledger);
    this.ledger = advanceLedgerRound(this.ledger, progress, this.limits.maxConsecutiveStalls, {
      event,
      timestamp: this.now()
    });
    this.roundEvent = emptyRoundEvent();
    return {
      round: this.ledger.round,
      consecutiveStalls: this.ledger.consecutiveStalls,
      blocked: this.ledger.isBlocked,
      progress
    };
  }

  get decisions(): readonly RoutingDecision[] {
    return this.routingDecisions;
  }

  snapshot(): FlowchartSupervisorSnapshot {
    const nodes: Record<string, FlowNodeRuntime> = {};
    for (const [id, runtime] of this.runtime) nodes[id] = structuredClone(runtime);
    const activeRoutes: Record<string, ActiveRoute> = {};
    for (const [id, route] of this.activeRoutes) activeRoutes[id] = structuredClone(route);
    const userDecisions: Record<string, string | boolean> = {};
    for (const [id, value] of this.userDecisions) userDecisions[id] = value;
    const facts: Record<string, FactValue> = {};
    for (const [key, value] of this.facts) facts[key] = value;

    return {
      flowchartId: this.flowchart.id,
      status: this.computeStatus(),
      nodes,
      decisions: structuredClone(this.routingDecisions),
      activeRoutes,
      approvedActionIds: [...this.approvedActionIds],
      userDecisions,
      facts,
      ledger: structuredClone(this.ledger),
      ...(this.pending !== undefined ? { pendingApproval: structuredClone(this.pending) } : {}),
      pendingRoundEvent: structuredClone(this.roundEvent),
      remainingTimeMs: this.remainingTimeMs,
      ...(this.remainingCostUsd !== undefined ? { remainingCostUsd: this.remainingCostUsd } : {})
    };
  }
}

export function createFlowchartSupervisor(config: FlowchartSupervisorConfig): FlowchartSupervisor {
  const impl = new FlowchartSupervisorImpl(config);
  return {
    get status() {
      return impl.status;
    },
    get decisions() {
      return impl.decisions;
    },
    get pendingApproval() {
      return impl.pendingApproval;
    },
    nodeState: (nodeId) => impl.nodeState(nodeId),
    nodeRuntime: (nodeId) => impl.nodeRuntime(nodeId),
    readyNodeIds: () => impl.readyNodeIds(),
    leaseReadyNodes: () => impl.leaseReadyNodes(),
    applyChildResult: (nodeId, result) => impl.applyChildResult(nodeId, result),
    applyProgress: (nodeId, progress) => impl.applyProgress(nodeId, progress),
    applyUserDecision: (decisionId, value) => impl.applyUserDecision(decisionId, value),
    applyApprovalReply: (reply) => impl.applyApprovalReply(reply),
    applyInjection: (injection) => impl.applyInjection(injection),
    advanceRound: () => impl.advanceRound(),
    snapshot: () => impl.snapshot()
  };
}

/** Restores a supervisor from a serialized snapshot (T14 will feed this from checkpoints). */
export function restoreFlowchartSupervisor(
  config: Omit<FlowchartSupervisorConfig, "snapshot">,
  snapshot: FlowchartSupervisorSnapshot
): FlowchartSupervisor {
  return createFlowchartSupervisor({ ...config, snapshot });
}

/**
 * The checkpoint transform an authorized unblock performs: snapshot in,
 * reopened snapshot out.
 *
 * It runs through a restored supervisor rather than editing the JSON, so the
 * reopen is checked by the same restore validation, the same waiter invariant
 * and the same propagation fixpoint every other transition is. It is a pure
 * function of its inputs and idempotent on an already-reopened snapshot in the
 * only way that matters: a second call with the same `retryNodeId` refuses,
 * because that node is no longer FAILED.
 */
export function reopenBlockedFlowchartSnapshot(
  config: Omit<FlowchartSupervisorConfig, "snapshot">,
  snapshot: FlowchartSupervisorSnapshot,
  request: FlowchartReopenRequest = {}
): FlowchartSupervisorSnapshot {
  const impl = new FlowchartSupervisorImpl({ ...config, snapshot });
  impl.reopenAfterUnblock(request);
  return impl.snapshot();
}

/**
 * The checkpoint transform a `RUN_UNBLOCKED_WITH_DISCARD` performs: snapshot
 * in, reopened snapshot plus the rewind plan out.
 *
 * Like its ordinary sibling it runs through a restored supervisor, so the
 * stronger transform is checked by the same restore validation, waiter
 * invariant and propagation fixpoint. It is a pure function of its inputs,
 * which is what lets both the producer and every restore path derive the same
 * plan and compare them: a recovery that recomputed a different consequence set
 * than the authorization recorded is one that must not apply.
 */
export function reopenBlockedFlowchartSnapshotWithDiscard(
  config: Omit<FlowchartSupervisorConfig, "snapshot">,
  snapshot: FlowchartSupervisorSnapshot,
  request: FlowchartDiscardRequest
): FlowchartDiscardPlan {
  const impl = new FlowchartSupervisorImpl({ ...config, snapshot });
  const rewound = impl.reopenAfterUnblockWithDiscard(request);
  return { snapshot: impl.snapshot(), rewound };
}
