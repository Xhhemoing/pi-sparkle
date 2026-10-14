import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventId } from "../../../src/domain/ids.js";
import type { Event } from "../../../src/run/events.js";
import {
  persistBlocked,
  persistCompleted,
  persistFailed,
  type FlowchartTerminalContext
} from "../../../src/run/flowchart-terminal.js";
import { replayRun } from "../../../src/run/replay.js";
import { makeEvent, makeRun } from "../../helpers/event-factory.js";

const run = makeRun();

function event(type: Event["type"], payload: unknown): Event {
  return makeEvent(type, payload, { id: createEventId(), runId: run.id });
}

function terminal(type: "RUN_BLOCKED" | "RUN_COMPLETED" | "RUN_FAILED"): Event {
  return event(type, type === "RUN_BLOCKED"
    ? { reason: "ANALYSIS_QUEUED", requiredEvidence: ["Independent review"] }
    : type === "RUN_FAILED" ? { reason: "Prior failure" } : {});
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settled) => { resolve = settled; });
  return { promise, resolve };
}

function harness(options: {
  prior?: readonly Event[];
  cancel?: () => Promise<void>;
  beforeAppend?: (row: Event) => Promise<void>;
} = {}) {
  const events = [event("RUN_CREATED", { run }), event("RUN_STARTED", {}), ...(options.prior ?? [])];
  const trace: string[] = [];
  const ledger = {
    round: 4,
    consecutiveStalls: 3,
    requiredEvidence: [{ description: "Independent review" }, { description: "Regression evidence" }]
  };
  const ctx: FlowchartTerminalContext = {
    eventStore: {
      async readAll() {
        trace.push("read");
        return { events: [...events] };
      }
    },
    supervisor: {
      snapshot() {
        trace.push("snapshot");
        return { ledger };
      }
    },
    abort: {
      async cancelAndSettle() {
        trace.push("cancel:start");
        await options.cancel?.();
        trace.push("cancel:settled");
      }
    },
    make(type, payload) {
      trace.push(`make:${type}`);
      return event(type, payload);
    },
    async append(row) {
      trace.push(`append:${row.type}`);
      await options.beforeAppend?.(row);
      events.push(row);
    }
  };
  return { ctx, events, trace, ledger };
}

const recorders: readonly {
  name: string;
  type: "RUN_BLOCKED" | "RUN_COMPLETED" | "RUN_FAILED";
  record: (ctx: FlowchartTerminalContext) => Promise<void>;
}[] = [
  { name: "blocked", type: "RUN_BLOCKED", record: persistBlocked },
  { name: "completed", type: "RUN_COMPLETED", record: persistCompleted },
  { name: "failed", type: "RUN_FAILED", record: (ctx) => persistFailed(ctx, "New failure") }
];

test("blocking awaits stall evidence before the terminal event and preserves both payloads", async () => {
  const stallStarted = deferred();
  const releaseStall = deferred();
  const { ctx, events, trace } = harness({
    async beforeAppend(row) {
      if (row.type !== "STALL_DETECTED") return;
      stallStarted.resolve();
      await releaseStall.promise;
    }
  });
  const pending = persistBlocked(ctx);
  await stallStarted.promise;
  assert.deepEqual(trace, ["read", "snapshot", "make:STALL_DETECTED", "append:STALL_DETECTED"]);
  assert.deepEqual(events.map((row) => row.type), ["RUN_CREATED", "RUN_STARTED"]);
  releaseStall.resolve();
  await pending;
  assert.deepEqual(events.slice(2).map((row) => [row.type, row.payload]), [
    ["STALL_DETECTED", {
      round: 4,
      consecutiveStalls: 3,
      requiredEvidence: ["Independent review", "Regression evidence"]
    }],
    ["RUN_BLOCKED", {
      reason: "no progress for too many rounds",
      requiredEvidence: ["Independent review", "Regression evidence"]
    }]
  ]);
  assert.equal(replayRun(events).status, "BLOCKED");
  assert.deepEqual(replayRun(events).anomalies, []);
});

test("every existing normal terminal suppresses all three recorders without a second terminal", async () => {
  for (const type of ["RUN_BLOCKED", "RUN_COMPLETED", "RUN_FAILED"] as const) {
    for (const recorder of recorders) {
      const { ctx, events, trace } = harness({ prior: [terminal(type)] });
      const initial = [...events];
      await recorder.record(ctx);
      assert.deepEqual(events, initial, `${type} must suppress ${recorder.name}`);
      assert.equal(trace.includes("snapshot"), false, "refused block does not read the ledger");
      assert.deepEqual(trace, recorder.name === "failed" ? ["cancel:start", "cancel:settled", "read"] : ["read"]);
      assert.deepEqual(replayRun(events).anomalies, []);
    }
  }
});

test("a matched ordinary unblock allows each recorder to append the next normal terminal", async () => {
  for (const recorder of recorders) {
    const blocked = terminal("RUN_BLOCKED");
    const unblock = event("RUN_UNBLOCKED", { blockedEventId: blocked.id, reason: "Owner authorized retry" });
    const { ctx, events } = harness({ prior: [blocked, unblock] });
    await recorder.record(ctx);
    assert.equal(events.at(-1)?.type, recorder.type);
    assert.deepEqual(replayRun(events).anomalies, [], `${recorder.name} opens only after matching authorization`);
  }
});

test("failure waits for child settlement before reading the log and appending the supplied reason", async () => {
  const cancelStarted = deferred();
  const releaseCancel = deferred();
  const { ctx, events, trace } = harness({
    async cancel() {
      cancelStarted.resolve();
      await releaseCancel.promise;
    }
  });
  const pending = persistFailed(ctx, "Exact failure reason");
  await cancelStarted.promise;
  assert.deepEqual(trace, ["cancel:start"]);
  assert.equal(events.length, 2);
  releaseCancel.resolve();
  await pending;
  assert.deepEqual(trace, ["cancel:start", "cancel:settled", "read", "make:RUN_FAILED", "append:RUN_FAILED"]);
  assert.deepEqual(events.at(-1)?.payload, { reason: "Exact failure reason" });
  assert.equal(replayRun(events).status, "FAILED");
  assert.deepEqual(replayRun(events).anomalies, []);
});

test("a block recorded while cancellation settles suppresses a later failure", async () => {
  const cancelStarted = deferred();
  const releaseCancel = deferred();
  const { ctx, events, trace } = harness({
    async cancel() {
      cancelStarted.resolve();
      await releaseCancel.promise;
    }
  });
  const pending = persistFailed(ctx, "Must not bury the settled block");
  await cancelStarted.promise;
  events.push(terminal("RUN_BLOCKED"));
  releaseCancel.resolve();
  await pending;
  assert.deepEqual(trace, ["cancel:start", "cancel:settled", "read"]);
  assert.equal(events.at(-1)?.type, "RUN_BLOCKED");
  assert.equal(replayRun(events).status, "BLOCKED");
  assert.deepEqual(replayRun(events).anomalies, []);
});

test("failed cancellation propagates before any log read or terminal append", async () => {
  const failure = new Error("Cancellation did not settle");
  const { ctx, events, trace } = harness({ cancel: async () => { throw failure; } });
  await assert.rejects(persistFailed(ctx, "Suppressed reason"), (error) => error === failure);
  assert.deepEqual(trace, ["cancel:start"]);
  assert.equal(events.length, 2);
});

test("failed stall append propagates without constructing or appending a block", async () => {
  const failure = new Error("Stall evidence write failed");
  const { ctx, events, trace } = harness({
    async beforeAppend(row) {
      if (row.type === "STALL_DETECTED") throw failure;
    }
  });
  await assert.rejects(persistBlocked(ctx), (error) => error === failure);
  assert.deepEqual(trace, ["read", "snapshot", "make:STALL_DETECTED", "append:STALL_DETECTED"]);
  assert.equal(events.length, 2);
});
