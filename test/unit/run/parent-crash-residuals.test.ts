import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import {
  createEventId,
  createMessageId,
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
import { startParentRun, type RunOutcome, type RunningRun } from "../../../src/run/coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import { validateEvent, type Event } from "../../../src/run/events.js";
import { replayRun } from "../../../src/run/replay.js";

/**
 * Loop 4 R8-7. The two residuals R7-4 flagged and declined to fix are now
 * decisions the parent plane owns, recorded in `coordinator.ts`. These pins
 * hold the *behaviour* those decisions produce, so that changing either one
 * turns a test red rather than quietly rewriting what a crashed or cancelled
 * parent run says about itself:
 *
 * 1. the refusal is terminal-keyed, so a crash over a log replaying
 *    WAITING_FOR_USER still records `RUN_FAILED` — `WAITING_FOR_USER` is not in
 *    `TERMINAL_REPLAY_STATUSES` and is not being made terminal here;
 * 2. `RUN_CANCEL_REQUESTED` is unguarded, so an operator's request lands even
 *    on a log that already replays a terminal.
 *
 * `parent-terminal-refusal.test.ts` (R7-4) owns the refusal's own pins; this
 * file only holds the edges it left open, plus the record that both decisions
 * are written down where the code makes them.
 */

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-24T09:00:00.000Z");

/** Deterministic ids, one stream per run — see the note in R7-4's file. */
function sequenceGenerator(stream: number): () => string {
  let n = 0;
  return () => `${String(stream).padStart(8, "0")}-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

let nextStream = 900;

async function withRoots(body: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parent-residual-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parent-residual-proj-"));
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
 * A child whose task id never passes event validation, so its first append
 * rejects and the throw escapes into the parent's catch-all. R7-4's file
 * reaches the same crash the same way; the trigger is one of the loop's honest
 * ones rather than an invented failure.
 */
function unwritableChildSpec(dependsOn: TaskId): ChildTaskInput {
  return { ...childSpec("tsk_crash"), taskId: "not-a-task-id" as TaskId, dependsOn: [dependsOn] };
}

function taskResult(request: AgentExecutionRequest, verification: "PASSED" | "FAILED"): ExecutionEvent {
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
 * Puts a `RUN_WAITING_FOR_USER` on a live parent run's log from a second
 * writer, which is the shape the residual is about.
 *
 * It is a stand-in for the real producer in the same way R7-4's `blockRunLog`
 * is: `ChildCoordinator` appends this exact event to the parent's log through
 * its own `EventStore` when a child asks a question, but on that path the
 * parent loop sets `waiting` and breaks out before it can reach a terminal
 * recorder. A wait that is still on the log when the loop dies therefore
 * belongs to another writer, and the recorder is keyed on what the log says
 * rather than on who wrote it.
 */
async function waitRunLog(stateRoot: string, runId: RunId, messageId: MessageId): Promise<void> {
  const store = new EventStore(stateRoot, runId);
  await store.append(
    validateEvent({
      id: createEventId(() => "ffffffff-0000-4000-8000-000000000101"),
      schemaVersion: 1,
      occurredAt: TS,
      runId,
      type: "RUN_WAITING_FOR_USER",
      actor: "supervisor",
      payload: { messageId }
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

function startRunUnder(
  stateRoot: string,
  projectRoot: string,
  options: {
    readonly children: readonly ChildTaskInput[];
    readonly result?: (request: AgentExecutionRequest) => ExecutionEvent;
    readonly beforeFirst?: (runId: RunId) => Promise<void>;
  }
): RunningRun {
  let runId: RunId | undefined;
  const executor = executorFor({
    ...(options.result !== undefined ? { result: options.result } : {}),
    ...(options.beforeFirst !== undefined
      ? { beforeFirst: async () => options.beforeFirst?.(runId as RunId) }
      : {})
  });
  const running = startParentRun(
    { stateRoot, executor, now: () => TS, generateId: sequenceGenerator(nextStream++) },
    { projectRoot, objective: "parent crash residuals", children: [...options.children] }
  );
  runId = running.runId;
  return running;
}

/** Reads the run's log until `type` appears, or gives up loudly. */
async function awaitEvent(
  stateRoot: string,
  runId: RunId,
  type: Event["type"],
  timeoutMs = 5_000
): Promise<readonly Event[]> {
  const store = new EventStore(stateRoot, runId);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { events } = await store.readAll();
    if (events.some((event) => event.type === type)) return events;
    if (Date.now() >= deadline) {
      assert.fail(`${type} never reached the log within ${timeoutMs}ms`);
    }
    await delay(10);
  }
}

/**
 * Decision 1, as behaviour. The refusal asks what terminal the log replays, not
 * whether the log is still in flight, so the wait does not stop the crash from
 * being recorded. Changing that — by widening the refusal, or by moving
 * WAITING_FOR_USER into `TERMINAL_REPLAY_STATUSES` — turns this red.
 */
test("a crash over a log replaying WAITING_FOR_USER still records RUN_FAILED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const first = childSpec("tsk_first");
    const messageId = createMessageId(() => "ffffffff-0000-4000-8000-000000000102");
    const running = startRunUnder(stateRoot, projectRoot, {
      children: [first, unwritableChildSpec(first.taskId)],
      result: (request) => taskResult(request, "PASSED"),
      beforeFirst: (runId) => waitRunLog(stateRoot, runId, messageId)
    });
    const outcome: RunOutcome = await running.done;

    const waitIndex = outcome.events.findIndex((event) => event.type === "RUN_WAITING_FOR_USER");
    const failIndex = outcome.events.findIndex((event) => event.type === "RUN_FAILED");
    assert.notEqual(waitIndex, -1, "the wait really was on the log before the loop died");
    assert.notEqual(failIndex, -1, "the crash terminal was recorded over it");
    assert.ok(waitIndex < failIndex, "and it was recorded after the wait, not before");

    assert.equal(outcome.status, "FAILED", "a waiting log does not withhold this plane's crash terminal");
    assert.equal(outcome.checkpoint.status, "FAILED");
    assert.deepEqual(terminals(outcome.events), ["RUN_FAILED"]);
    assert.match(
      failureReason(outcome.events) ?? "",
      /taskId must be a valid TaskId/,
      "the reason still names the error that killed the loop"
    );

    // The cost the decision accepts, pinned so it stays a decision: the wait is
    // buried, silently — replay reports the terminal first and flags nothing.
    assert.equal(replayRun(outcome.events).status, "FAILED");
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_CLOSED"),
      true,
      "the episode closes as a failure rather than staying open on the wait"
    );
  });
});

/**
 * Decision 2, as behaviour. A cancel request is an operator fact, so it is
 * appended whatever the log already says — and it claims no status of its own:
 * the run still replays BLOCKED, with replay naming the ordering rather than
 * the writer suppressing it. Guarding `RUN_CANCEL_REQUESTED` on this plane
 * turns this red.
 */
test("a cancel request still lands on a log that already replays a terminal", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const running = startRunUnder(stateRoot, projectRoot, {
      children: [childSpec("tsk_only")],
      result: (request) => taskResult(request, "FAILED")
    });
    const outcome = await running.done;

    // The gate's own block, reached the way production reaches it.
    assert.equal(outcome.status, "BLOCKED");
    assert.deepEqual(terminals(outcome.events), ["RUN_BLOCKED"]);
    assert.equal(
      outcome.events.some((event) => event.type === "RUN_CANCEL_REQUESTED"),
      false,
      "nothing has been cancelled yet"
    );

    // Out of band, which is the abort listener's own shape: `writeCancel` is
    // voided from the listener rather than awaited by the loop.
    running.cancel();
    const events = await awaitEvent(stateRoot, running.runId, "RUN_CANCEL_REQUESTED");

    const replayed = replayRun(events);
    assert.equal(replayed.status, "BLOCKED", "the request records a fact; it does not claim a status");
    assert.deepEqual(
      replayed.anomalies,
      ["RUN_CANCEL_REQUESTED after a terminal event"],
      "replay names the ordering, which is why the writer does not have to hide it"
    );
    assert.deepEqual(terminals(events), ["RUN_BLOCKED"], "and no terminal was invented for it");
  });
});

const COORDINATOR = new URL("../../../src/run/coordinator.ts", import.meta.url);

/** Comment prose, insensitive to how the block happens to be wrapped. */
function prose(source: string): string {
  return source.replace(/^\s*\*/gm, "").replace(/\s+/g, " ");
}

/** Just `runParentRun`'s body — `startRun` is the M0 plane and has no recorder. */
function parentRunBody(source: string): string {
  const start = source.indexOf("async function runParentRun");
  const end = source.indexOf("function toModelRoutedPayload");
  assert.ok(start !== -1 && end > start, "runParentRun must still be findable in coordinator.ts");
  return source.slice(start, end);
}

test("both parent-plane crash decisions are recorded where the code makes them", async () => {
  const source = prose(await readFile(COORDINATOR, "utf8"));

  assert.match(
    source,
    /a crash over a log replaying WAITING_FOR_USER still records `RUN_FAILED`/,
    "the terminal-keyed refusal must keep saying what it does to a waiting log"
  );
  assert.match(
    source,
    /a cancel request is an operator fact, not a status claim/,
    "the unguarded cancel must keep saying why it is unguarded"
  );
  assert.doesNotMatch(
    source,
    /RUN_CRASHED/,
    "the refused-crash reason still gets no marker event of its own (R4-4)"
  );
});

/**
 * The routing obligation R7-4 handed forward, made mechanical: a fourth
 * terminal append in `runParentRun` must go through `recordTerminal` rather
 * than straight to `make`. Review is still what catches a smarter bypass; this
 * catches the ordinary one.
 */
test("a terminal append in the parent loop cannot skip the recorder", async () => {
  const body = parentRunBody(await readFile(COORDINATOR, "utf8"));
  assert.match(body, /recordTerminal\(/, "the recorder is still the loop's terminal path");
  assert.doesNotMatch(
    body,
    /make\(\s*"RUN_(?:COMPLETED|FAILED)"/,
    "route a new terminal through recordTerminal; only it may name a terminal event here"
  );
});
