import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentInstanceId,
  createEvidenceId,
  createMessageId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { ExecutionEvent } from "../../../src/execution/contract.js";
import {
  aggregateEventWindow,
  DeltaAggregator
} from "../../../src/run/event-aggregation.js";

const toolStart: ExecutionEvent = { type: "TOOL_STARTED", toolCallId: "t1", toolName: "read_file" };
const toolDone: ExecutionEvent = { type: "TOOL_FINISHED", toolCallId: "t1", isError: false, summary: "ok" };
const done: ExecutionEvent = { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };

test("a single TEXT_DELTA summary matches the historical coordinator spelling", () => {
  const aggregator = new DeltaAggregator();
  const mid = aggregator.observe({ type: "TEXT_DELTA", text: "hello" });
  assert.deepEqual(mid.flushes, []);
  assert.equal(mid.passThrough, undefined);
  const flushed = aggregator.flush();
  assert.deepEqual(flushed, [
    { kind: "TEXT_DELTA", summary: "text delta (5 chars)", chunks: 1, units: 5 }
  ]);
});

test("consecutive TEXT_DELTAs coalesce until a durable event flushes them", () => {
  const events: ExecutionEvent[] = [
    { type: "TEXT_DELTA", text: "ab" },
    { type: "TEXT_DELTA", text: "cd" },
    { type: "TEXT_DELTA", text: "e" },
    toolStart,
    done
  ];
  const window = aggregateEventWindow(events);
  assert.equal(window.flushes.length, 1);
  assert.equal(window.flushes[0]?.summary, "text delta (5 chars, 3 chunks)");
  assert.deepEqual(
    window.evidence.map((event) => event.type),
    ["TOOL_STARTED", "EXECUTION_FINISHED"]
  );
  assert.equal(window.metrics.deltaEvents, 3);
  assert.equal(window.metrics.evidenceEvents, 2);
  assert.equal(window.metrics.durableEvents, 2);
});

test("watermark release is observed as backpressure, not a drop", () => {
  const aggregator = new DeltaAggregator({ maxChunks: 2, maxUnits: 10_000, maxQueueDepth: 8 });
  const first = aggregator.observe({ type: "TEXT_DELTA", text: "a" });
  assert.equal(first.flushes.length, 0);
  const second = aggregator.observe({ type: "TEXT_DELTA", text: "b" });
  assert.equal(second.flushes.length, 1);
  assert.equal(second.metrics.backpressureReleases, 1);
  assert.equal(second.metrics.flushedDeltaRecords, 1);
  assert.equal(second.metrics.highWaterMark, 2);
  const tool = aggregator.observe(toolDone);
  assert.equal(tool.passThrough, toolDone);
  assert.equal(tool.flushes.length, 0);
});

test("kind change flushes text before thinking; neither is dropped", () => {
  const window = aggregateEventWindow([
    { type: "TEXT_DELTA", text: "hi" },
    { type: "THINKING_DELTA", bytes: 4 },
    { type: "THINKING_DELTA", bytes: 2 },
    done
  ]);
  assert.deepEqual(
    window.flushes.map((flush) => flush.summary),
    ["text delta (2 chars)", "thinking delta (6 bytes, 2 chunks)"]
  );
  assert.equal(window.evidence.length, 1);
  assert.equal(window.metrics.thinkingDeltaBytes, 6);
});

test("aggregateEventWindow never lists a dropped evidence event", () => {
  const events: ExecutionEvent[] = [
    { type: "TEXT_DELTA", text: "x".repeat(100) },
    toolStart,
    toolDone,
    { type: "TURN_FINISHED" },
    {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: createMessageId(() => "00000000-0000-4000-8000-000000000001"),
        occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        runId: createRunId(() => "00000000-0000-4000-8000-000000000002"),
        taskId: createTaskId(() => "00000000-0000-4000-8000-000000000003"),
        from: createAgentInstanceId(() => "00000000-0000-4000-8000-000000000004"),
        to: "SUPERVISOR",
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "done",
        artifactIds: [],
        evidenceIds: [createEvidenceId(() => "00000000-0000-4000-8000-000000000005")],
        verification: { kind: "PASSED", evidenceIds: [createEvidenceId(() => "00000000-0000-4000-8000-000000000005")] }
      }
    },
    done
  ];
  const window = aggregateEventWindow(events);
  assert.equal(window.metrics.evidenceEvents, 5);
  assert.equal(window.evidence.length, 5);
  assert.ok(window.evidence.some((event) => event.type === "MESSAGE"));
});
