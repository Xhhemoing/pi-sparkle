import {
  type Flowchart,
  type ModelRouter,
  type RoutingDecision,
  routeTask,
} from "./flowchart.js";

export interface FlowchartSupervisorConfig {
  readonly flowchart: Flowchart;
  readonly router: ModelRouter;
}

export interface FlowchartSupervisorState {
  readonly currentNodeId: string | undefined;
  readonly pendingApprovals: readonly string[];
  readonly decisions: readonly RoutingDecision[];
  readonly status: "RUNNING" | "WAITING_FOR_USER" | "COMPLETED";
}

export interface FlowchartSupervisor {
  readonly state: FlowchartSupervisorState;
  step(): RoutingDecision | null;
  applyUserApproval(selected: readonly string[]): void;
  resume(): void;
}

export function createFlowchartSupervisor(cfg: FlowchartSupervisorConfig): FlowchartSupervisor {
  let state: FlowchartSupervisorState = {
    currentNodeId: cfg.flowchart.nodes[0]?.id,
    pendingApprovals: [],
    decisions: [],
    status: "RUNNING",
  };

  function step(): RoutingDecision | null {
    if (!state.currentNodeId || state.status !== "RUNNING") return null;

    const node = cfg.flowchart.nodes.find((n) => n.id === state.currentNodeId);
    if (!node) return null;

    const decision = routeTask(cfg.router, {
      taskId: node.taskId,
      family: node.role === "actor" ? "edit" : "review",
      estimatedTokens: 2000,
    });

    const newDecisions = [...state.decisions, decision];
    let newPending = [...state.pendingApprovals];

    if (decision.statusAfterRoute === "WAITING_FOR_USER") {
      state = {
        currentNodeId: state.currentNodeId,
        pendingApprovals: decision.approvalPlan.selectableItems.map((i) => i.id),
        decisions: newDecisions,
        status: "WAITING_FOR_USER",
      };
      return decision;
    } else {
      // advance to next node (simple linear for T13)
      const idx = cfg.flowchart.nodes.findIndex((n) => n.id === state.currentNodeId);
      const next = cfg.flowchart.nodes[idx + 1];
      state = {
        currentNodeId: next?.id,
        pendingApprovals: newPending,
        decisions: newDecisions,
        status: next ? "RUNNING" : "COMPLETED",
      };
      return decision;
    }
  }

  function applyUserApproval(selected: readonly string[]): void {
    if (state.status !== "WAITING_FOR_USER") return;
    const remaining = state.pendingApprovals.filter((id) => !selected.includes(id));
    state = {
      ...state,
      pendingApprovals: remaining,
      status: remaining.length === 0 ? "RUNNING" : "WAITING_FOR_USER",
    };
  }

  function resume(): void {
    if (state.status === "WAITING_FOR_USER" && state.pendingApprovals.length === 0) {
      state = { ...state, status: "RUNNING" };
    }
  }

  return {
    get state() {
      return state;
    },
    step,
    applyUserApproval,
    resume,
  };
}
