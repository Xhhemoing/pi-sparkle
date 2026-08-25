// INSPECT_SUMMARY is a frozen additive contract, like the doctor --json report.
// `inspect --run --summary-json` prints exactly one object whose enumerable keys
// are { type, runId, status, requiredEvidence }: no event `id`, a `type` that
// stays outside the domain `Event` union, and `--json` untouched as a pure event
// NDJSON stream. Existing keys never change name, type, or meaning and are never
// removed. A new key may only arrive in a diff that also updates
// SUMMARY_CONTRACT_KEYS and the exact-shape pins below, so internal inspection
// state cannot leak into the machine-readable surface by accident.
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import {
  createEventId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId,
  type RunId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";
import type { Run } from "../../../src/domain/run.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { SUPERVISOR, validateAgentMessage, type TaskResult } from "../../../src/protocol/v1.js";
import { ChildCoordinator, type ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import { EVENT_TYPES, validateEvent } from "../../../src/run/events.js";
import {
  followRunEvents,
  inspectRun,
  isFollowStopStatus,
  FOLLOW_STOP_STATUSES,
  type Event
} from "../../../src/run/inspection.js";
import { main, type CliIo } from "../../../src/cli/main.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

/**
 * The frozen enumerable keys of one `--summary-json` object, in print order.
 * Order is not a consumer contract, but pinning it the way doctor's
 * CONTRACT_KEYS does keeps a reshuffle a deliberate edit rather than a drift.
 */
const SUMMARY_CONTRACT_KEYS = ["type", "runId", "status", "requiredEvidence"];

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function resultMessage(
  request: AgentExecutionRequest,
  outcome: "SUCCESS" | "FAILURE"
): TaskResult {
  return {
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId: request.runId,
    taskId: request.taskId,
    from: request.agentInstanceId,
    to: SUPERVISOR,
    type: "TASK_RESULT",
    outcome,
    summary: outcome === "SUCCESS" ? "Task done" : "Task failed",
    artifactIds: outcome === "SUCCESS" ? [`art_${request.taskId}` as never] : [],
    evidenceIds: outcome === "SUCCESS" ? [`evd_${request.taskId}` as never] : [],
    verification: { kind: outcome === "SUCCESS" ? "PASSED" : "FAILED", evidenceIds: [] },
    ...(outcome === "FAILURE" ? { failure: { category: "TOOL_ERROR", detail: "boom" } } : {})
  };
}

class SuccessChildExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

const projectId = createProjectId(UUID);
const project: ProjectSnapshot = {
  id: projectId,
  rootPath: "/tmp/demo",
  discoveredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
  instructionFiles: [],
  manifests: [],
  commands: [],
  facts: []
};

async function withTempState(run: (stateRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m1-inspect-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function childInput(taskId: ReturnType<typeof createTaskId>): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId,
    role: "implementer",
    objective: "Implement the parser",
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
    limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

async function seedParentRun(
  stateRoot: string,
  parentRunId: RunId,
  terminal: "COMPLETED" | "RUNNING" = "COMPLETED"
): Promise<void> {
  const store = new EventStore(stateRoot, parentRunId);
  const now = () => parseIsoTimestamp("2026-08-12T09:00:00.000Z");
  const run: Run = {
    id: parentRunId,
    projectId,
    rootTaskId: createTaskId(UUID),
    status: "RUNNING",
    limits: defaultRunLimits(),
    createdAt: now(),
    updatedAt: now()
  };
  await store.append({
    id: createEventId(UUID),
    schemaVersion: 1,
    occurredAt: now(),
    runId: parentRunId,
    type: "RUN_CREATED",
    actor: "test",
    payload: { run }
  });
  await store.append({
    id: createEventId(UUID),
    schemaVersion: 1,
    occurredAt: now(),
    runId: parentRunId,
    type: "RUN_STARTED",
    actor: "test",
    payload: {}
  });
  if (terminal === "COMPLETED") {
    await store.append({
      id: createEventId(UUID),
      schemaVersion: 1,
      occurredAt: now(),
      runId: parentRunId,
      type: "RUN_COMPLETED",
      actor: "test",
      payload: {}
    });
  }
}

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text: string) => {
        out.push(text);
      },
      stderr: (text: string) => {
        err.push(text);
      }
    },
    out,
    err
  };
}

/** Seeds a run that stalls twice and then blocks, so only the newest demand stands. */
async function seedStalledRun(stateRoot: string, runId: RunId, seq: () => string): Promise<void> {
  await seedParentRun(stateRoot, runId, "RUNNING");
  const store = new EventStore(stateRoot, runId);
  const now = () => parseIsoTimestamp("2026-08-12T09:00:00.000Z");
  const base = { schemaVersion: 1 as const, occurredAt: now(), runId, actor: "supervisor" };
  await store.append({
    ...base,
    id: createEventId(seq),
    type: "STALL_DETECTED",
    payload: { round: 1, consecutiveStalls: 1, requiredEvidence: ["stale: first round proof"] }
  });
  await store.append({
    ...base,
    id: createEventId(seq),
    type: "STALL_DETECTED",
    payload: {
      round: 2,
      consecutiveStalls: 2,
      requiredEvidence: ["failing test output", "parser benchmark"]
    }
  });
  await store.append({
    ...base,
    id: createEventId(seq),
    type: "RUN_BLOCKED",
    payload: {
      reason: "no progress for too many rounds",
      requiredEvidence: ["failing test output", "parser benchmark"]
    }
  });
}

test("inspectRun reports children, protocol messages, results, artifacts, and evidence", async () => {
  await withTempState(async (stateRoot) => {
    const executor = new SuccessChildExecutor();
    const seq = sequenceGenerator();
    const coordinator = new ChildCoordinator({
      stateRoot,
      executor,
      parentRunId: createRunId(seq),
      project,
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      maxConcurrentTasks: 2,
      now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      generateId: seq
    });
    const parentRunId = coordinator.parentRunId;
    await seedParentRun(stateRoot, parentRunId);
    const signal = new AbortController().signal;
    const taskA = createTaskId(seq);
    const taskB = createTaskId(seq);
    const [a, b] = await Promise.all([
      coordinator.startChildTask(childInput(taskA), signal).done,
      coordinator.startChildTask(childInput(taskB), signal).done
    ]);
    assert.equal(a.outcome, "SUCCESS");
    assert.equal(b.outcome, "SUCCESS");

    const inspection = await inspectRun(stateRoot, parentRunId);
    assert.equal(inspection.status, "COMPLETED");
    assert.equal(inspection.children.length, 2, "both child runs are correlated");

    const childA = inspection.children.find((c) => c.taskId === taskA);
    assert.ok(childA, "child A attributed to its task");
    assert.equal(childA?.outcome, "SUCCESS");
    assert.equal(childA?.attempts, 1);
    const messages = childA?.messages ?? [];
    assert.ok(messages.some((m) => m.type === "TASK_REQUEST"));
    assert.ok(messages.some((m) => m.type === "TASK_RESULT"));
    const terminal = messages.find((m) => m.type === "TASK_RESULT") as TaskResult | undefined;
    assert.equal(terminal?.outcome, "SUCCESS");
    assert.ok((terminal?.artifactIds.length ?? 0) >= 1, "artifact references survive inspection");
    assert.ok((terminal?.evidenceIds.length ?? 0) >= 1, "evidence references survive inspection");
  });
});

test("inspectRun surfaces pending questions and supplied answers", async () => {
  await withTempState(async (stateRoot) => {
    let resolveAnswer!: (text: string) => void;
    const answerPromise = new Promise<string>((resolve) => {
      resolveAnswer = resolve;
    });
    const questioning: AgentExecutor = {
      async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
        yield {
          type: "MESSAGE",
          message: validateAgentMessage({
            protocolVersion: 1,
            id: createMessageId(UUID),
            occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
            runId: request.runId,
            taskId: request.taskId,
            from: request.agentInstanceId,
            to: SUPERVISOR,
            type: "QUESTION",
            question: "Proceed?",
            options: ["Yes", "No"]
          })
        };
        await answerPromise;
        if (signal.aborted) {
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
          return;
        }
        yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    };
    const seq = sequenceGenerator();
    const coordinator = new ChildCoordinator({
      stateRoot,
      executor: questioning,
      parentRunId: createRunId(seq),
      project,
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      maxConcurrentTasks: 1,
      now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      generateId: seq
    });
    const parentRunId = coordinator.parentRunId;
    await seedParentRun(stateRoot, parentRunId, "RUNNING");
    const taskId = createTaskId(seq);
    const handle = coordinator.startChildTask(childInput(taskId), new AbortController().signal);

    let paused = await inspectRun(stateRoot, parentRunId);
    for (
      let i = 0;
      i < 100 && (paused.pendingQuestions.length === 0 || paused.status !== "WAITING_FOR_USER");
      i += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      paused = await inspectRun(stateRoot, parentRunId);
    }
    assert.equal(paused.status, "WAITING_FOR_USER");
    assert.equal(paused.pendingQuestions.length, 1);
    const questionId = paused.pendingQuestions[0]!.id;
    assert.match(questionId, /^msg_/);

    await coordinator.answerQuestion(questionId, "Yes");
    resolveAnswer("Yes");
    const outcome = await handle.done;
    assert.equal(outcome.outcome, "SUCCESS");

    // The parent coordinator settles the parent run once children settle.
    const store = new EventStore(stateRoot, parentRunId);
    await store.append({
      id: createEventId(UUID),
      schemaVersion: 1,
      occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      runId: parentRunId,
      type: "RUN_COMPLETED",
      actor: "test",
      payload: {}
    });

    const resumed = await inspectRun(stateRoot, parentRunId);
    assert.equal(resumed.status, "COMPLETED");
    assert.equal(resumed.pendingQuestions.length, 0);
    assert.equal(resumed.answers.length, 1);
    assert.equal(resumed.answers[0]!.messageId, questionId);
    assert.equal(resumed.answers[0]!.answer, "Yes");
  });
});

test("inspectRun reports no requiredEvidence for a run that never stalled or blocked", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId);

    const inspection = await inspectRun(stateRoot, runId);
    assert.equal(inspection.status, "COMPLETED");
    assert.deepEqual(
      inspection.requiredEvidence,
      [],
      "no stall or block event means no evidence demand is invented"
    );
  });
});

test("inspectRun surfaces the latest stall/block requiredEvidence verbatim", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedStalledRun(stateRoot, runId, seq);

    const inspection = await inspectRun(stateRoot, runId);
    assert.equal(inspection.status, "BLOCKED");
    assert.deepEqual(inspection.requiredEvidence, ["failing test output", "parser benchmark"]);
    assert.ok(
      !inspection.requiredEvidence.includes("stale: first round proof"),
      "superseded stall demands are not merged into the latest one"
    );
  });
});

test("inspectRun keeps requiredEvidence from a stall that has not blocked the run yet", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");
    const store = new EventStore(stateRoot, runId);
    await store.append({
      id: createEventId(seq),
      schemaVersion: 1,
      occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      runId,
      type: "STALL_DETECTED",
      actor: "supervisor",
      payload: { round: 3, consecutiveStalls: 1, requiredEvidence: ["repro log"] }
    });

    const inspection = await inspectRun(stateRoot, runId);
    assert.notEqual(inspection.status, "BLOCKED");
    assert.deepEqual(inspection.requiredEvidence, ["repro log"]);
  });
});

test("inspect prose prints the required evidence of the latest stall/block", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedStalledRun(stateRoot, runId, seq);

    const human = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot], human.io);
    assert.equal(code, 0, human.err.join(""));
    const text = human.out.join("");
    assert.match(text, /BLOCKED/);
    assert.match(text, /required evidence \(2\):/);
    assert.match(text, /- failing test output/);
    assert.match(text, /- parser benchmark/);
  });
});

test("inspect prose omits the required evidence block when nothing stalled", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId);

    const human = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot], human.io);
    assert.equal(code, 0, human.err.join(""));
    assert.doesNotMatch(human.out.join(""), /required evidence/);
  });
});

// Contract: `inspect --run --json` stays a pure NDJSON stream of domain events.
// The aggregated evidence view is opt-in via `--summary-json`, so existing
// --json consumers keep working; nothing is appended to this stream.
test("inspect --json stays a pure event stream with no summary line", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedStalledRun(stateRoot, runId, seq);

    const json = capture();
    const code = await main(["inspect", "--run", runId, "--state-root", stateRoot, "--json"], json.io);
    assert.equal(code, 0, json.err.join(""));
    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 5, "one line per persisted event, nothing appended");
    const parsed = lines.map((line) => JSON.parse(line) as { id?: unknown; type?: unknown });
    for (const event of parsed) {
      assert.ok(typeof event.id === "string" && event.id !== "");
      assert.ok(typeof event.type === "string" && event.type !== "");
    }
    assert.ok(!parsed.some((event) => event.type === "INSPECT_SUMMARY"));
    assert.deepEqual(parsed.map((event) => event.type), [
      "RUN_CREATED",
      "RUN_STARTED",
      "STALL_DETECTED",
      "STALL_DETECTED",
      "RUN_BLOCKED"
    ]);
  });
});

test("inspect --summary-json prints exactly the frozen INSPECT_SUMMARY keys, no more", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedStalledRun(stateRoot, runId, seq);

    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 1);
    const summary = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(summary),
      SUMMARY_CONTRACT_KEYS,
      "frozen additive: an extra enumerable key is a new public field, not an implementation detail"
    );
    assert.ok(!("id" in summary), "the summary is not a domain Event");
    // deepStrictEqual rejects an extra key as well as a changed one: this is the
    // freeze, not a spot check of the four values.
    assert.deepEqual(summary, {
      type: "INSPECT_SUMMARY",
      runId,
      status: "BLOCKED",
      requiredEvidence: ["failing test output", "parser benchmark"]
    });
  });
});

test("inspect --summary-json reports an empty requiredEvidence list for a clean run", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId);

    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    const summary = JSON.parse(json.out.join("").trim()) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(summary),
      SUMMARY_CONTRACT_KEYS,
      "the frozen key set does not vary with run state"
    );
    assert.deepEqual(summary, {
      type: "INSPECT_SUMMARY",
      runId,
      status: "COMPLETED",
      requiredEvidence: []
    });
  });
});

test("INSPECT_SUMMARY is outside the Event union and no log can carry it", () => {
  assert.ok(
    !(EVENT_TYPES as readonly string[]).includes("INSPECT_SUMMARY"),
    "the summary is a CLI view, not a domain event: adding it to the vocabulary would make it replayable"
  );
  assert.throws(
    () =>
      validateEvent({
        id: createEventId(UUID),
        schemaVersion: 1,
        occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        runId: "run_01234567-89ab-cdef-0123-456789abcdef",
        type: "INSPECT_SUMMARY",
        actor: "test",
        payload: { status: "BLOCKED", requiredEvidence: [] }
      }),
    /type must be a known event type/,
    "an otherwise well-formed row typed INSPECT_SUMMARY is refused by the event validator"
  );
});

test("inspect rejects --json together with --summary-json", async () => {
  const { io, err, out } = capture();
  const code = await main(
    [
      "inspect",
      "--run",
      "run_01234567-89ab-cdef-0123-456789abcdef",
      "--state-root",
      "/tmp/pi-sparkle-nonexistent",
      "--json",
      "--summary-json"
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /either --json or --summary-json/);
  assert.deepEqual(out, []);
});

test("inspect --summary-json is refused for --episode", async () => {
  const { io, err } = capture();
  const code = await main(
    [
      "inspect",
      "--episode",
      "ep_01234567-89ab-cdef-0123-456789abcdef",
      "--state-root",
      "/tmp/pi-sparkle-nonexistent",
      "--summary-json"
    ],
    io
  );
  assert.equal(code, 1);
  assert.match(err.join(""), /only available with --run/);
});

test("rich child inspection state cannot add a fifth INSPECT_SUMMARY key", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const coordinator = new ChildCoordinator({
      stateRoot,
      executor: new SuccessChildExecutor(),
      parentRunId: createRunId(seq),
      project,
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      maxConcurrentTasks: 1,
      now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
      generateId: seq
    });
    const runId = coordinator.parentRunId;
    await seedParentRun(stateRoot, runId);
    const outcome = await coordinator.startChildTask(
      childInput(createTaskId(seq)),
      new AbortController().signal
    ).done;
    assert.equal(outcome.outcome, "SUCCESS");

    const richInspection = await inspectRun(stateRoot, runId);
    assert.equal(richInspection.children.length, 1, "the fixture must carry summary-adjacent child state");
    assert.ok(richInspection.children[0]?.terminalResult, "the terminal result is available to inspection");

    const json = capture();
    const code = await main(
      ["inspect", "--run", runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    const summary = JSON.parse(json.out.join("").trim()) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(summary),
      SUMMARY_CONTRACT_KEYS,
      "children, terminal results, and verification detail remain internal inspection state"
    );
    assert.deepEqual(summary, {
      type: "INSPECT_SUMMARY",
      runId,
      status: "COMPLETED",
      requiredEvidence: []
    });
  });
});

// --- inspect --follow: a read-only tail of one run's event log --------------
//
// The properties worth holding: it emits every event exactly once and in log
// order, it stops on the six statuses nothing else moves off without an
// operator, it never appends or locks, and a log that shrinks under it is
// reported rather than followed into silence.

/** Zero-delay sleep so the poll loop runs at test speed, not wall-clock speed. */
const IMMEDIATE = { intervalMs: 0, sleep: async () => undefined };

async function appendEvent(
  stateRoot: string,
  runId: RunId,
  seq: () => string,
  event: Pick<Event, "type" | "payload">
): Promise<void> {
  await new EventStore(stateRoot, runId).append({
    id: createEventId(seq),
    schemaVersion: 1,
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId,
    actor: "test",
    ...event
  } as Event);
}

test("follow replays an already-terminal log once and stops on its status", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "COMPLETED");

    const seen: Event[] = [];
    const result = await followRunEvents(stateRoot, runId, (events) => seen.push(...events), IMMEDIATE);

    assert.equal(result.stopReason, "status");
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.emitted, 3);
    assert.deepEqual(
      seen.map((event) => event.type),
      ["RUN_CREATED", "RUN_STARTED", "RUN_COMPLETED"],
      "the existing log is replayed in order before follow returns"
    );
  });
});

test("follow emits events appended after it started, exactly once each", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");

    // The appends happen between polls, which is what a live run does.
    let round = 0;
    const seen: Event[] = [];
    const result = await followRunEvents(stateRoot, runId, (events) => seen.push(...events), {
      intervalMs: 0,
      sleep: async () => {
        round += 1;
        if (round === 1) {
          await appendEvent(stateRoot, runId, seq, {
            type: "STALL_DETECTED",
            payload: { round: 1, consecutiveStalls: 1, requiredEvidence: ["proof"] }
          });
        } else if (round === 2) {
          await appendEvent(stateRoot, runId, seq, { type: "RUN_COMPLETED", payload: {} });
        }
      }
    });

    assert.equal(result.stopReason, "status");
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(seen.map((event) => event.type), [
      "RUN_CREATED",
      "RUN_STARTED",
      "STALL_DETECTED",
      "RUN_COMPLETED"
    ]);
    // Re-reading the whole file each poll is only safe because the slice never
    // re-emits: four appends, four callbacks' worth of events, no repeats.
    assert.equal(seen.length, 4);
    assert.equal(result.emitted, seen.length);
  });
});

test("follow stops on the stopped-but-not-terminal statuses an operator must clear", async () => {
  const cases = [
    {
      status: "WAITING_FOR_USER",
      event: {
        type: "RUN_WAITING_FOR_USER" as const,
        payload: { messageId: createMessageId(() => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") }
      }
    },
    { status: "PAUSED", event: { type: "PAUSE_REQUESTED" as const, payload: { reason: "operator" } } },
    { status: "CANCELLED", event: { type: "RUN_CANCEL_REQUESTED" as const, payload: {} } }
  ];
  for (const testCase of cases) {
    await withTempState(async (stateRoot) => {
      const seq = sequenceGenerator();
      const runId = createRunId(seq);
      await seedParentRun(stateRoot, runId, "RUNNING");
      await appendEvent(stateRoot, runId, seq, testCase.event);

      const result = await followRunEvents(stateRoot, runId, () => undefined, IMMEDIATE);
      assert.equal(result.status, testCase.status, `follow must stop on ${testCase.status}`);
      assert.equal(result.stopReason, "status");
    });
  }
});

test("follow keeps polling a RUNNING log and takes no lock while it does", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");

    const controller = new AbortController();
    let polls = 0;
    const result = await followRunEvents(stateRoot, runId, () => undefined, {
      intervalMs: 0,
      signal: controller.signal,
      sleep: async () => {
        polls += 1;
        if (polls >= 3) controller.abort();
      }
    });

    assert.equal(result.stopReason, "aborted", "RUNNING is not a stop status");
    assert.ok(polls >= 3);
    // Following is a reader: the run lock stays untaken and the log unchanged.
    await assert.rejects(
      () => stat(join(stateRoot, "runtime", "runs", `${runId}.lock`)),
      /ENOENT/,
      "follow takes no run lock"
    );
    const after = await new EventStore(stateRoot, runId).readAll();
    assert.equal(after.events.length, 2, "follow appended nothing");
  });
});

test("follow reports a log that vanished instead of waiting on it forever", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");

    const result = await followRunEvents(stateRoot, runId, () => undefined, {
      intervalMs: 0,
      sleep: async () => {
        await rm(join(stateRoot, "runtime", "runs", runId), { recursive: true, force: true });
      }
    });
    assert.equal(result.stopReason, "log-vanished");
    assert.equal(result.status, undefined);
    assert.equal(result.emitted, 2, "what it did read stays reported");
  });
});

test("follow skips a torn final line until the writer completes it", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");
    const path = join(stateRoot, "runtime", "runs", runId, "events.jsonl");
    const terminal = JSON.stringify({
      id: createEventId(seq),
      schemaVersion: 1,
      occurredAt: "2026-08-12T09:00:00.000Z",
      runId,
      actor: "test",
      type: "RUN_COMPLETED",
      payload: {}
    });
    const split = Math.floor(terminal.length / 2);

    let round = 0;
    const seen: Event[] = [];
    const result = await followRunEvents(stateRoot, runId, (events) => seen.push(...events), {
      intervalMs: 0,
      sleep: async () => {
        round += 1;
        // Round 1 writes half a line — the normal shape of a file mid-append.
        if (round === 1) await appendFile(path, terminal.slice(0, split), "utf8");
        else if (round === 2) {
          assert.equal(seen.length, 2, "a half-written event is never emitted");
          await appendFile(path, `${terminal.slice(split)}\n`, "utf8");
        }
      }
    });

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.emitted, 3);
    assert.equal(seen.at(-1)?.type, "RUN_COMPLETED");
    assert.equal(result.recovery.incompleteLine, undefined, "the completed tail is no longer partial");
  });
});

// --- --idle-timeout-ms: the opt-in bound on silence -------------------------
//
// The deadline is measured with an injected clock, so these run at test speed
// and still assert the millisecond arithmetic a real follow would do. What is
// worth holding: silence ends a follow only when a caller asked for it, an
// append restarts the clock (idle, not total), a status stop always wins over
// a deadline reached at the same moment, and a stop for silence is never
// reported as a status.

/** A clock the test moves by hand, plus a sleep that moves it by the poll gap. */
function fakeClock(): { now: () => number; advanceBy: (ms: number) => Promise<void>; elapsed: () => number } {
  let ms = 0;
  return {
    now: () => ms,
    advanceBy: async (by: number) => {
      ms += by;
    },
    elapsed: () => ms
  };
}

test("follow with no idle timeout keeps polling a silent log forever", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");

    // An hour of silence per poll, and the default still does not give up:
    // "no deadline" is the behaviour every caller had before the option.
    const clock = fakeClock();
    const controller = new AbortController();
    let polls = 0;
    const result = await followRunEvents(stateRoot, runId, () => undefined, {
      intervalMs: 0,
      now: clock.now,
      signal: controller.signal,
      sleep: async () => {
        polls += 1;
        await clock.advanceBy(3_600_000);
        if (polls >= 5) controller.abort();
      }
    });

    assert.equal(result.stopReason, "aborted", "an unbounded follow only ends when its caller ends it");
    assert.equal(result.idleMs, undefined);
    assert.equal(clock.elapsed(), 5 * 3_600_000, "five hours of silence is not a stop condition by itself");
  });
});

test("follow gives up on a log that stopped appending once an idle timeout is set", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    // The SIGKILL leftover: RUNNING for good, and nothing will ever append.
    await seedParentRun(stateRoot, runId, "RUNNING");

    const clock = fakeClock();
    const seen: Event[] = [];
    let polls = 0;
    const result = await followRunEvents(stateRoot, runId, (events) => seen.push(...events), {
      intervalMs: 100,
      idleTimeoutMs: 500,
      now: clock.now,
      sleep: async (ms) => {
        polls += 1;
        await clock.advanceBy(ms);
      }
    });

    assert.equal(result.stopReason, "idle-timeout");
    assert.equal(result.status, "RUNNING", "the status it was still in is reported, not invented");
    assert.equal(result.emitted, 2, "what was already on disk is still printed before giving up");
    assert.equal(seen.length, 2);
    assert.equal(result.idleMs, 500);
    assert.equal(polls, 5, "the deadline is checked once per poll, so it ends on the first poll at or after it");
  });
});

test("an appended event restarts the idle deadline, so the bound is on silence and not on the follow", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");

    const clock = fakeClock();
    let round = 0;
    const seen: Event[] = [];
    const result = await followRunEvents(stateRoot, runId, (events) => seen.push(...events), {
      intervalMs: 100,
      idleTimeoutMs: 250,
      now: clock.now,
      sleep: async (ms) => {
        round += 1;
        await clock.advanceBy(ms);
        // A slow but living run: one event every other poll for a while, each
        // one landing before the 250ms deadline it resets.
        if (round <= 8 && round % 2 === 0) {
          await appendEvent(stateRoot, runId, seq, {
            type: "STALL_DETECTED",
            payload: { round, consecutiveStalls: 1, requiredEvidence: ["proof"] }
          });
        }
      }
    });

    assert.equal(result.stopReason, "idle-timeout");
    assert.equal(seen.length, 6, "the four appends are followed, none of them cut short");
    // 300, not 250: the deadline is looked at once per 100ms poll, so the
    // reported silence is the real one at the poll that gave up.
    assert.equal(result.idleMs, 300, "the deadline measures the last gap, not the whole follow");
    assert.ok(
      clock.elapsed() > 250 * 4,
      `a follow far longer than the deadline is fine while events keep landing (${clock.elapsed()}ms)`
    );
  });
});

test("a status stop wins over a deadline the same poll ran past", async () => {
  await withTempState(async (stateRoot) => {
    const seq = sequenceGenerator();
    const runId = createRunId(seq);
    await seedParentRun(stateRoot, runId, "RUNNING");
    await appendEvent(stateRoot, runId, seq, { type: "RUN_COMPLETED", payload: {} });

    // An adversarial clock: every reading is a full deadline later than the
    // last, so even the gap between emitting an event and checking the
    // deadline is "idle" long enough to trip it. A completed log still stops
    // as COMPLETED, because a run that finished must never be reported as a
    // run nobody was writing to.
    let ms = 0;
    const result = await followRunEvents(stateRoot, runId, () => undefined, {
      intervalMs: 0,
      idleTimeoutMs: 10,
      now: () => (ms += 10_000),
      sleep: async () => undefined
    });

    assert.equal(result.stopReason, "status");
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.idleMs, undefined, "idleMs is set only by the stop that measured it");
  });
});

test("follow refuses an idle timeout that is not a positive whole number of milliseconds", async () => {
  await withTempState(async (stateRoot) => {
    const runId = createRunId(sequenceGenerator());
    await seedParentRun(stateRoot, runId, "RUNNING");
    // Zero has two plausible readings ("never wait" / "wait forever") and
    // fractions cannot be compared against a poll gap honestly; both are
    // refused so that "no deadline" stays spelled exactly one way.
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        () =>
          followRunEvents(stateRoot, runId, () => undefined, {
            ...IMMEDIATE,
            idleTimeoutMs: value
          }),
        /idleTimeoutMs must be a whole number of milliseconds greater than 0/,
        `idleTimeoutMs ${value} must be refused, not guessed at`
      );
    }
  });
});

test("the follow stop set is the six statuses nothing else advances", () => {
  assert.deepEqual(
    [...FOLLOW_STOP_STATUSES],
    ["COMPLETED", "FAILED", "CANCELLED", "BLOCKED", "WAITING_FOR_USER", "PAUSED"]
  );
  for (const status of FOLLOW_STOP_STATUSES) assert.ok(isFollowStopStatus(status));
  for (const status of ["PLANNING", "RUNNING"] as const) {
    assert.ok(!isFollowStopStatus(status), `${status} is progress, not a stopping point`);
  }
});
