import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentInstanceId,
  createEventId,
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

test("operator and scheduler signals other than RUN_UNBLOCKED cannot clear the terminal latch", () => {
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

/**
 * The one event that does clear the latch, and the seam the whole unblock
 * contract rests on.
 *
 * Three flowchart recorders, the parent-terminal guard and every other writer
 * decide whether the log already ended by asking `replayedTerminalStatus`. So a
 * matched `RUN_UNBLOCKED` reopening all of them is not five changes: it is this
 * one, and the per-writer special case that would otherwise be needed at each
 * site is what these cases exist to keep from ever being written.
 */
function blockedLog(id: string) {
  return [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent(
      "RUN_BLOCKED",
      { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_x"] },
      { id: createEventId(() => id) }
    )
  ];
}

function unblocking(id: string, retryNodeId?: string) {
  return makeEvent(
    "RUN_UNBLOCKED",
    {
      blockedEventId: createEventId(() => id),
      reason: "operator reviewed the queued analysis",
      ...(retryNodeId !== undefined ? { retryNodeId } : {})
    },
    { id: createEventId(() => `unblock-${id}`) }
  );
}

test("a matched RUN_UNBLOCKED clears the latch, so every terminal recorder opens again", () => {
  assert.ok(
    (EVENT_TYPES as readonly string[]).includes("RUN_UNBLOCKED"),
    "the unblock is a persisted event type, not a runtime-only signal"
  );

  const blocked = blockedLog("block-1");
  const unblocked = [...blocked, unblocking("block-1", "node-a")];

  assert.equal(replayRun(unblocked).status, "RUNNING", "the run is back on the pre-terminal ladder");
  assert.equal(replayedTerminalStatus(unblocked), undefined, "the latch is open");
  assert.deepEqual(replayRun(unblocked).anomalies, []);
  assert.equal(replayRun(unblocked).activeBlockedEventId, undefined);
  assert.equal(replayRun(unblocked).clearingUnblockEventId, unblocked[3]?.id);

  // The point of clearing it: the next terminal is a first terminal, not a
  // second one, at every recorder that consults the definition above.
  const completed = [...unblocked, makeEvent("RUN_COMPLETED", {})];
  assert.equal(replayRun(completed).status, "COMPLETED");
  assert.deepEqual(replayRun(completed).anomalies, []);
  assert.equal(replayedTerminalStatus(completed), "COMPLETED");

  // And the latch closes behind it exactly as before.
  assert.deepEqual(
    replayRun([...completed, makeEvent("RUN_FAILED", { reason: "late" })]).anomalies,
    ["multiple terminal events"]
  );

  // `RUN_UNBLOCKED` is not itself a status, so the set of terminals it opens is
  // the same set it is not a member of.
  assert.deepEqual([...TERMINAL_REPLAY_STATUSES].toSorted(), ["BLOCKED", "COMPLETED", "FAILED"]);
});

test("an unblocked run re-derives its status rather than asserting RUNNING", () => {
  const unblocked = [...blockedLog("block-1"), unblocking("block-1")];
  assert.equal(
    replayRun([...unblocked, makeEvent("PAUSE_REQUESTED", { reason: "hold" })]).status,
    "PAUSED"
  );
  assert.equal(replayRun([...unblocked, makeEvent("RUN_CANCEL_REQUESTED", {})]).status, "CANCELLED");
  assert.equal(
    replayRun([
      ...unblocked,
      makeEvent("RUN_WAITING_FOR_USER", { messageId: "msg_01234567-89ab-cdef-0123-456789abcdef" })
    ]).status,
    "WAITING_FOR_USER"
  );
});

test("a stale RUN_UNBLOCKED is recorded as an anomaly and the block stays in force", () => {
  const stale = [...blockedLog("block-1"), unblocking("block-other")];
  const state = replayRun(stale);
  assert.equal(state.status, "BLOCKED", "an unblock aimed at a different block clears nothing");
  assert.equal(replayedTerminalStatus(stale), "BLOCKED");
  assert.deepEqual(state.anomalies, ["RUN_UNBLOCKED does not match the active RUN_BLOCKED"]);
  assert.equal(state.activeBlockedEventId, blockedLog("block-1")[2]?.id);
  assert.equal(state.clearingUnblockEventId, undefined);
  assert.deepEqual(
    replayRun([...stale, makeEvent("RUN_FAILED", { reason: "late" })]).anomalies,
    ["RUN_UNBLOCKED does not match the active RUN_BLOCKED", "multiple terminal events"],
    "the recorders stay refused after a stale unblock"
  );

  // Replaying the same authorization twice is the same mismatch: the first one
  // already retired the block it named.
  const doubled = [...blockedLog("block-1"), unblocking("block-1"), unblocking("block-1")];
  assert.deepEqual(replayRun(doubled).anomalies, ["RUN_UNBLOCKED without an active RUN_BLOCKED"]);
  assert.equal(replayRun(doubled).status, "RUNNING", "the second is noise, not a re-block");
});

test("RUN_UNBLOCKED against a COMPLETED or unblocked log is anomalous and changes nothing", () => {
  const completed = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_COMPLETED", {}),
    unblocking("block-1")
  ];
  assert.equal(replayRun(completed).status, "COMPLETED", "an unblock cannot un-complete a run");
  assert.equal(replayedTerminalStatus(completed), "COMPLETED");
  assert.deepEqual(replayRun(completed).anomalies, ["RUN_UNBLOCKED after a terminal event"]);

  const failed = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_FAILED", { reason: "executor crashed" }),
    unblocking("block-1")
  ];
  assert.equal(replayRun(failed).status, "FAILED");
  assert.deepEqual(replayRun(failed).anomalies, ["RUN_UNBLOCKED after a terminal event"]);

  const neverBlocked = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    unblocking("block-1")
  ];
  assert.equal(replayRun(neverBlocked).status, "RUNNING");
  assert.deepEqual(replayRun(neverBlocked).anomalies, ["RUN_UNBLOCKED without an active RUN_BLOCKED"]);
});

test("a run can cycle BLOCKED, RUNNING and BLOCKED again, each unblock naming its own block", () => {
  const cycled = [
    ...blockedLog("block-1"),
    unblocking("block-1", "node-a"),
    makeEvent(
      "RUN_BLOCKED",
      { reason: "no progress for too many rounds", requiredEvidence: ["evd_y"] },
      { id: createEventId(() => "block-2") }
    )
  ];
  assert.equal(replayRun(cycled).status, "BLOCKED", "the second block is a first terminal, not a second");
  assert.deepEqual(replayRun(cycled).anomalies, []);
  assert.equal(replayRun(cycled).activeBlockedEventId, createEventId(() => "block-2"));
  assert.equal(replayRun(cycled).clearingUnblockEventId, undefined, "the earlier clear is spent");

  // The first block's authorization does not carry over to the second block.
  const reused = [...cycled, unblocking("block-1")];
  assert.equal(replayRun(reused).status, "BLOCKED");
  assert.deepEqual(replayRun(reused).anomalies, ["RUN_UNBLOCKED does not match the active RUN_BLOCKED"]);

  const cleared = [...cycled, unblocking("block-2")];
  assert.equal(replayRun(cleared).status, "RUNNING");
  assert.deepEqual(replayRun(cleared).anomalies, []);
  assert.equal(replayedTerminalStatus(cleared), undefined);

  const finished = [...cleared, makeEvent("RUN_COMPLETED", {})];
  assert.equal(replayRun(finished).status, "COMPLETED");
  assert.deepEqual(replayRun(finished).anomalies, [], "two full cycles still end with one terminal");
});

/**
 * The second clearing event, held to exactly the first one's rules.
 *
 * `RUN_UNBLOCKED_WITH_DISCARD` authorizes a wider checkpoint *transform* — it
 * may rewind executed descendants, which the ordinary event refuses. It
 * authorizes nothing wider here. If matching were laxer for it, an operator
 * could clear a block the ordinary event could not simply by asking to discard
 * more, which inverts what the stronger authorization means; and if it were
 * stricter, a log carrying one would replay as still-blocked while the
 * checkpoint had already reopened. So the whole of the difference is which
 * transform the restore path runs, and none of it is here.
 */
function discardUnblocking(id: string, retryNodeId = "node-a") {
  return makeEvent(
    "RUN_UNBLOCKED_WITH_DISCARD",
    {
      blockedEventId: createEventId(() => id),
      reason: "operator authorized discarding the executed branch",
      retryNodeId,
      rewoundDescendants: [
        {
          nodeId: "node-b",
          taskId: TASK,
          previousState: "COMPLETED",
          modelRouteEventIds: [createEventId(() => "route-b")],
          childRunIds: [createRunId(() => "11111111-2222-3333-4444-555555555555")],
          chargedEstimatedCostUsd: 0.5,
          chargedEstimatedDurationMs: 4_000
        }
      ]
    },
    { id: createEventId(() => `discard-${id}`) }
  );
}

test("a matched RUN_UNBLOCKED_WITH_DISCARD clears the latch exactly as the ordinary one does", () => {
  assert.ok(
    (EVENT_TYPES as readonly string[]).includes("RUN_UNBLOCKED_WITH_DISCARD"),
    "the stronger authorization is a persisted event type of its own"
  );

  const unblocked = [...blockedLog("block-1"), discardUnblocking("block-1")];
  assert.equal(replayRun(unblocked).status, "RUNNING");
  assert.equal(replayedTerminalStatus(unblocked), undefined, "the latch is open");
  assert.deepEqual(replayRun(unblocked).anomalies, []);
  assert.equal(replayRun(unblocked).activeBlockedEventId, undefined);
  assert.equal(replayRun(unblocked).clearingUnblockEventId, unblocked[3]?.id);

  const completed = [...unblocked, makeEvent("RUN_COMPLETED", {})];
  assert.equal(replayRun(completed).status, "COMPLETED");
  assert.deepEqual(replayRun(completed).anomalies, []);
  assert.deepEqual(
    replayRun([...completed, makeEvent("RUN_FAILED", { reason: "late" })]).anomalies,
    ["multiple terminal events"],
    "and the latch closes behind it"
  );

  // It is an event, not a status: the set of terminals it opens is the same set
  // neither clearing event is a member of.
  assert.deepEqual([...TERMINAL_REPLAY_STATUSES].toSorted(), ["BLOCKED", "COMPLETED", "FAILED"]);
});

test("an unblocked-with-discard run re-derives its status from the rest of the log", () => {
  const unblocked = [...blockedLog("block-1"), discardUnblocking("block-1")];
  assert.equal(
    replayRun([...unblocked, makeEvent("PAUSE_REQUESTED", { reason: "hold" })]).status,
    "PAUSED"
  );
  assert.equal(replayRun([...unblocked, makeEvent("RUN_CANCEL_REQUESTED", {})]).status, "CANCELLED");
  assert.equal(
    replayRun([
      ...unblocked,
      makeEvent("RUN_WAITING_FOR_USER", { messageId: "msg_01234567-89ab-cdef-0123-456789abcdef" })
    ]).status,
    "WAITING_FOR_USER"
  );
});

test("a stale, doubled or post-terminal discard authorization clears nothing and names itself", () => {
  const stale = [...blockedLog("block-1"), discardUnblocking("block-other")];
  assert.equal(replayRun(stale).status, "BLOCKED");
  assert.equal(replayedTerminalStatus(stale), "BLOCKED");
  assert.deepEqual(replayRun(stale).anomalies, [
    "RUN_UNBLOCKED_WITH_DISCARD does not match the active RUN_BLOCKED"
  ]);
  assert.equal(replayRun(stale).clearingUnblockEventId, undefined);

  const doubled = [...blockedLog("block-1"), discardUnblocking("block-1"), discardUnblocking("block-1")];
  assert.deepEqual(replayRun(doubled).anomalies, [
    "RUN_UNBLOCKED_WITH_DISCARD without an active RUN_BLOCKED"
  ]);
  assert.equal(replayRun(doubled).status, "RUNNING");

  const afterCompleted = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    makeEvent("RUN_COMPLETED", {}),
    discardUnblocking("block-1")
  ];
  assert.equal(replayRun(afterCompleted).status, "COMPLETED", "no authorization un-completes a run");
  assert.deepEqual(replayRun(afterCompleted).anomalies, [
    "RUN_UNBLOCKED_WITH_DISCARD after a terminal event"
  ]);

  const neverBlocked = [
    makeEvent("RUN_CREATED", { run }),
    makeEvent("RUN_STARTED", {}),
    discardUnblocking("block-1")
  ];
  assert.deepEqual(replayRun(neverBlocked).anomalies, [
    "RUN_UNBLOCKED_WITH_DISCARD without an active RUN_BLOCKED"
  ]);
});

/**
 * Where the audit record's money claim is checked, and where it deliberately is
 * not.
 *
 * Replay reconstructs control state from event identity: which block is active,
 * which authorization matched it. `discardUnblocking` above already cites a
 * `MODEL_ROUTED` id no log here carries and charges nobody can reconcile, and
 * replay is right to say nothing about it — an anomaly is an observation a
 * resume steps over, and a payload that overstates what a rewind cost must stop
 * the resume, not annotate it.
 *
 * So the check belongs to the restore path, which is the reader that acts on
 * the payload, and it has to stay there: without it a hand-edited row naming
 * the right consequence set with inflated totals resumes cleanly and the run
 * carries a durable record that lies about money.
 */
test("replay does not audit a discard's charged estimates; the restore transform does", () => {
  const unsupported = [...blockedLog("block-1"), discardUnblocking("block-1")];
  assert.deepEqual(
    replayRun(unsupported).anomalies,
    [],
    "no MODEL_ROUTED row on this log supports the payload's charges, and replay does not look"
  );
  assert.equal(replayRun(unsupported).status, "RUNNING", "the latch still opens on identity alone");
  assert.equal(replayRun(unsupported).clearingUnblockEventId, unsupported[3]?.id);

  const start = FLOWCHART_RUN_SOURCE.indexOf("function applyClearingEvent(");
  const end = FLOWCHART_RUN_SOURCE.indexOf("export async function unblockFlowchartRun(", start + 1);
  assert.notEqual(start, -1, "the single restore-side transform must stay a named function");
  assert.notEqual(end, -1, "its source boundary must remain inspectable");
  assert.match(
    FLOWCHART_RUN_SOURCE.slice(start, end),
    /assertDiscardAuditMatchesLog\(/,
    "the restore transform must re-derive the charged estimates from the cited rows"
  );
});

test("the two clearing events interleave over a re-block cycle without either inheriting the other's block", () => {
  const cycled = [
    ...blockedLog("block-1"),
    discardUnblocking("block-1"),
    makeEvent(
      "RUN_BLOCKED",
      { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_y"] },
      { id: createEventId(() => "block-2") }
    )
  ];
  assert.equal(replayRun(cycled).status, "BLOCKED", "the second block is a first terminal");
  assert.deepEqual(replayRun(cycled).anomalies, []);
  assert.equal(replayRun(cycled).activeBlockedEventId, createEventId(() => "block-2"));

  // A discard spent on the first block does not carry over to the second, and
  // neither does an ordinary authorization aimed at the first.
  assert.deepEqual(replayRun([...cycled, discardUnblocking("block-1")]).anomalies, [
    "RUN_UNBLOCKED_WITH_DISCARD does not match the active RUN_BLOCKED"
  ]);
  assert.deepEqual(replayRun([...cycled, unblocking("block-1")]).anomalies, [
    "RUN_UNBLOCKED does not match the active RUN_BLOCKED"
  ]);

  // Either event may clear either block: the strength is about the transform,
  // not about which block it is allowed to name.
  const clearedOrdinary = [...cycled, unblocking("block-2", "node-a")];
  assert.equal(replayRun(clearedOrdinary).status, "RUNNING");
  assert.deepEqual(replayRun(clearedOrdinary).anomalies, []);

  const finished = [...cycled, discardUnblocking("block-2"), makeEvent("RUN_COMPLETED", {})];
  assert.equal(replayRun(finished).status, "COMPLETED");
  assert.deepEqual(replayRun(finished).anomalies, [], "two cycles, two authorizations, one terminal");
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
