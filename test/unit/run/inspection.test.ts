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
import { EVENT_TYPES, validateEvent } from "../../../src/run/events.js";
import { inspectRun } from "../../../src/run/inspection.js";
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
