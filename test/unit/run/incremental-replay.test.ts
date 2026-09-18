import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentInstanceId,
  createEventId,
  createProjectId,
  createRunId,
  createTaskId,
  type EventId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { replayFromCheckpointOffset } from "../../../src/run/incremental-replay.js";
import {
  applyReplayEvents,
  createReplayCursor,
  replayRun,
  snapshotReplay
} from "../../../src/run/replay.js";
import { makeEvent } from "../../helpers/event-factory.js";

function sequenceEventId(): () => EventId {
  let n = 0;
  return () => createEventId(() => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`);
}

const nextId = sequenceEventId();
const AGENT = createAgentInstanceId(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const TASK = createTaskId(() => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const RUN = createRunId(() => "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

const run = {
  id: RUN,
  projectId: createProjectId(() => "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
  rootTaskId: TASK,
  status: "PLANNING" as const,
  limits: defaultRunLimits(),
  createdAt: "2026-08-12T09:00:00.000Z",
  updatedAt: "2026-08-12T09:00:00.000Z"
};

function ev(type: Parameters<typeof makeEvent>[0], payload?: unknown) {
  return makeEvent(type, payload, { id: nextId(), runId: RUN });
}

function happyPath() {
  return [
    ev("RUN_CREATED", { run }),
    ev("PROJECT_DISCOVERED", {
      project: {
        id: run.projectId,
        rootPath: "/tmp/demo",
        discoveredAt: "2026-08-12T09:00:00.000Z",
        instructionFiles: [],
        manifests: [],
        commands: [],
        facts: []
      }
    }),
    ev("RUN_STARTED", {}),
    ev("AGENT_STARTED", { agentInstanceId: AGENT, taskId: TASK }),
    ev("AGENT_EVENT", { agentInstanceId: AGENT, kind: "TOOL_FINISHED", summary: "ok" }),
    ev("AGENT_FINISHED", { agentInstanceId: AGENT, outcome: "SUCCESS" }),
    ev("RUN_COMPLETED", {})
  ];
}

test("missing lastEventId falls back to full replay with identical state", () => {
  const events = happyPath();
  const result = replayFromCheckpointOffset(events, undefined);
  assert.equal(result.mode, "full");
  assert.equal(result.reason, "no-checkpoint-offset");
  assert.deepEqual(result.state, replayRun(events));
  assert.equal(result.eventsSkipped, 0);
  assert.equal(result.eventsApplied, events.length);
});

test("unknown lastEventId falls back to full replay", () => {
  const events = happyPath();
  const missing = createEventId(() => "ffffffff-ffff-4fff-8fff-ffffffffffff");
  const result = replayFromCheckpointOffset(events, missing);
  assert.equal(result.mode, "full");
  assert.equal(result.reason, "offset-event-missing");
  assert.deepEqual(result.state, replayRun(events));
});

test("incremental split at lastEventId matches full replay (characterization)", () => {
  const events = happyPath();
  for (let i = 0; i < events.length; i += 1) {
    const offset = events[i]!.id;
    const result = replayFromCheckpointOffset(events, offset);
    assert.equal(result.mode, "incremental", `split at index ${i}`);
    assert.equal(result.reason, "safe");
    assert.equal(result.eventsSkipped, i + 1);
    assert.equal(result.eventsApplied, events.length - i - 1);
    assert.deepEqual(result.state, replayRun(events));
  }
});

test("live cursor continueReplay matches full replay after pause then complete", () => {
  const created = ev("RUN_CREATED", { run });
  const started = ev("RUN_STARTED", {});
  const paused = ev("PAUSE_REQUESTED", { reason: "hold" });
  const cleared = ev("PAUSE_CLEARED", {});
  const completed = ev("RUN_COMPLETED", {});
  const prefix = [created, started, paused];
  const tail = [cleared, completed];
  const cursor = createReplayCursor();
  applyReplayEvents(cursor, prefix);
  assert.equal(snapshotReplay(cursor).status, "PAUSED");
  applyReplayEvents(cursor, tail);
  assert.deepEqual(snapshotReplay(cursor), replayRun([...prefix, ...tail]));
});

test("incremental unblock latch matches full replay", () => {
  const created = ev("RUN_CREATED", { run });
  const started = ev("RUN_STARTED", {});
  const blocked = ev("RUN_BLOCKED", { reason: "stall", evidence: [] });
  const unblocked = makeEvent(
    "RUN_UNBLOCKED",
    { blockedEventId: blocked.id, reason: "resume" },
    { id: nextId(), runId: RUN }
  );
  const completed = ev("RUN_COMPLETED", {});
  const events = [created, started, blocked, unblocked, completed];
  const result = replayFromCheckpointOffset(events, blocked.id);
  assert.equal(result.mode, "incremental");
  assert.deepEqual(result.state, replayRun(events));
  assert.equal(result.state.status, "COMPLETED");
  assert.equal(result.state.activeBlockedEventId, undefined);
});

test("incremental after terminal still reports pause-after-terminal anomaly", () => {
  const created = ev("RUN_CREATED", { run });
  const completed = ev("RUN_COMPLETED", {});
  const pause = ev("PAUSE_REQUESTED", { reason: "too late" });
  const events = [created, completed, pause];
  const result = replayFromCheckpointOffset(events, completed.id);
  assert.deepEqual(result.state, replayRun(events));
  assert.ok(result.state.anomalies.some((item) => /PAUSE_REQUESTED after a terminal/.test(item)));
});
