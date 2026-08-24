import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import {
  createArtifactId,
  createEventId,
  createEvidenceId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId,
  type RunId,
  type TaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";
import type { Run } from "../../../src/domain/run.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { SUPERVISOR, type ChildRunLimits, type TaskResult } from "../../../src/protocol/v1.js";
import { ChildCoordinator, type ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";

/**
 * Fake clock driving the coordinator's injected `schedule`. Jobs fire only when
 * the test advances the clock, so no test here sleeps or races real timers.
 */
interface FakeClock {
  advance(ms: number): void;
  /** Timers that were scheduled, are still due in the future, and not cancelled. */
  liveTimers(): number;
  schedule(fn: () => void, ms: number): { cancel(): void };
}

function fakeClock(): FakeClock {
  let now = 0;
  let jobs: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  return {
    advance(ms: number) {
      now += ms;
      const due = jobs.filter((job) => !job.cancelled && job.at <= now).sort((a, b) => a.at - b.at);
      jobs = jobs.filter((job) => job.at > now);
      for (const job of due) job.fn();
    },
    liveTimers() {
      return jobs.filter((job) => !job.cancelled).length;
    },
    schedule(fn: () => void, ms: number) {
      const job = { at: now + ms, fn, cancelled: false };
      jobs.push(job);
      return {
        cancel() {
          job.cancelled = true;
        }
      };
    }
  };
}

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
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
    summary: outcome === "SUCCESS" ? "Parser implemented" : "golden fixture mismatch",
    artifactIds: outcome === "SUCCESS" ? [createArtifactId(UUID)] : [],
    evidenceIds: outcome === "SUCCESS" ? [createEvidenceId(UUID)] : [],
    verification: { kind: outcome === "SUCCESS" ? "PASSED" : "FAILED", evidenceIds: [] },
    ...(outcome === "FAILURE" ? { failure: { category: "MODEL_ERROR", detail: "quality" } } : {})
  };
}

async function withTempState(run: (stateRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-child-limits-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
  }
}

function childLimits(overrides: Partial<ChildRunLimits> = {}): ChildRunLimits {
  return { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000, ...overrides };
}

function makeCoordinator(
  stateRoot: string,
  executor: AgentExecutor,
  overrides: { schedule?: FakeClock["schedule"]; maxConcurrentTasks?: number } = {}
): ChildCoordinator {
  const generateId = sequenceGenerator();
  return new ChildCoordinator({
    stateRoot,
    executor,
    parentRunId: createRunId(generateId),
    project,
    registry: createAgentProfileRegistry(defaultAgentProfiles()),
    maxConcurrentTasks: overrides.maxConcurrentTasks ?? 2,
    now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    generateId,
    ...(overrides.schedule !== undefined ? { schedule: overrides.schedule } : {})
  });
}

function childInput(taskId: TaskId, limits: ChildRunLimits): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId,
    role: "implementer",
    objective: "Implement the parser",
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [{ id: "ac-1", description: "Parses empty input" }],
    limits
  };
}

async function seedParentRun(stateRoot: string, parentRunId: RunId): Promise<TaskId> {
  const taskId = createTaskId(UUID);
  const store = new EventStore(stateRoot, parentRunId);
  const now = () => parseIsoTimestamp("2026-08-12T09:00:00.000Z");
  const run: Run = {
    id: parentRunId,
    projectId,
    rootTaskId: taskId,
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
  return taskId;
}

async function eventTypes(stateRoot: string, runId: RunId): Promise<string[]> {
  const read = await new EventStore(stateRoot, runId).readAll();
  return read.events.map((event) => event.type);
}

/** Blocks inside the executor until the test releases it, then succeeds. */
class BlockingExecutor implements AgentExecutor {
  calls = 0;
  readonly entered: Promise<void>;
  private markEntered!: () => void;

  constructor(private readonly release: Promise<void>) {
    this.entered = new Promise<void>((resolve) => {
      this.markEntered = resolve;
    });
  }

  async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
    this.calls += 1;
    this.markEntered();
    await this.release;
    yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** Hangs until the attempt signal aborts, like a stuck provider stream. */
class AbortWaitExecutor implements AgentExecutor {
  calls = 0;
  readonly started: Promise<void>;
  private markStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
  }

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.calls += 1;
    yield { type: "TEXT_DELTA", text: "working" };
    this.markStarted();
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  }
}

test("a cancel while the child is queued behind the gate never invokes the executor", async () => {
  await withTempState(async (stateRoot) => {
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const executor = new BlockingExecutor(release);
    const coordinator = makeCoordinator(stateRoot, executor, { maxConcurrentTasks: 1 });
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const signal = new AbortController().signal;

    const running = coordinator.startChildTask(childInput(taskId, childLimits()), signal);
    await executor.entered; // the gate's only slot is taken
    const queued = coordinator.startChildTask(childInput(createTaskId(sequenceGenerator()), childLimits()), signal);

    queued.cancel();
    releaseFirst();
    const [first, second] = await Promise.all([running.done, queued.done]);

    assert.equal(first.outcome, "SUCCESS");
    assert.equal(second.outcome, "CANCELLED");
    assert.equal(second.attempts, 0, "a child cancelled before start ran no attempt");
    assert.equal(second.summary, "cancelled before start");
    assert.equal(executor.calls, 1, "the cancelled child never reached the executor");

    const childEvents = await eventTypes(stateRoot, queued.childRunId);
    assert.deepEqual(childEvents, ["RUN_CREATED", "RUN_STARTED", "RUN_CANCEL_REQUESTED"]);
  });
});

/** Fails the attempt without a terminal result, so the coordinator retries. */
class RetryableExecutor implements AgentExecutor {
  calls = 0;
  constructor(private readonly duringAttempt: (call: number) => void = () => undefined) {}

  async *execute(): AsyncIterable<ExecutionEvent> {
    this.calls += 1;
    yield { type: "TEXT_DELTA", text: "working" };
    this.duringAttempt(this.calls);
    yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
  }
}

test("a cancel landing in the retry window stops the next attempt", async () => {
  await withTempState(async (stateRoot) => {
    let handleCancel: () => void = () => undefined;
    const executor = new RetryableExecutor((call) => {
      if (call === 1) handleCancel();
    });
    const coordinator = makeCoordinator(stateRoot, executor);
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      childInput(taskId, childLimits({ maxAttempts: 3 })),
      new AbortController().signal
    );
    handleCancel = () => handle.cancel();
    const outcome = await handle.done;

    assert.equal(outcome.outcome, "CANCELLED");
    assert.equal(outcome.summary, "cancelled between attempts");
    assert.equal(outcome.attempts, 1);
    assert.equal(executor.calls, 1, "no attempt starts after the cancel");

    const parentEvents = await eventTypes(stateRoot, parentRunId);
    assert.ok(
      parentEvents.includes("TASK_RETRY"),
      "the retry decision was reached: only the durable cancel stopped attempt two"
    );
    const childEvents = await eventTypes(stateRoot, handle.childRunId);
    assert.equal(childEvents.at(-1), "RUN_CANCEL_REQUESTED");
  });
});

test("maxWallTimeMs below timeoutMs aborts the attempt at the wall deadline", async () => {
  await withTempState(async (stateRoot) => {
    const clock = fakeClock();
    const executor = new AbortWaitExecutor();
    const coordinator = makeCoordinator(stateRoot, executor, { schedule: clock.schedule });
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      childInput(taskId, childLimits({ maxAttempts: 3, timeoutMs: 10_000, maxWallTimeMs: 500 })),
      new AbortController().signal
    );
    await executor.started;
    clock.advance(500); // below the 10 s attempt timeout: only the wall deadline is due
    const outcome = await handle.done;

    assert.equal(outcome.outcome, "TIMEOUT");
    assert.equal(outcome.attempts, 1);
    assert.equal(executor.calls, 1);
    assert.match(outcome.summary, /wall-clock limit of 500ms exhausted after 1 attempt\(s\)/);

    const parentEvents = await eventTypes(stateRoot, parentRunId);
    assert.ok(parentEvents.includes("TASK_TIMEOUT"), "the wall deadline is recorded as a task timeout");
    assert.ok(!parentEvents.includes("TASK_RETRY"), "an exhausted wall budget never retries");
    const childRead = await new EventStore(stateRoot, handle.childRunId).readAll();
    const failed = childRead.events.find((event) => event.type === "RUN_FAILED");
    assert.equal((failed?.payload as { reason: string }).reason, outcome.summary);
    assert.equal(clock.liveTimers(), 0, "the deadline timer is cancelled when the child settles");
  });
});

test("a wall budget exhausted during attempt one stops the retry ladder at one attempt", async () => {
  await withTempState(async (stateRoot) => {
    const clock = fakeClock();
    const executor = new RetryableExecutor((call) => {
      if (call === 1) clock.advance(1_000);
    });
    const coordinator = makeCoordinator(stateRoot, executor, { schedule: clock.schedule });
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      childInput(taskId, childLimits({ maxAttempts: 3, timeoutMs: 30_000, maxWallTimeMs: 1_000 })),
      new AbortController().signal
    );
    const outcome = await handle.done;

    assert.equal(outcome.outcome, "TIMEOUT");
    assert.equal(outcome.attempts, 1, "two further attempts were budgeted but the wall limit forbade them");
    assert.equal(executor.calls, 1);
    assert.match(outcome.summary, /wall-clock limit of 1000ms/);

    const parentEvents = await eventTypes(stateRoot, parentRunId);
    assert.ok(!parentEvents.includes("TASK_RETRY"));
  });
});

test("a non-positive wall budget fails closed before any attempt", async () => {
  await withTempState(async (stateRoot) => {
    const executor = new RetryableExecutor();
    const coordinator = makeCoordinator(stateRoot, executor);
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      childInput(taskId, childLimits({ maxWallTimeMs: 0 })),
      new AbortController().signal
    );
    const outcome = await handle.done;

    assert.equal(outcome.outcome, "TIMEOUT");
    assert.equal(outcome.attempts, 0);
    assert.equal(executor.calls, 0);
    assert.match(outcome.summary, /wall-clock limit of 0ms/);
  });
});

/** Escalation-eligible failure on the first model, success on the second. */
class CascadeExecutor implements AgentExecutor {
  readonly models: string[] = [];
  constructor(private readonly duringAttempt: (call: number) => void = () => undefined) {}

  async *execute(request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
    this.models.push(request.modelId ?? "");
    const call = this.models.length;
    this.duringAttempt(call);
    if (call === 1) {
      yield { type: "MESSAGE", message: resultMessage(request, "FAILURE") };
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }
    yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

function cascadeInput(taskId: TaskId, limits: ChildRunLimits): ChildTaskInput {
  return {
    ...childInput(taskId, limits),
    assignedModel: "cheap",
    cascade: {
      highRisk: false,
      tiers: [
        { modelId: "cheap", version: "cheap-v1" },
        { modelId: "premium", version: "premium-v1" }
      ]
    }
  };
}

test("the cascade retry path respects an exhausted wall deadline", async () => {
  await withTempState(async (stateRoot) => {
    const clock = fakeClock();
    const executor = new CascadeExecutor((call) => {
      if (call === 1) clock.advance(2_000);
    });
    const coordinator = makeCoordinator(stateRoot, executor, { schedule: clock.schedule });
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      cascadeInput(taskId, childLimits({ maxAttempts: 2, timeoutMs: 30_000, maxWallTimeMs: 2_000 })),
      new AbortController().signal
    );
    const outcome = await handle.done;

    assert.deepEqual(executor.models, ["cheap"], "the escalated attempt never runs past the deadline");
    assert.equal(outcome.outcome, "TIMEOUT");
    assert.equal(outcome.attempts, 1);
    assert.match(outcome.summary, /wall-clock limit of 2000ms/);

    const read = await new EventStore(stateRoot, parentRunId).readAll();
    const retry = read.events.find((event) => event.type === "TASK_RETRY");
    assert.ok(retry, "the cascade decision itself is still recorded");
    if (retry?.type === "TASK_RETRY") {
      assert.equal(retry.payload.nextModel, "premium");
    }
  });
});

test("a generous wall budget leaves the cascade escalation untouched", async () => {
  await withTempState(async (stateRoot) => {
    const clock = fakeClock();
    const executor = new CascadeExecutor();
    const coordinator = makeCoordinator(stateRoot, executor, { schedule: clock.schedule });
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      cascadeInput(taskId, childLimits({ maxAttempts: 2, timeoutMs: 30_000, maxWallTimeMs: 3_600_000 })),
      new AbortController().signal
    );
    const outcome = await handle.done;

    assert.deepEqual(executor.models, ["cheap", "premium"]);
    assert.equal(outcome.outcome, "SUCCESS");
    assert.equal(outcome.attempts, 2);
    assert.ok(!/wall-clock/.test(outcome.summary));
    assert.equal(clock.liveTimers(), 0, "no attempt or deadline timer outlives the child run");
  });
});
