import type { AgentExecutionRequest } from "../execution/contract.js";
import type { CostGate, CostGateLedger, CostGatePricingObservation } from "./cost-gate.js";
import type { SdkCostObservation } from "./sdk-cost-observation.js";

/** Host-only model reference accounting; excludes tool charges and is never a bill or hard prepaid cap. */
export interface ExecutionCostReport {
  readonly runId: AgentExecutionRequest["runId"];
  readonly taskId: AgentExecutionRequest["taskId"];
  readonly agentInstanceId: AgentExecutionRequest["agentInstanceId"];
  /** Host stream dispatches, not HTTP calls hidden inside a custom transport. */
  readonly streamDispatches: number;
  /** Validated reference subtotal at the original numeric precision, never the legacy gate's display rounding. */
  readonly knownReferenceUsd: number | undefined;
  readonly coverage: "complete" | "partial" | "unknown";
  /** False if an owned session failed to establish real idle/disposal. */
  readonly settled: boolean;
  /** Host ledger dollars use the same unrounded subtotal; CostGateEvent retains its legacy display semantics. */
  readonly ledger: CostGateLedger;
  /** Optional private evidence for independent SDK recomputation; legacy reports omit it. */
  readonly sdkObservations?: readonly SdkCostObservation[];
}

type StrictDispatchRefusal = "invalid-cap" | "unpriced-model" | "incomplete-usage" | "exhausted";

/** One started execute owns its original raw-usage gates and dispatch count. */
export class ExecutionCostObservation {
  readonly gates: CostGate[] = [];
  private requests = 0;
  private sessions = 0;
  private referenceUsd = 0;
  private refusal: StrictDispatchRefusal | undefined;
  private readonly sdkObservations: SdkCostObservation[] = [];
  private sdkObservationFault = false;
  private readonly streams = new WeakSet<object>();
  constructor(private readonly strictBudget?: { readonly maxCostUsd: number | undefined }) {}
  get strictDispatchRefusal(): StrictDispatchRefusal | undefined { return this.refusal; }
  /** The same admission check guards ordinary turns, retry and fallback. Never renew a refused allowance. */
  dispatchRefusal(priced: boolean): StrictDispatchRefusal | undefined {
    if (this.strictBudget === undefined) return undefined;
    if (this.refusal !== undefined) return this.refusal;
    const limit = this.strictBudget.maxCostUsd;
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return this.refusal = "invalid-cap";
    if (!priced) return this.refusal = "unpriced-model";
    if (this.sdkObservationFault) return this.refusal = "incomplete-usage";
    const ledger = this.ledger();
    const known = this.knownReferenceUsd();
    if (ledger.turns !== this.requests || ledger.turnsWithoutUsage !== 0 || ledger.spentUsd === undefined || known === undefined) {
      return this.refusal = "incomplete-usage";
    }
    if (known >= limit) return this.refusal = "exhausted";
    return undefined;
  }
  requestStop(gate: CostGate, priced: boolean): boolean {
    if (this.strictBudget === undefined) return gate.requestStopIfExceeded();
    const refusal = this.dispatchRefusal(priced);
    // Keep a truthful legacy marker only when actual reference allowance is exhausted.
    // Its display rounding can miss a sub-microdollar stop; that never reopens admission.
    if (refusal === "exhausted") gate.requestStopIfExceeded();
    return refusal !== undefined;
  }
  dispatched(): number { return ++this.requests; }
  observeSdk(observation: SdkCostObservation): void { this.sdkObservations.push(observation); }
  failSdkObservation(): void { this.sdkObservationFault = true; }
  claimStream(stream: object): boolean {
    if (this.streams.has(stream)) return false;
    this.streams.add(stream); return true;
  }
  openingSession(): void { this.sessions++; }
  settledSession(): void { this.sessions--; }
  /** The same validated SDK pricing observation as the gate, before its legacy display rounding. */
  recordReference(pricing: CostGatePricingObservation | undefined): void {
    const amount = pricing?.referenceUsd;
    if (amount !== undefined && Number.isFinite(amount) && amount >= 0) this.referenceUsd += amount;
  }
  knownReferenceUsd(): number | undefined {
    return Number.isFinite(this.referenceUsd) ? this.referenceUsd : undefined;
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
    const complete = !this.sdkObservationFault && settled && ledger.turns === this.requests && ledger.turnsWithoutUsage === 0 &&
      ledger.spentUsd !== undefined && knownReferenceUsd !== undefined;
    return Object.freeze({ runId: request.runId, taskId: request.taskId, agentInstanceId: request.agentInstanceId,
      streamDispatches: this.requests, knownReferenceUsd, settled, ledger,
      ...(this.sdkObservations.length === 0 ? {} : { sdkObservations: Object.freeze([...this.sdkObservations].sort((a, b) => a.dispatchIndex - b.dispatchIndex)) }),
      coverage: complete ? "complete" : knownReferenceUsd !== undefined && knownReferenceUsd > 0 ? "partial" : "unknown" });
  }
}
