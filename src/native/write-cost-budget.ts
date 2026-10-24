import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import type { AgentExecutionRequest, AgentExecutor } from "../execution/contract.js";
import { isPiExecutionCostReportFor, isPiExecutorCostBoundTo, type ExecutionCostReport } from "../pi-adapter/pi-executor.js";

export interface NativeExecutionCostBudget {
  readonly remainingReferenceUsd: number;
  readonly onExecutionCost: (report: ExecutionCostReport) => void;
  readonly assertDispatchAllowed: () => void;
  /** Bind a real strict Pi instance to this private callback before starting the coordinator. */
  readonly bindExecutor: (executor: AgentExecutor) => void;
}
export interface NativeWriteCostSummary {
  readonly maxReferenceUsd: number;
  readonly knownReferenceUsd: number | undefined;
  readonly coverage: "complete" | "partial" | "unknown";
  readonly remainingReferenceUsd: number | undefined;
  readonly settled: boolean;
  readonly attempts: readonly { readonly number: number; readonly offeredReferenceUsd: number;
    readonly report?: ExecutionCostReport; readonly fault?: string }[];
}
function fail(reason: string): never { throw new DomainValidationError(`native reference USD budget: ${reason}`); }
/** Copy before a host-input spread can turn an accessor into ordinary data. */
export function prepareNativeReferenceUsdBudget(input: object): number | undefined {
  if (types.isProxy(input)) fail("input must not be a Proxy");
  const field = Object.getOwnPropertyDescriptor(input, "referenceUsdBudget");
  if ((field === undefined && "referenceUsdBudget" in input) || (field !== undefined && !("value" in field))) fail("allowance must be an own data property");
  if (field?.value === undefined) return undefined;
  if (typeof field.value !== "number" || !Number.isFinite(field.value) || field.value <= 0) fail("allowance must be positive and finite");
  return field.value as number;
}
interface Attempt { readonly number: number; readonly offeredReferenceUsd: number; report?: ExecutionCostReport; fault?: string; }

/** One in-memory logical-task pool. Persisted summaries never recreate its callbacks or remaining authority. */
export class NativeWriteCostBudget {
  private known = 0;
  private fault: string | undefined;
  private unsettled = false;
  private readonly attempts: Attempt[] = [];
  private readonly receipts = new WeakSet<object>();
  constructor(private readonly limit: number) {}
  private refuse(attempt: Attempt, reason: string): void { attempt.fault ??= reason; this.fault ??= reason; }
  remaining(): number | undefined { return this.fault === undefined && Number.isFinite(this.known) ? this.limit - this.known : undefined; }
  overrun(): boolean { return this.known > this.limit; }
  stopReason(accepted: boolean): "cost-budget" | "cost-unavailable" | undefined {
    return this.fault !== undefined || !Number.isFinite(this.known) ? "cost-unavailable" :
      this.overrun() || (!accepted && this.known >= this.limit) ? "cost-budget" : undefined;
  }
  effectsUnsettled(): boolean { return this.unsettled; }
  snapshot(): NativeWriteCostSummary {
    const complete = this.fault === undefined && !this.unsettled && Number.isFinite(this.known);
    return Object.freeze({ maxReferenceUsd: this.limit, knownReferenceUsd: Number.isFinite(this.known) ? this.known : undefined,
      coverage: complete ? "complete" : this.known > 0 && Number.isFinite(this.known) ? "partial" : "unknown",
      remainingReferenceUsd: complete ? this.limit - this.known : undefined, settled: !this.unsettled,
      attempts: Object.freeze(this.attempts.map((attempt) => Object.freeze({ ...attempt }))) });
  }
  beginAttempt(number: number): { readonly handle: NativeExecutionCostBudget; readonly bound: () => boolean;
    readonly unsupported: () => void; readonly wrap: (executor: AgentExecutor) => AgentExecutor; readonly complete: () => void } {
    const offered = this.remaining();
    if (offered === undefined || offered <= 0) fail("no observed remaining allowance before factory");
    const attempt: Attempt = { number, offeredReferenceUsd: offered }; this.attempts.push(attempt);
    const owner = this;
    let bound: AgentExecutor | undefined, expected: Pick<AgentExecutionRequest, "runId" | "taskId" | "agentInstanceId"> | undefined,
      closed = false, received = false;
    const sink = (report: ExecutionCostReport): void => {
      if (closed) { owner.refuse(attempt, "late-receipt"); return; }
      if (!isPiExecutionCostReportFor(report, sink, { requireStrict: true })) { owner.refuse(attempt, "foreign-or-fabricated-receipt"); return; }
      if (owner.receipts.has(report)) { owner.refuse(attempt, "duplicate-receipt"); return; }
      owner.receipts.add(report);
      if (received) owner.refuse(attempt, "duplicate-execution-receipt");
      received = true; attempt.report ??= report;
      if (expected === undefined || report.runId !== expected.runId || report.taskId !== expected.taskId || report.agentInstanceId !== expected.agentInstanceId) {
        owner.refuse(attempt, "request-identity-mismatch");
        owner.unsettled = true;
        return;
      }
      const amount = report.knownReferenceUsd;
      if (amount !== undefined && Number.isFinite(amount) && amount >= 0) owner.known += amount;
      else owner.refuse(attempt, "unknown-reference");
      if (!report.settled) { owner.unsettled = true; owner.refuse(attempt, "execution-unsettled"); }
      if (report.coverage !== "complete") owner.refuse(attempt, "incomplete-usage");
    };
    const assertDispatchAllowed = (): void => {
      const remaining = owner.remaining();
      if (closed || bound === undefined || remaining === undefined || remaining <= 0) fail("live logical-task allowance no longer admits dispatch");
    };
    const handle: NativeExecutionCostBudget = Object.freeze({ remainingReferenceUsd: offered, onExecutionCost: sink, assertDispatchAllowed,
      bindExecutor(executor: AgentExecutor): void {
        if (closed || bound !== undefined) { owner.refuse(attempt, "duplicate-or-late-binding"); fail("executor binding already closed or consumed"); }
        if (!isPiExecutorCostBoundTo(executor, sink, assertDispatchAllowed)) { owner.refuse(attempt, "unsupported-executor"); fail("executor lacks the original strict cost/admission callbacks"); }
        bound = executor;
      } });
    return { handle, bound: () => bound !== undefined,
      unsupported: () => { owner.refuse(attempt, "unsupported-executor"); },
      wrap(executor) {
        return { ...(executor.supportedModelIds === undefined ? {} : { supportedModelIds: executor.supportedModelIds }),
          ...(executor.steerText === undefined ? {} : { steerText: executor.steerText.bind(executor) }),
          async *execute(request, signal) {
            if (closed || expected !== undefined || bound === undefined) { owner.refuse(attempt, "unexpected-execution"); fail("unexpected executor invocation"); }
            assertDispatchAllowed();
            const budgeted = { ...request, maxCostUsd: Math.min(request.maxCostUsd ?? offered, offered) };
            expected = { runId: request.runId, taskId: request.taskId, agentInstanceId: request.agentInstanceId };
            yield* executor.execute(budgeted, signal);
          } };
      },
      complete() {
        if (closed) { owner.refuse(attempt, "duplicate-settlement"); return; }
        closed = true;
        if (expected !== undefined && !received) { owner.unsettled = true; owner.refuse(attempt, "missing-receipt"); }
      } };
  }
}
