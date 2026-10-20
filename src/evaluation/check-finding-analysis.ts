import { types } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import type { BoundCheckFinding } from "./check-findings.js";
import type { NativeWriteFeedback } from "../native/write-loop.js";

/** Opt-in disclosure of existing bounded checker output to trusted host code. */
export interface CheckFindingAnalysisInput {
  readonly finding: BoundCheckFinding;
  readonly feedback: NativeWriteFeedback;
  readonly signal: AbortSignal;
}
export interface CheckFindingAnalysisOptions {
  /**
   * Return a synchronous own-data summary DTO or an ordinary native Promise,
   * including normal cross-realm Promises. Constructor overrides, subclasses,
   * custom species and arbitrary thenables are unsupported. The trusted host
   * must leave Promise constructor/species/prototypes ordinary and unmodified.
   * Unsupported async values remain host-owned: shutdown/late-rejection draining
   * is guaranteed only for supported returned Promises, not arbitrary host work.
   */
  readonly analyze: (input: CheckFindingAnalysisInput) => unknown;
  /** Cooperative waiter limit, not callback termination. Default 5000, maximum 30000. */
  readonly timeoutMs?: number;
  /** Fixed per-execute identity capacity; no eviction. Default 32, maximum 256. */
  readonly capacity?: number;
  /** Reject oversized summaries. Default 2048, maximum 4096 UTF-16 code units. */
  readonly maxSummaryChars?: number;
}
export interface ResolvedCheckFindingAnalysis {
  readonly analyze: CheckFindingAnalysisOptions["analyze"];
  readonly timeoutMs: number;
  readonly capacity: number;
  readonly maxSummaryChars: number;
}
export interface CheckFindingAnalysis {
  readonly finding: BoundCheckFinding;
  readonly state: "available" | "unavailable";
  /** Untrusted advisory text; never acceptance, repair or apply authority. */
  readonly summary?: string;
  readonly reason?: "capacity" | "timeout" | "cancelled" | "invalid-output" | "callback-failed";
}
export interface CheckFindingAnalysisProjection {
  readonly current: readonly CheckFindingAnalysis[];
  readonly stale: readonly CheckFindingAnalysis[];
}
type Reference = Pick<BoundCheckFinding, "runId" | "revision" | "generation">;

function ownData(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if ((descriptor === undefined && key in object) || (descriptor !== undefined && !("value" in descriptor))) {
    throw new DomainValidationError(`check finding analysis ${key} must be an own data property`);
  }
  return descriptor?.value;
}
export function snapshotCheckFindingAnalysis(input: CheckFindingAnalysisOptions | undefined): ResolvedCheckFindingAnalysis | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new DomainValidationError("check finding analysis must be an object");
  }
  const analyze = ownData(input, "analyze");
  if (typeof analyze !== "function") throw new DomainValidationError("check finding analysis requires a callback");
  const integer = (key: string, fallback: number, maximum: number): number => {
    const value = ownData(input, key);
    const selected = value === undefined ? fallback : value;
    if (typeof selected !== "number" || !Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
      throw new DomainValidationError(`check finding analysis ${key} must be an integer from 1 to ${maximum}`);
    }
    return selected;
  };
  return Object.freeze({ analyze: analyze as CheckFindingAnalysisOptions["analyze"],
    timeoutMs: integer("timeoutMs", 5000, 30000), capacity: integer("capacity", 32, 256),
    maxSummaryChars: integer("maxSummaryChars", 2048, 4096) });
}
function unavailable(finding: BoundCheckFinding, reason: NonNullable<CheckFindingAnalysis["reason"]>): CheckFindingAnalysis {
  return Object.freeze({ finding, state: "unavailable", reason });
}
function outputSnapshot(output: unknown, finding: BoundCheckFinding, maximum: number): CheckFindingAnalysis {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return unavailable(finding, "invalid-output");
  if ("then" in output) return unavailable(finding, "invalid-output");
  const descriptor = Object.getOwnPropertyDescriptor(output, "summary");
  const summary: unknown = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  if (typeof summary !== "string" || summary.trim() === "" || summary.length > maximum) return unavailable(finding, "invalid-output");
  return Object.freeze({ finding, state: "available", summary });
}

/**
 * Best-effort descriptor checks only: never invoke constructor/species getters
 * here. They reject common unsupported shapes, but cannot prove cross-realm
 * intrinsic identity or detect a substituted species getter. The trusted-host
 * precondition above excludes custom getters and global prototype alteration.
 */
function hasOrdinaryPromiseMetadata(output: Promise<unknown>): boolean {
  if (Object.getOwnPropertyDescriptor(output, "constructor") !== undefined) return false;
  const prototype: object | null = Object.getPrototypeOf(output);
  if (prototype === null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (constructor === undefined || !("value" in constructor) || typeof constructor.value !== "function") return false;
  const species = Object.getOwnPropertyDescriptor(constructor.value, Symbol.species);
  return species !== undefined && "get" in species && typeof species.get === "function";
}

/** One execute owns this bounded identity table. Supported callback settlement belongs to its session. */
export class CheckFindingAnalysisOwner {
  private readonly flights = new Map<string, Promise<CheckFindingAnalysis>>();
  private readonly completed: CheckFindingAnalysis[] = [];
  private current: Reference | undefined;
  private readonly options: ResolvedCheckFindingAnalysis;
  constructor(options: ResolvedCheckFindingAnalysis,
    private readonly registerRaw: (settlement: Promise<void>) => void = () => undefined) {
    this.options = snapshotCheckFindingAnalysis(options)!;
  }

  /** Invalidate before another writer starts, including while an old raw callback still runs. */
  setCurrent(reference: Reference | undefined): void {
    this.current = reference === undefined ? undefined : Object.freeze({ runId: reference.runId,
      revision: reference.revision, generation: reference.generation });
  }
  project(observations: readonly CheckFindingAnalysis[] = this.completed): CheckFindingAnalysisProjection {
    const current: CheckFindingAnalysis[] = []; const stale: CheckFindingAnalysis[] = [];
    for (const row of observations) {
      const finding = row.finding;
      (this.current !== undefined && finding.runId === this.current.runId && finding.revision === this.current.revision &&
        finding.generation === this.current.generation ? current : stale).push(row);
    }
    return Object.freeze({ current: Object.freeze(current), stale: Object.freeze(stale) });
  }
  analyze(original: BoundCheckFinding, originalFeedback: NativeWriteFeedback, signal: AbortSignal): Promise<CheckFindingAnalysis> {
    const key = JSON.stringify([original.runId, original.revision, original.generation, original.evidenceRef, original.criterionId, original.id]);
    const existing = this.flights.get(key);
    if (existing !== undefined) return existing;
    const finding = Object.isFrozen(original) ? original : Object.freeze({ ...original });
    if (this.flights.size >= this.options.capacity) return Promise.resolve(unavailable(finding, "capacity"));
    const feedback = Object.isFrozen(originalFeedback) ? originalFeedback : Object.freeze({ ...originalFeedback });
    const flight = this.run(finding, feedback, signal).then((row) => { this.completed.push(row); return row; });
    this.flights.set(key, flight);
    return flight;
  }
  private async run(finding: BoundCheckFinding, feedback: NativeWriteFeedback, signal: AbortSignal): Promise<CheckFindingAnalysis> {
    if (signal.aborted) return unavailable(finding, "cancelled");
    const controller = new AbortController();
    const callbackSignal = AbortSignal.any([signal, controller.signal]);
    const input = Object.freeze({ finding, feedback, signal: callbackSignal });
    const analyze = this.options.analyze;
    // Queue invocation so session ownership and rejection handlers exist before host code runs.
    const snapshot = (output: unknown): CheckFindingAnalysis => {
      try { return outputSnapshot(output, finding, this.options.maxSummaryChars); }
      catch { return unavailable(finding, "invalid-output"); }
    };
    const raw = Promise.resolve().then(() => {
      if (signal.aborted) return unavailable(finding, "cancelled");
      const output = analyze(input);
      // Snapshot synchronous returns immediately. Promise assimilation of an
      // arbitrary output object could otherwise execute its `then` accessor.
      if (!types.isPromise(output)) return snapshot(output);
      if (!hasOrdinaryPromiseMetadata(output)) return unavailable(finding, "invalid-output");
      return Promise.prototype.then.call(output, snapshot) as Promise<CheckFindingAnalysis>;
    });
    const result = raw.catch(() => unavailable(finding, "callback-failed"));
    const settled = result.then(() => undefined);
    this.registerRaw(settled);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<CheckFindingAnalysis>((resolve) => {
      onAbort = () => resolve(unavailable(finding, "cancelled"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      timer = setTimeout(() => { controller.abort(); resolve(unavailable(finding, "timeout")); }, this.options.timeoutMs);
    });
    try { return await Promise.race([result, stopped]); }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    }
  }
}
