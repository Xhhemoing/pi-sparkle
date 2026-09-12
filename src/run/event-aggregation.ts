import type { ExecutionEvent } from "../execution/contract.js";
import type { AgentEventKind } from "./events.js";

export const DEFAULT_DELTA_CHUNK_WATERMARK = 16;
export const DEFAULT_DELTA_UNIT_WATERMARK = 4096;
export const DEFAULT_QUEUE_WATERMARK = 32;

const EVIDENCE_TYPES = new Set<ExecutionEvent["type"]>([
  "TOOL_STARTED",
  "TOOL_FINISHED",
  "TURN_FINISHED",
  "MESSAGE",
  "EXECUTION_FINISHED"
]);

export interface EventWindowMetrics {
  readonly schemaVersion: 1;
  readonly eventCount: number;
  readonly deltaEvents: number;
  readonly durableEvents: number;
  readonly evidenceEvents: number;
  readonly textDeltaChars: number;
  readonly thinkingDeltaBytes: number;
  readonly textDeltaChunks: number;
  readonly thinkingDeltaChunks: number;
  readonly flushedDeltaRecords: number;
  readonly pendingDeltaChunks: number;
  readonly queueDepth: number;
  readonly highWaterMark: number;
  readonly backpressureReleases: number;
}

export interface DeltaFlush {
  readonly kind: Extract<AgentEventKind, "TEXT_DELTA" | "THINKING_DELTA">;
  readonly summary: string;
  readonly chunks: number;
  readonly units: number;
}

export interface DeltaObserveResult {
  readonly flushes: readonly DeltaFlush[];
  readonly passThrough: ExecutionEvent | undefined;
  readonly metrics: EventWindowMetrics;
}

export interface DeltaAggregatorOptions {
  readonly maxChunks?: number;
  readonly maxUnits?: number;
  readonly maxQueueDepth?: number;
}

interface PendingDelta {
  kind: DeltaFlush["kind"];
  chunks: number;
  units: number;
}

function isDelta(event: ExecutionEvent): event is Extract<ExecutionEvent, { type: "TEXT_DELTA" | "THINKING_DELTA" }> {
  return event.type === "TEXT_DELTA" || event.type === "THINKING_DELTA";
}

function unitsOf(event: Extract<ExecutionEvent, { type: "TEXT_DELTA" | "THINKING_DELTA" }>): number {
  return event.type === "TEXT_DELTA" ? event.text.length : event.bytes;
}

function summaryFor(kind: DeltaFlush["kind"], chunks: number, units: number): string {
  if (kind === "TEXT_DELTA") {
    return chunks === 1 ? `text delta (${units} chars)` : `text delta (${units} chars, ${chunks} chunks)`;
  }
  return chunks === 1 ? `thinking delta (${units} bytes)` : `thinking delta (${units} bytes, ${chunks} chunks)`;
}

/**
 * Coalesces consecutive text/thinking deltas into progress counters.
 *
 * Terminal and protocol events always pass through — this aggregator never
 * drops evidence-bearing records. Flush happens on kind change, on a
 * non-delta, on an explicit {@link DeltaAggregator.flush}, or when a
 * watermark trips (backpressure observation, not a drop).
 */
export class DeltaAggregator {
  private readonly maxChunks: number;
  private readonly maxUnits: number;
  private readonly maxQueueDepth: number;
  private pending: PendingDelta | undefined;
  private eventCount = 0;
  private deltaEvents = 0;
  private durableEvents = 0;
  private evidenceEvents = 0;
  private textDeltaChars = 0;
  private thinkingDeltaBytes = 0;
  private textDeltaChunks = 0;
  private thinkingDeltaChunks = 0;
  private flushedDeltaRecords = 0;
  private highWaterMark = 0;
  private backpressureReleases = 0;

  constructor(options: DeltaAggregatorOptions = {}) {
    this.maxChunks = options.maxChunks ?? DEFAULT_DELTA_CHUNK_WATERMARK;
    this.maxUnits = options.maxUnits ?? DEFAULT_DELTA_UNIT_WATERMARK;
    this.maxQueueDepth = options.maxQueueDepth ?? DEFAULT_QUEUE_WATERMARK;
  }

  observe(event: ExecutionEvent): DeltaObserveResult {
    this.eventCount += 1;
    if (isDelta(event)) {
      this.deltaEvents += 1;
      const flushes: DeltaFlush[] = [];
      if (this.pending !== undefined && this.pending.kind !== event.type) {
        flushes.push(this.takePending());
      }
      this.accumulate(event);
      this.noteQueue();
      if (this.shouldRelease()) {
        this.backpressureReleases += 1;
        flushes.push(this.takePending());
      }
      return { flushes, passThrough: undefined, metrics: this.metrics() };
    }
    if (EVIDENCE_TYPES.has(event.type)) this.evidenceEvents += 1;
    this.durableEvents += 1;
    const flushes = this.pending !== undefined ? [this.takePending()] : [];
    this.noteQueue();
    return { flushes, passThrough: event, metrics: this.metrics() };
  }

  flush(): DeltaFlush[] {
    if (this.pending === undefined) return [];
    const flushed = [this.takePending()];
    this.noteQueue();
    return flushed;
  }

  metrics(): EventWindowMetrics {
    return {
      schemaVersion: 1,
      eventCount: this.eventCount,
      deltaEvents: this.deltaEvents,
      durableEvents: this.durableEvents,
      evidenceEvents: this.evidenceEvents,
      textDeltaChars: this.textDeltaChars,
      thinkingDeltaBytes: this.thinkingDeltaBytes,
      textDeltaChunks: this.textDeltaChunks,
      thinkingDeltaChunks: this.thinkingDeltaChunks,
      flushedDeltaRecords: this.flushedDeltaRecords,
      pendingDeltaChunks: this.pending?.chunks ?? 0,
      queueDepth: this.pending?.chunks ?? 0,
      highWaterMark: this.highWaterMark,
      backpressureReleases: this.backpressureReleases
    };
  }

  private accumulate(event: Extract<ExecutionEvent, { type: "TEXT_DELTA" | "THINKING_DELTA" }>): void {
    const units = unitsOf(event);
    if (event.type === "TEXT_DELTA") {
      this.textDeltaChars += units;
      this.textDeltaChunks += 1;
    } else {
      this.thinkingDeltaBytes += units;
      this.thinkingDeltaChunks += 1;
    }
    if (this.pending === undefined) {
      this.pending = { kind: event.type, chunks: 1, units };
      return;
    }
    this.pending.chunks += 1;
    this.pending.units += units;
  }

  private shouldRelease(): boolean {
    if (this.pending === undefined) return false;
    return (
      this.pending.chunks >= this.maxChunks ||
      this.pending.units >= this.maxUnits ||
      this.pending.chunks >= this.maxQueueDepth
    );
  }

  private takePending(): DeltaFlush {
    const pending = this.pending;
    if (pending === undefined) {
      throw new Error("DeltaAggregator.takePending called with no pending delta");
    }
    this.pending = undefined;
    this.flushedDeltaRecords += 1;
    return {
      kind: pending.kind,
      summary: summaryFor(pending.kind, pending.chunks, pending.units),
      chunks: pending.chunks,
      units: pending.units
    };
  }

  private noteQueue(): void {
    const depth = this.pending?.chunks ?? 0;
    if (depth > this.highWaterMark) this.highWaterMark = depth;
  }
}

/**
 * Observe a finished window of executor events without mutating a log.
 * Deltas are counted and would-be flushes are returned; evidence events are
 * listed separately so a caller can prove none were dropped.
 */
export function aggregateEventWindow(
  events: readonly ExecutionEvent[],
  options?: DeltaAggregatorOptions
): {
  readonly metrics: EventWindowMetrics;
  readonly flushes: readonly DeltaFlush[];
  readonly evidence: readonly ExecutionEvent[];
} {
  const aggregator = new DeltaAggregator(options);
  const flushes: DeltaFlush[] = [];
  const evidence: ExecutionEvent[] = [];
  for (const event of events) {
    const observed = aggregator.observe(event);
    flushes.push(...observed.flushes);
    if (observed.passThrough !== undefined && EVIDENCE_TYPES.has(observed.passThrough.type)) {
      evidence.push(observed.passThrough);
    }
  }
  flushes.push(...aggregator.flush());
  return { metrics: aggregator.metrics(), flushes, evidence };
}
