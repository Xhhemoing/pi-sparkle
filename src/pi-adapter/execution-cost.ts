import type { AgentExecutionRequest } from "../execution/contract.js";
import type { CostGate, CostGateLedger } from "./cost-gate.js";

/** Host-only model reference accounting; excludes tool charges and is never a bill or hard prepaid cap. */
export interface ExecutionCostReport {
  readonly runId: AgentExecutionRequest["runId"];
  readonly taskId: AgentExecutionRequest["taskId"];
  readonly agentInstanceId: AgentExecutionRequest["agentInstanceId"];
  /** Host stream dispatches, not HTTP calls hidden inside a custom transport. */
  readonly streamDispatches: number;
  readonly knownReferenceUsd: number | undefined;
  readonly coverage: "complete" | "partial" | "unknown";
  /** False if an owned session failed to establish real idle/disposal. */
  readonly settled: boolean;
  readonly ledger: CostGateLedger;
}

/** One started execute owns its original raw-usage gates and dispatch count. */
export class ExecutionCostObservation {
  readonly gates: CostGate[] = [];
  private requests = 0;
  private sessions = 0;
  dispatched(): void { this.requests++; }
  openingSession(): void { this.sessions++; }
  settledSession(): void { this.sessions--; }
  knownReferenceUsd(): number | undefined {
    const subtotal = this.gates.reduce((sum, gate) => {
      const amount = gate.spentUsd;
      return sum + (amount !== undefined && Number.isFinite(amount) && amount >= 0 ? amount : 0);
    }, 0);
    const rounded = Math.round(subtotal * 1_000_000) / 1_000_000;
    return Number.isFinite(rounded) ? rounded : undefined;
  }
  ledger(): CostGateLedger {
    const ledgers = this.gates.map((gate) => gate.ledger);
    return {
      turns: ledgers.reduce((sum, ledger) => sum + ledger.turns, 0),
      turnsWithoutUsage: ledgers.reduce((sum, ledger) => sum + ledger.turnsWithoutUsage, 0),
      tokensIn: ledgers.reduce((sum, ledger) => sum + ledger.tokensIn, 0),
      tokensOut: ledgers.reduce((sum, ledger) => sum + ledger.tokensOut, 0),
      spentUsd: ledgers.every((ledger) => ledger.spentUsd !== undefined && Number.isFinite(ledger.spentUsd)) ? this.knownReferenceUsd() : undefined
    };
  }
  report(request: Pick<AgentExecutionRequest, "runId" | "taskId" | "agentInstanceId">): ExecutionCostReport {
    const ledger = Object.freeze(this.ledger());
    const knownReferenceUsd = this.knownReferenceUsd();
    const settled = this.sessions === 0;
    const complete = settled && ledger.turns === this.requests && ledger.turnsWithoutUsage === 0 &&
      ledger.spentUsd !== undefined && knownReferenceUsd !== undefined;
    return Object.freeze({ runId: request.runId, taskId: request.taskId, agentInstanceId: request.agentInstanceId,
      streamDispatches: this.requests, knownReferenceUsd, settled, ledger,
      coverage: complete ? "complete" : knownReferenceUsd !== undefined && knownReferenceUsd > 0 ? "partial" : "unknown" });
  }
}
