import { performance } from "node:perf_hooks";
import { DomainValidationError } from "../domain/errors.js";
import type { ActionRecord } from "./action-ledger.js";
import type { DevelopmentResult } from "./controller.js";
import type { WorkQueue } from "./work-items.js";

export interface DevelopmentBatchController {
  currentSourceRevision(): string;
  status(): Promise<{ queue: WorkQueue; actions: readonly ActionRecord[] }>;
  runNext(input?: { maxAttempts?: number; maxWallTimeMs?: number; signal?: AbortSignal }): Promise<DevelopmentResult>;
}
export interface DevelopmentBatchInput {
  readonly maxItems: number;
  readonly maxWallTimeMs: number;
  readonly maxAttempts?: number;
  readonly perItemWallTimeMs?: number;
  readonly signal?: AbortSignal;
}
export type DevelopmentBatchStop = "max-items" | "no-ready-task" | "blocked" | "needs-reconciliation" |
  "cancelled" | "deadline" | "source-changed" | "error";
function fail(reason: string): never { throw new DomainValidationError(`development batch: ${reason}`); }
function integer(value: unknown, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) fail(`${label} must be an integer in 1..${max}`);
  return value;
}
function prepare(input: DevelopmentBatchInput) {
  if (input === null || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).some((key) => typeof key !== "string" || !["maxItems", "maxWallTimeMs", "maxAttempts", "perItemWallTimeMs", "signal"].includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(input)).some((value) => value.get !== undefined || value.set !== undefined)) fail("invalid options or accessors");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) fail("signal must be an AbortSignal");
  return Object.freeze({ maxItems: integer(input.maxItems, 8, "maxItems"),
    maxWallTimeMs: integer(input.maxWallTimeMs, 1_800_000, "maxWallTimeMs"),
    maxAttempts: integer(input.maxAttempts ?? 3, 5, "maxAttempts"),
    perItemWallTimeMs: integer(input.perItemWallTimeMs ?? 600_000, 1_800_000, "perItemWallTimeMs"),
    signal: input.signal });
}
function summarize(queue: WorkQueue) {
  return Object.freeze({ revision: queue.revision,
    planned: queue.items.filter((item) => item.status === "planned").length,
    running: queue.items.filter((item) => item.status === "running").length,
    blocked: queue.items.filter((item) => item.status === "blocked").length,
    readyForReview: queue.items.filter((item) => item.status === "ready-for-review").length,
    accepted: queue.items.filter((item) => item.status === "accepted").length });
}
function pendingReason(status: Awaited<ReturnType<DevelopmentBatchController["status"]>>): string | undefined {
  const unknown = status.actions.find((action) => action.state === "running" || action.state === "needs-reconciliation");
  if (unknown !== undefined) return `effect ${unknown.actionId} requires host reconciliation`;
  if (status.queue.items.some((item) => item.status === "running")) return "a running task claim needs host reconciliation";
  return undefined;
}
export interface DevelopmentBatchResult {
  readonly schemaVersion: 1;
  readonly sourceRevision?: string;
  readonly limits: Readonly<{ maxItems: number; maxWallTimeMs: number; maxAttempts: number; perItemWallTimeMs: number }>;
  readonly results: readonly DevelopmentResult[];
  readonly stopReason: DevelopmentBatchStop;
  readonly elapsedMs: number;
  readonly deadlineExceeded: boolean;
  readonly queueSummary?: ReturnType<typeof summarize>;
  readonly sourceApplied: false;
  readonly reason?: string;
}

/** Serial within this invocation. Deadline requests cancellation; actual settlement is awaited. */
export async function runDevelopmentBatch(controller: DevelopmentBatchController, input: DevelopmentBatchInput): Promise<DevelopmentBatchResult> {
  const options = prepare(input);
  const started = performance.now();
  const abort = new AbortController();
  let interrupted: "cancelled" | "deadline" | undefined;
  const cancel = (reason: "cancelled" | "deadline") => { interrupted ??= reason; abort.abort(); };
  const onCancel = () => cancel("cancelled");
  if (options.signal?.aborted) onCancel();
  else options.signal?.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => cancel("deadline"), options.maxWallTimeMs);
  const elapsed = () => performance.now() - started;
  const interruption = () => {
    if (elapsed() >= options.maxWallTimeMs) cancel("deadline");
    return interrupted;
  };
  const results: DevelopmentResult[] = [];
  let sourceRevision: string | undefined;
  let summary: ReturnType<typeof summarize> | undefined;
  const report = (stopReason: DevelopmentBatchStop, reason?: string): DevelopmentBatchResult => Object.freeze({
    schemaVersion: 1, ...(sourceRevision === undefined ? {} : { sourceRevision }),
    limits: Object.freeze({ maxItems: options.maxItems, maxWallTimeMs: options.maxWallTimeMs,
      maxAttempts: options.maxAttempts, perItemWallTimeMs: options.perItemWallTimeMs }),
    results: Object.freeze([...results]), stopReason, elapsedMs: elapsed(),
    deadlineExceeded: elapsed() >= options.maxWallTimeMs,
    ...(summary === undefined ? {} : { queueSummary: summary }), sourceApplied: false,
    ...(reason === undefined ? {} : { reason: reason.slice(0, 2048) })
  });
  try {
    if (interruption() !== undefined) return report(interrupted!);
    sourceRevision = controller.currentSourceRevision();
    for (let count = 0; count < options.maxItems; count++) {
      if (interruption() !== undefined) return report(interrupted!);
      const status = await controller.status();
      summary = summarize(status.queue);
      if (interruption() !== undefined) return report(interrupted!);
      if (controller.currentSourceRevision() !== sourceRevision) return report("source-changed", "source changed from the fixed batch revision");
      const pending = pendingReason(status);
      if (pending !== undefined) return report("needs-reconciliation", pending);
      const remaining = Math.floor(options.maxWallTimeMs - elapsed());
      if (remaining < 1) { cancel("deadline"); return report("deadline"); }
      // Never race this promise against a timer: late claims/effects must settle
      // through their own fenced controller and durable receipt path.
      const result = await controller.runNext({ maxAttempts: options.maxAttempts,
        maxWallTimeMs: Math.min(options.perItemWallTimeMs, remaining), signal: abort.signal });
      if (result.itemId !== undefined) results.push(Object.freeze({ ...result }));
      const after = await controller.status();
      summary = summarize(after.queue);
      if (interruption() !== undefined) return report(interrupted!);
      if (controller.currentSourceRevision() !== sourceRevision) return report("source-changed", "source changed during candidate development");
      const latePending = pendingReason(after);
      if (latePending !== undefined) return report("needs-reconciliation", latePending);
      if (result.status !== "ready-for-review") return report(result.status, result.reason);
    }
    return report("max-items");
  } catch (error) {
    return report(interruption() ?? "error", error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCancel);
  }
}
