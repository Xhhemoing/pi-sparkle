import type { TaskId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";

export type FlowchartNodeRole =
  | "actor"
  | "critic"
  | "router"
  | "judge"
  | "tool"
  | "human";

export interface FlowchartNode {
  readonly id: string;
  readonly taskId: TaskId;
  readonly role: FlowchartNodeRole;
  readonly modelPreference?: string;
}

export type FlowchartEdgeCondition = "always" | "on-success" | "on-failure" | "on-low-confidence";

export interface FlowchartEdge {
  readonly from: string;
  readonly to: string;
  readonly condition: FlowchartEdgeCondition;
}

export interface JoinRule {
  readonly required: readonly string[];
  readonly policy: "all" | "any" | "quorum";
}

export interface Flowchart {
  readonly id: string;
  readonly nodes: readonly FlowchartNode[];
  readonly edges: readonly FlowchartEdge[];
  readonly joinRules: Record<string, JoinRule>;
}

export interface ConfidenceScore {
  readonly value: number; // 0..1
  readonly reason: string;
}

export interface ApprovalItem {
  readonly id: string;
  readonly label: string;
  readonly defaultSelected: boolean;
}

export interface ApprovalPlan {
  readonly threshold: number;
  readonly selectableItems: readonly ApprovalItem[];
}

export type RoutingStatusAfter = "RUNNING" | "WAITING_FOR_USER" | "BLOCKED";

export interface RoutingDecision {
  readonly eventType: "MODEL_ROUTED";
  readonly taskId: TaskId;
  readonly model: string;
  readonly confidence: number;
  readonly approvalPlan: ApprovalPlan;
  readonly statusAfterRoute: RoutingStatusAfter;
  readonly policyVersion: string;
}

export interface ModelRouterConfig {
  readonly defaultThreshold: number;
  readonly policyVersion: string;
}

export interface ModelRouter {
  readonly config: ModelRouterConfig;
}

export function validateFlowchart(fc: Flowchart): void {
  const nodeIds = new Set(fc.nodes.map((n) => n.id));
  // detect cycles via simple DFS
  const adj = new Map<string, string[]>();
  for (const e of fc.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
      throw new DomainValidationError(`edge references unknown node: ${e.from}->${e.to}`);
    }
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function dfs(u: string): boolean {
    if (visiting.has(u)) return true;
    if (visited.has(u)) return false;
    visiting.add(u);
    for (const v of adj.get(u) ?? []) {
      if (dfs(v)) return true;
    }
    visiting.delete(u);
    visited.add(u);
    return false;
  }
  for (const n of fc.nodes) {
    if (dfs(n.id)) {
      throw new DomainValidationError("flowchart contains a cycle");
    }
  }
}

export function createModelRouter(cfg: ModelRouterConfig): ModelRouter {
  return { config: cfg };
}

export interface RouteTaskInput {
  readonly taskId: TaskId;
  readonly family: string;
  readonly estimatedTokens: number;
}

const DEFAULT_MODEL = "gpt-5.6-terra";

export function routeTask(router: ModelRouter, input: RouteTaskInput): RoutingDecision {
  // very small deterministic heuristic for RED->GREEN
  const highRisk = input.family === "architecture" || input.estimatedTokens > 6000;
  const confidence = highRisk ? 0.65 : 0.82;

  const below = confidence < router.config.defaultThreshold;

  const approvalPlan: ApprovalPlan = {
    threshold: router.config.defaultThreshold,
    selectableItems: [
      { id: "model", label: "Model choice", defaultSelected: true },
      { id: "context", label: "Context packet", defaultSelected: true },
    ],
  };

  return {
    eventType: "MODEL_ROUTED",
    taskId: input.taskId,
    model: DEFAULT_MODEL,
    confidence,
    approvalPlan,
    statusAfterRoute: below ? "WAITING_FOR_USER" : "RUNNING",
    policyVersion: router.config.policyVersion,
  };
}
