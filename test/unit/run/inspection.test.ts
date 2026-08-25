// INSPECT_SUMMARY is a frozen additive contract, like the doctor --json report.
// `inspect --run --summary-json` prints exactly one object whose enumerable keys
// are { type, runId, status, requiredEvidence }: no event `id`, a `type` that
// stays outside the domain `Event` union, and `--json` untouched as a pure event
// NDJSON stream. Existing keys never change name, type, or meaning and are never
// removed. A new key may only arrive in a diff that also updates
// SUMMARY_CONTRACT_KEYS and the exact-shape pins below, so internal inspection
// state cannot leak into the machine-readable surface by accident.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
import { EVENT_TYPES, validateEvent, type Event } from "../../../src/run/events.js";
import { applyTrackingGate } from "../../../src/run/gate-apply.js";
import { gateBlockCause, inspectRun } from "../../../src/run/inspection.js";
import { hashAssessment, parseTrackingAssessment } from "../../../src/tracking/types.js";
import { makeEvent } from "../../helpers/event-factory.js";
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

// `gateBlockCause` pairs a block with the transition that filed it, and the
// only join available on the log is position: `gate-apply.ts` appends
// GATE_TRANSITION and then RUN_BLOCKED with nothing in between. The cases below
// build that pair with the real producer and then break the adjacency with rows
// that are each individually valid, because a scan that looks past one event
// cannot tell the pair the gate wrote from a pair that merely happened.

const GATE_RUN_ID = "run_01234567-89ab-cdef-0123-456789abcdef" as RunId;
const GATE_TURN = "tsk_migrate";

function gateEventIds(): () => ReturnType<typeof createEventId> {
  let n = 0;
  return () => createEventId(() => `gate${++n}`);
}

function blockingAssessment(turnId: string = GATE_TURN) {
  return parseTrackingAssessment({
    schemaVersion: 1,
    episodeId: "ep_gate",
    runId: GATE_RUN_ID,
    turnId,
    prescore: 0.2,
    quality: 0.4,
    coverage: 0.5,
    human: { kind: "unobserved" },
    score: 0.2,
    dimensions: [{ id: "check-coverage", verdict: "FAIL", evidenceRefs: ["evd_suite"] }],
    gate: {
      kind: "hard",
      codes: ["unmet-acceptance-criterion"],
      wakeAnalysis: true,
      expandDetail: true,
      askUser: false,
      openMinors: []
    },
    evidenceRefs: ["evd_suite"]
  });
}

/** The three rows one `applyTrackingGate` writes: assessment, transition, block. */
function producedBlock(
  generateEventId: () => ReturnType<typeof createEventId> = gateEventIds()
): readonly Event[] {
  const assessment = blockingAssessment();
  const { events } = applyTrackingGate({
    events: [],
    assessment,
    assessmentHash: hashAssessment(assessment),
    expectedSeq: 0,
    policyVersion: "track-v1",
    nowIso: "2026-08-12T09:00:00.000Z",
    generateEventId
  });
  return events;
}

function childCriterionResult(kind: "FAILED" | "PASSED"): Event {
  return validateEvent(
    makeEvent(
      "CHILD_MESSAGE",
      {
        message: {
          protocolVersion: 1,
          id: createMessageId(UUID),
          occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
          runId: GATE_RUN_ID,
          taskId: GATE_TURN,
          from: "agt_01234567-89ab-cdef-0123-456789abcdef",
          to: SUPERVISOR,
          type: "TASK_RESULT",
          outcome: "SUCCESS",
          summary: "the child reported on the criterion it was given",
          artifactIds: [],
          evidenceIds: ["evd_suite"],
          verification: {
            kind: "PASSED",
            evidenceIds: ["evd_suite"],
            criteria: [{ id: "ac_no_regression", kind, evidenceIds: ["evd_suite"] }]
          }
        }
      },
      { runId: GATE_RUN_ID }
    )
  );
}

test("gateBlockCause reads the cause off the adjacent transition the gate wrote", () => {
  const events = producedBlock();
  assert.deepEqual(
    events.map((event) => event.type),
    ["TRACKING_ASSESSMENT", "GATE_TRANSITION", "RUN_BLOCKED"],
    "the producer's own pairing: the transition is the row immediately before the block"
  );

  const cause = gateBlockCause(events);
  assert.equal(cause?.reasonCode, "unmet-acceptance-criterion");
  assert.equal(cause?.turnId, GATE_TURN);
  assert.equal(cause?.gateKind, "hard");
  assert.deepEqual(cause?.failedDimensions, ["check-coverage"]);
});

test("gateBlockCause reads no cause when a PAUSE_REQUESTED separates the transition from the block", () => {
  const produced = producedBlock();
  const pause = validateEvent(
    makeEvent(
      "PAUSE_REQUESTED",
      { reason: "operator paused between the two rows" },
      { id: createEventId(() => "pause1"), runId: GATE_RUN_ID }
    )
  );
  const separated = [...produced.slice(0, 2), pause, produced[2]!];

  // Each row is one the validator accepts on its own; only the pairing is wrong,
  // which is exactly the log a backward scan cannot tell from the real one.
  for (const event of separated) validateEvent(event);

  assert.equal(
    gateBlockCause(separated),
    undefined,
    "a transition that is not events[blockedIndex - 1] did not file this block"
  );
});

test("gateBlockCause does not leak a prior block/unblock cycle onto a later unmatched block", () => {
  const first = producedBlock();
  const firstBlock = first[2]!;
  assert.ok(gateBlockCause(first) !== undefined, "the first cycle does have a cause of its own");

  const unblocked = validateEvent(
    makeEvent(
      "RUN_UNBLOCKED",
      { blockedEventId: firstBlock.id, reason: "the operator cleared the first block" },
      { id: createEventId(() => "unblock1"), runId: GATE_RUN_ID }
    )
  );
  const laterBlock = validateEvent(
    makeEvent(
      "RUN_BLOCKED",
      { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_later"] },
      { id: createEventId(() => "block2"), runId: GATE_RUN_ID }
    )
  );

  assert.equal(
    gateBlockCause([...first, unblocked, laterBlock]),
    undefined,
    "the newest block has no transition before it, and the cleared cycle's transition is not its cause"
  );
});

test("gateBlockCause reads no cause for a block with no preceding event at all", () => {
  const lone = validateEvent(
    makeEvent(
      "RUN_BLOCKED",
      { reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_suite"] },
      { id: createEventId(() => "block0"), runId: GATE_RUN_ID }
    )
  );
  assert.equal(gateBlockCause([lone]), undefined);
});

test("gateBlockCause names only the criteria reported at or before the block", () => {
  const produced = producedBlock();
  const before = [produced[0]!, childCriterionResult("FAILED"), ...produced.slice(1)];
  assert.deepEqual(
    gateBlockCause(before)?.unmetCriteria.map((criterion) => criterion.id),
    ["ac_no_regression"],
    "a verdict the child gave before the gate ruled is evidence the block can name"
  );

  assert.deepEqual(
    gateBlockCause([...produced, childCriterionResult("FAILED")])?.unmetCriteria,
    [],
    "a result appended after the block belongs to later work and cannot decorate it"
  );
});
