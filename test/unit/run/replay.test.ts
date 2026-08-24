import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentInstanceId,
  createProjectId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { EVENT_TYPES } from "../../../src/run/events.js";
import {
  eventsLookLikeFlowchartRun,
  materializeCheckpoint,
  replayedTerminalStatus,
  replayRun,
  TERMINAL_REPLAY_STATUSES,
  validateCheckpoint
} from "../../../src/run/replay.js";
import { makeEvent } from "../../helpers/event-factory.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const AGENT = createAgentInstanceId(UUID);
const TASK = createTaskId(UUID);
const FLOWCHART_RUN_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../src/run/flowchart-run.ts", import.meta.url)),
  "utf8"
);

const run = {
  id: createRunId(UUID),
  projectId: createProjectId(UUID),
  rootTaskId: TASK,
  status: "PLANNING",
  limits: defaultRunLimits(),
  createdAt: "2026-08-12T09:00:00.000Z",
  updatedAt: "2026-08-12T09:00:00.000Z"
};

function happyPathEvents() {
  const created = makeEvent("RUN_CREATED", { run });
  const discovered = makeEvent("PROJECT_DISCOVERED", {
    project: {
      id: createProjectId(UUID),
      rootPath: "/tmp/demo",
      discoveredAt: "2026-08-12T09:00:00.000Z",
      instructionFiles: [],
      manifests: [],
      commands: [],
      facts: []
    }
  });
  const started = makeEvent("RUN_STARTED", {});
  const agentStarted = makeEvent("AGENT_STARTED", { agentInstanceId: AGENT, taskId: TASK }, { taskId: TASK });
  const agentEvent = makeEvent("AGENT_EVENT", { agentInstanceId: AGENT, kind: "TOOL_FINISHED", summary: "Ran pnpm test" }, { taskId: TASK });
  const agentFinished = makeEvent("AGENT_FINISHED", { agentInstanceId: AGENT, outcome: "SUCCESS" }, { taskId: TASK });
  const completed = makeEvent("RUN_COMPLETED", {});
  return [created, discovered, started, agentStarted, agentEvent, agentFinished, completed];
}

test("an empty log replays to PLANNING with no anomalies", () => {
  const state = replayRun([]);
  assert.equal(state.status, "PLANNING");
  assert.equal(state.run, undefined);
  assert.deepEqual(state.anomalies, []);
});

test("a happy-path log replays to a completed run with evidence", () => {
  const events = happyPathEvents();
  const state = replayRun(events);
  assert.equal(state.status, "COMPLETED");
  assert.deepEqual(state.run, run);
  assert.equal(state.project?.rootPath, "/tmp/demo");
  assert.deepEqual(state.agentOutcomes, [{ agentInstanceId: AGENT, outcome: "SUCCESS", taskId: TASK }]);
  assert.equal(state.lastEventId, events[events.length - 1]?.id);
  assert.deepEqual(state.anomalies, []);
});

test("a cancellation request replays to CANCELLED", () => {
  const events = happyPathEvents().slice(0, 2);
  events.push(makeEvent("RUN_CANCEL_REQUESTED", {}));
  const state = replayRun(events);
  assert.equal(state.status, "CANCELLED");
});

test("a failure replays to FAILED with its reason", () => {
  const events = happyPathEvents().slice(0, 4);
  events.push(makeEvent("RUN_FAILED", { reason: "executor crashed" }));
  const state = replayRun(events);
  assert.equal(state.status, "FAILED");
});

test("ordering violations are reported as anomalies", () => {
  const startedBeforeCreated = [makeEvent("RUN_STARTED", {}), makeEvent("RUN_CREATED", { run })];
  assert.deepEqual(replayRun(startedBeforeCreated).anomalies, ["RUN_STARTED before RUN_CREATED"]);

  const createdTwice = [makeEvent("RUN_CREATED", { run }), makeEvent("RUN_CREATED", { run })];
  assert.deepEqual(replayRun(createdTwice).anomalies, ["multiple RUN_CREATED events"]);

  const twoTerminals = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_COMPLETED", {}),
    makeEvent("RUN_FAILED", { reason: "late" })
  ];
  assert.deepEqual(replayRun(twoTerminals).anomalies, ["multiple terminal events"]);

  const cancelAfterTerminal = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_COMPLETED", {}),
    makeEvent("RUN_CANCEL_REQUESTED", {})
  ];
  assert.deepEqual(replayRun(cancelAfterTerminal).anomalies, ["RUN_CANCEL_REQUESTED after a terminal event"]);
});

/**
 * The ordering the run loop must never produce. The tracking gate's
 * `queue_analysis` appends `RUN_BLOCKED` and means terminal-until-unblocked, so a
 * `RUN_FAILED` on top of it is a second terminal — and it buries a state the
 * operator can still act on. Replay is the arbiter of that rule and stays it: the
 * writers consult replay rather than the other way round.
 */
test("RUN_BLOCKED is a terminal, so a RUN_FAILED after it is a second one", () => {
  const blockedThenFailed = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_BLOCKED", { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_x"] }),
    makeEvent("RUN_FAILED", { reason: "flowchart node failed: tsk_x" })
  ];
  assert.deepEqual(replayRun(blockedThenFailed).anomalies, ["multiple terminal events"]);

  const blockedOnly = blockedThenFailed.slice(0, 3);
  assert.equal(replayRun(blockedOnly).status, "BLOCKED");
  assert.deepEqual(replayRun(blockedOnly).anomalies, []);
});

test("all three flowchart terminal recorders refuse while replay names BLOCKED", () => {
  const recorderBounds = [
    ["persistBlocked", "persistCompleted"],
    ["persistCompleted", "persistFailed"],
    ["persistFailed", "finish"]
  ] as const;

  for (const [recorder, nextFunction] of recorderBounds) {
    const start = FLOWCHART_RUN_SOURCE.indexOf(`async function ${recorder}(`);
    const end = FLOWCHART_RUN_SOURCE.indexOf(`async function ${nextFunction}(`, start + 1);
    assert.notEqual(start, -1, `${recorder} must remain a named terminal recorder`);
    assert.notEqual(end, -1, `${recorder} source boundary must remain inspectable`);
    assert.match(
      FLOWCHART_RUN_SOURCE.slice(start, end),
      /if \(await alreadyTerminal\(ctx\)\) return;/,
      `${recorder} must refuse after RUN_BLOCKED until an explicit unblock contract lands`
    );
  }

  assert.match(
    FLOWCHART_RUN_SOURCE,
    /async function alreadyTerminal\(ctx: FlowchartLoopContext\): Promise<boolean> \{[\s\S]*?replayedTerminalStatus\(read\.events\) !== undefined;[\s\S]*?\}/,
    "the three refusals must keep consulting replay's shared terminal definition"
  );
});

test("current operator and scheduler signals cannot clear RUN_BLOCKED or its terminal latch", () => {
  assert.equal(
    (EVENT_TYPES as readonly string[]).includes("RUN_UNBLOCKED"),
    false,
    "adding persisted unblock schema requires parent sign-off and replacement of this current-behavior pin"
  );

  const blocked = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_BLOCKED", { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_x"] })
  ];
  const signals = [
    makeEvent("RUN_STARTED", {}),
    makeEvent("INJECTION_REQUESTED", {
      kind: "fact",
      actor: "operator",
      confidence: 1,
      key: "analysis",
      value: "reviewed"
    }),
    makeEvent(
      "TASK_STATUS_CHANGED",
      { taskId: TASK, status: "READY", attempt: 1 },
      { taskId: TASK }
    ),
    makeEvent("GATE_TRANSITION", {
      transitionId: "transition-current-unblock-probe",
      episodeId: "episode-current-unblock-probe",
      turnId: TASK,
      seq: 1,
      from: "BLOCKED",
      to: "RUNNING",
      reasonCode: "operator-reviewed",
      assessmentHash: "assessment-current-unblock-probe",
      evidenceRefs: ["evd_x"],
      policyVersion: "track-v1",
      idempotencyKey: "current-unblock-probe",
      directive: "none"
    })
  ];

  for (const signal of signals) {
    const afterSignal = [...blocked, signal];
    assert.equal(replayRun(afterSignal).status, "BLOCKED", `${signal.type} must not unblock the run`);
    assert.equal(
      replayedTerminalStatus(afterSignal),
      "BLOCKED",
      `${signal.type} must not clear replay's terminal latch`
    );
    assert.deepEqual(replayRun(afterSignal).anomalies, []);
    assert.deepEqual(
      replayRun([...afterSignal, makeEvent("RUN_FAILED", { reason: "late" })]).anomalies,
      ["multiple terminal events"],
      `${signal.type} must leave RUN_BLOCKED terminal for the next recorder`
    );
  }
});

test("replayedTerminalStatus names the terminal a log already carries", () => {
  const started = [makeEvent("RUN_CREATED", { run }), makeEvent("RUN_STARTED", {})];
  assert.equal(replayedTerminalStatus([]), undefined);
  assert.equal(replayedTerminalStatus(started), undefined, "a RUNNING log has no terminal yet");
  assert.equal(
    replayedTerminalStatus([...started, makeEvent("PAUSE_REQUESTED", { reason: "hold" })]),
    undefined,
    "paused is resumable, not terminal"
  );
  assert.equal(
    replayedTerminalStatus([...started, makeEvent("RUN_CANCEL_REQUESTED", {})]),
    undefined,
    "a cancel request sets no terminal in replay, so it names none here either"
  );

  assert.equal(replayedTerminalStatus([...started, makeEvent("RUN_COMPLETED", {})]), "COMPLETED");
  assert.equal(replayedTerminalStatus([...started, makeEvent("RUN_FAILED", { reason: "x" })]), "FAILED");
  assert.equal(
    replayedTerminalStatus([
      ...started,
      makeEvent("RUN_BLOCKED", { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_x"] })
    ]),
    "BLOCKED"
  );

  assert.deepEqual([...TERMINAL_REPLAY_STATUSES].toSorted(), ["BLOCKED", "COMPLETED", "FAILED"]);
});

test("materialized checkpoints validate and preserve replay state", () => {
  const events = happyPathEvents();
  const checkpoint = materializeCheckpoint(replayRun(events), parseIsoTimestamp("2026-08-12T10:00:00.000Z"));
  assert.deepEqual(validateCheckpoint(checkpoint), checkpoint);
  assert.equal(checkpoint.status, "COMPLETED");
  assert.deepEqual(checkpoint.run, run);
  assert.equal(checkpoint.lastEventId, events[events.length - 1]?.id);
  assert.equal(checkpoint.updatedAt, "2026-08-12T10:00:00.000Z");

  const beforeStart = materializeCheckpoint(replayRun(events.slice(0, 2)), parseIsoTimestamp("2026-08-12T10:00:00.000Z"));
  assert.equal(beforeStart.status, "PLANNING");
  assert.equal(beforeStart.lastEventId, events[1]?.id);
});

test("validateCheckpoint rejects malformed checkpoints", () => {
  const checkpoint = materializeCheckpoint(replayRun(happyPathEvents()), parseIsoTimestamp("2026-08-12T10:00:00.000Z"));
  assert.throws(() => validateCheckpoint({ ...checkpoint, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateCheckpoint({ ...checkpoint, status: "DONE" }), /status/);
  assert.throws(() => validateCheckpoint({ ...checkpoint, lastEventId: "nope" }), /lastEventId/);
  assert.throws(
    () => validateCheckpoint({ ...checkpoint, agentOutcomes: [{ agentInstanceId: "bad", outcome: "SUCCESS" }] }),
    /agentOutcomes/
  );
});

test("M0 checkpoints without a flowchart field still validate", () => {
  const checkpoint = materializeCheckpoint(replayRun(happyPathEvents()), parseIsoTimestamp("2026-08-12T10:00:00.000Z"));
  assert.equal(checkpoint.flowchart, undefined);
  assert.deepEqual(validateCheckpoint(checkpoint), checkpoint);
});

test("eventsLookLikeFlowchartRun detects MODEL_ROUTED or flowchart-supervisor actor", () => {
  assert.equal(eventsLookLikeFlowchartRun(happyPathEvents()), false);
  assert.equal(eventsLookLikeFlowchartRun([makeEvent("MODEL_ROUTED", {})]), true);
  assert.equal(
    eventsLookLikeFlowchartRun([makeEvent("RUN_STARTED", {}, { actor: "flowchart-supervisor" })]),
    true
  );
});

test("unmatched PAUSE_REQUESTED reconstructs PAUSED; PAUSE_CLEARED restores waiting", () => {
  const started = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_WAITING_FOR_USER", { messageId: "msg_01234567-89ab-cdef-0123-456789abcdef" })
  ];
  const paused = replayRun([...started, makeEvent("PAUSE_REQUESTED", { reason: "hold" })]);
  assert.equal(paused.status, "PAUSED");
  assert.deepEqual(paused.anomalies, []);

  const cleared = replayRun([
    ...started,
    makeEvent("PAUSE_REQUESTED", { reason: "hold" }),
    makeEvent("PAUSE_CLEARED", {})
  ]);
  assert.equal(cleared.status, "WAITING_FOR_USER");

  const afterTerminal = replayRun([
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_COMPLETED", {}),
    makeEvent("PAUSE_REQUESTED", {})
  ]);
  assert.equal(afterTerminal.status, "COMPLETED");
  assert.ok(afterTerminal.anomalies.some((anomaly) => /PAUSE_REQUESTED.*terminal/.test(anomaly)));

  const afterBlocked = replayRun([
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence: ["need-x"] }),
    makeEvent("PAUSE_REQUESTED", {})
  ]);
  assert.equal(afterBlocked.status, "BLOCKED");
  assert.ok(afterBlocked.anomalies.some((anomaly) => /PAUSE_REQUESTED.*terminal/.test(anomaly)));
});
