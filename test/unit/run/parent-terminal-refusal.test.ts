import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import {
  createEventId,
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId,
  type RunId,
  type TaskId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startParentRun, type RunOutcome } from "../../../src/run/coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import { validateEvent, type Event } from "../../../src/run/events.js";
import { replayRun } from "../../../src/run/replay.js";

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-24T09:00:00.000Z");

/**
 * Deterministic ids, one stream per run. The stream matters: two runs sharing a
 * state root and a stream would mint the same run id and so share one event
 * log — which the refusal under test would then quite correctly report as the
 * first run's terminal.
 */
function sequenceGenerator(stream: number): () => string {
  let n = 0;
  return () => `${String(stream).padStart(8, "0")}-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

let nextStream = 0;

async function withRoots(body: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parent-terminal-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parent-terminal-proj-"));
  try {
    await body(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
  }
}

function childSpec(taskId: string, extra: Partial<ChildTaskInput> = {}): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(taskId),
    role: "implementer",
    objective: `Do ${taskId}`,
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 },
    ...extra
  };
}

/**
 * A child spec whose task id never passes event validation, so the child's
 * first append — `RUN_CREATED` on its own log, before any attempt — rejects and
 * the throw escapes `runTask`. Its `done` rejects, the parent loop's race
 * rejects with it, and the parent lands in the catch-all this file is about.
 *
 * That is one of the loop's honest crash triggers rather than an invented one:
 * `ParentRunInput.children` is not validated at the parent's boundary, so a
 * malformed spec first fails where it is first written down. Any other throw on
 * the path would serve; this one is deterministic and needs no counters.
 */
function unwritableChildSpec(dependsOn: TaskId): ChildTaskInput {
  return { ...childSpec("tsk_crash"), taskId: "not-a-task-id" as TaskId, dependsOn: [dependsOn] };
}

function taskResult(
  request: AgentExecutionRequest,
  verification: "PASSED" | "FAILED"
): ExecutionEvent {
  return {
    type: "MESSAGE",
    message: {
      protocolVersion: 1,
      id: `msg_${verification.toLowerCase()}-${request.agentInstanceId}` as MessageId,
      occurredAt: TS,
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: SUPERVISOR,
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: `the child reported success; verification said ${verification}`,
      artifactIds: [`art_${request.taskId}` as ArtifactId],
      evidenceIds: [`evd_${request.taskId}` as EvidenceId],
      verification: { kind: verification, evidenceIds: [`evd_${request.taskId}` as EvidenceId] }
    }
  };
}

function executorFor(options: {
  readonly result?: (request: AgentExecutionRequest) => ExecutionEvent;
  readonly beforeFirst?: () => Promise<void>;
}): AgentExecutor {
  let first = true;
  return {
    async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
      if (first) {
        first = false;
        await options.beforeFirst?.();
      }
      if (options.result !== undefined) yield options.result(request);
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  };
}

/**
 * Puts the gate's own `RUN_BLOCKED` on a live parent run's log from a second
 * writer, which is what makes the refusals below observable end to end.
 *
 * Why a second writer rather than the gate itself: on this plane the gate's
 * `queue_analysis` breaks the loop in the same statement that follows its
 * appends, so within one `runParentRun` no further `await` exists between
 * `RUN_BLOCKED` landing and the loop's exit — the loop alone cannot reach its
 * own terminal recorders with a blocked log. The parent log nonetheless has
 * more than one writer: `ChildCoordinator` appends to this exact file through
 * its own `EventStore`, `EventStore.append` deliberately takes no run lock, and
 * an unblock producer is being designed. The recorder is keyed on what the log
 * says, not on who wrote it, so this is the shape it has to hold for.
 *
 * The event is the gate's, byte-for-byte in shape: `ANALYSIS_QUEUED` with the
 * owed evidence named, written through the production `EventStore`.
 */
async function blockRunLog(stateRoot: string, runId: RunId, evidenceId: string): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(
    validateEvent({
      id: createEventId(() => "ffffffff-0000-4000-8000-000000000001"),
      schemaVersion: 1,
      occurredAt: TS,
      runId,
      type: "RUN_BLOCKED",
      actor: "supervisor",
      payload: { reason: "ANALYSIS_QUEUED", requiredEvidence: [evidenceId] }
    }) as Event
  );
}

function terminals(events: readonly Event[]): Event["type"][] {
  return events
    .map((event) => event.type)
    .filter((type) => type === "RUN_COMPLETED" || type === "RUN_FAILED" || type === "RUN_BLOCKED");
}

function failureReason(events: readonly Event[]): string | undefined {
  const failed = events.find((event) => event.type === "RUN_FAILED");
  return failed === undefined ? undefined : (failed.payload as { reason: string }).reason;
}

/** Runs the parent plane, optionally blocking its log the first time a child executes. */
async function parentRun(
  stateRoot: string,
  projectRoot: string,
  options: {
    readonly children: readonly ChildTaskInput[];
    readonly result?: (request: AgentExecutionRequest) => ExecutionEvent;
    readonly blockFirst?: boolean;
  }
): Promise<RunOutcome> {
  let runId: RunId | undefined;
  const executor = executorFor({
    ...(options.result !== undefined ? { result: options.result } : {}),
    ...(options.blockFirst === true
      ? { beforeFirst: async () => blockRunLog(stateRoot, runId as RunId, "evd_owed") }
      : {})
  });
  const running = startParentRun(
    { stateRoot, executor, now: () => TS, generateId: sequenceGenerator(nextStream++) },
    { projectRoot, objective: "parent terminal refusal", children: [...options.children] }
  );
  runId = running.runId;
  return running.done;
}

test("a crash after the run is blocked reports the block instead of burying it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const first = childSpec("tsk_first");
    const outcome = await parentRun(stateRoot, projectRoot, {
      children: [first, unwritableChildSpec(first.taskId)],
      result: (request) => taskResult(request, "PASSED"),
      blockFirst: true
    });

    assert.equal(
      outcome.status,
      "BLOCKED",
      "the crash on the way out does not decide the run's terminal; the log's does"
    );
    assert.equal(outcome.checkpoint.status, "BLOCKED", "the durable resume point agrees with the log");
    assert.deepEqual(terminals(outcome.events), ["RUN_BLOCKED"], "exactly one terminal event");
    assert.equal(
      outcome.events.some((event) => event.type === "RUN_FAILED"),
      false,
      "no crash terminal landed on top of the block"
    );
    assert.deepEqual(
      replayRun(outcome.events).anomalies,
      [],
      "the log the crash left behind must not replay as anomalous"
    );

    // The state the unconditional RUN_FAILED buried: the episode is left
    // waiting for the operator rather than closed as a failure.
    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_WAITING"),
      true,
      "the bound episode is still waiting for the operator"
    );
    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_CLOSED"),
      false,
      "nothing closed the episode behind a queued analysis"
    );
  });
});

test("an ordinary crash still records RUN_FAILED naming the escaping error", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const first = childSpec("tsk_first");
    const outcome = await parentRun(stateRoot, projectRoot, {
      children: [first, unwritableChildSpec(first.taskId)],
      result: (request) => taskResult(request, "PASSED")
    });

    // The negative control for the refusal above: it is keyed on the terminal
    // the log already replays, not on "a crash never fails a run".
    assert.equal(outcome.status, "FAILED");
    assert.equal(outcome.checkpoint.status, "FAILED");
    assert.deepEqual(terminals(outcome.events), ["RUN_FAILED"]);

    const reason = failureReason(outcome.events);
    assert.match(
      reason ?? "",
      /taskId must be a valid TaskId/,
      "the reason names the error that killed the loop"
    );
    assert.doesNotMatch(
      reason ?? "",
      /^run crashed: /,
      "this plane records the escaping message as-is; it does not settle through recordCrashTerminal"
    );
    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_CLOSED"),
      true,
      "a genuinely failed run still closes its episode"
    );
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
  });
});

test("a run that finished its children does not append RUN_COMPLETED over a blocked log", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await parentRun(stateRoot, projectRoot, {
      children: [childSpec("tsk_only")],
      result: (request) => taskResult(request, "PASSED"),
      blockFirst: true
    });

    // The catch-all is not the only unguarded appender the plane had: the
    // loop's own two exits recorded a terminal without looking either.
    assert.equal(outcome.status, "BLOCKED");
    assert.deepEqual(terminals(outcome.events), ["RUN_BLOCKED"]);
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
  });
});

test("a run whose child failed does not append RUN_FAILED over a blocked log", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // No TASK_RESULT: the child settles FAILURE, so the loop takes its
    // failure exit rather than its completion exit.
    const outcome = await parentRun(stateRoot, projectRoot, {
      children: [childSpec("tsk_only")],
      blockFirst: true
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.deepEqual(terminals(outcome.events), ["RUN_BLOCKED"]);
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
  });
});

test("an unblocked run still records the terminal its loop decided on", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const completed = await parentRun(stateRoot, projectRoot, {
      children: [childSpec("tsk_only")],
      result: (request) => taskResult(request, "PASSED")
    });
    assert.equal(completed.status, "COMPLETED");
    assert.deepEqual(terminals(completed.events), ["RUN_COMPLETED"]);

    const failed = await parentRun(stateRoot, projectRoot, {
      children: [childSpec("tsk_only")]
    });
    assert.equal(failed.status, "FAILED");
    assert.deepEqual(terminals(failed.events), ["RUN_FAILED"]);
    assert.match(
      failureReason(failed.events) ?? "",
      /tsk_only: /,
      "the child's own summary is still what a child failure reports"
    );
  });
});

/**
 * The shape the refusals protect, reached the way production reaches it: the
 * gate's `queue_analysis`, not a second writer. `gate-outcome.test.ts` pins this
 * for the flowchart plane; this is the same contract on the parent plane.
 */
test("a verification-failed child ends the parent run BLOCKED with the analysis queued", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await parentRun(stateRoot, projectRoot, {
      children: [childSpec("tsk_only")],
      result: (request) => taskResult(request, "FAILED")
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.equal(outcome.checkpoint.status, "BLOCKED");
    assert.deepEqual(terminals(outcome.events), ["RUN_BLOCKED"]);

    const blocked = outcome.events.find((event) => event.type === "RUN_BLOCKED");
    assert.equal(
      (blocked?.payload as { reason: string } | undefined)?.reason,
      "ANALYSIS_QUEUED",
      "the block carries the gate's reason"
    );
    assert.deepEqual(
      (blocked?.payload as { requiredEvidence: string[] } | undefined)?.requiredEvidence,
      ["evd_tsk_only"],
      "the queued analysis names the evidence the operator owes"
    );
    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_WAITING"),
      true
    );
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
  });
});

/**
 * Source pin. The parent plane must mean the same thing by "terminal" as
 * replay's anomaly rule and the flowchart loop's three recorders; a local
 * re-derivation here is how the two would start writing logs their own replay
 * flags. `gate-outcome.test.ts` pins the set itself.
 */
test("the parent plane reads the shared definition of a replayed terminal", async () => {
  const source = await readFile(new URL("../../../src/run/coordinator.ts", import.meta.url), "utf8");
  assert.match(source, /replayedTerminalStatus/, "the refusal consults replay's definition");
  assert.doesNotMatch(
    source,
    /RUN_COMPLETED"\s*,\s*"RUN_FAILED/,
    "no private terminal-event set may grow beside it"
  );
});
