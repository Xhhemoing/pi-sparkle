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
  type AgentInstanceId,
  type RunId,
  type TaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits } from "../../../src/domain/limits.js";
import type { ProjectSnapshot } from "../../../src/domain/project.js";
import type { Run } from "../../../src/domain/run.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import {
  SUPERVISOR,
  validateAgentMessage,
  type AgentMessage,
  type ApprovalPlan,
  type ChildRunLimits,
  type TaskRequest,
  type TaskResult
} from "../../../src/protocol/v1.js";
import {
  ChildCoordinator,
  type ChildCoordinatorDeps,
  type ChildTaskInput
} from "../../../src/run/child-coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";

interface ManualScheduler {
  now: number;
  advance(ms: number): void;
  schedule(fn: () => void, ms: number): { cancel(): void };
}

function manualScheduler(): ManualScheduler {
  let now = 0;
  const jobs: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
  return {
    now,
    advance(ms: number) {
      now += ms;
      const due = jobs
        .filter((job) => !job.cancelled && job.at <= now)
        .sort((a, b) => a.at - b.at);
      for (const job of due) {
        if (!job.cancelled) job.fn();
      }
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

/** Deterministic id generator with a counter, so repeated calls differ. */
function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function progressMessage(request: AgentExecutionRequest): AgentMessage {
  return validateAgentMessage({
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    runId: request.runId,
    taskId: request.taskId,
    from: request.agentInstanceId,
    to: SUPERVISOR,
    type: "PROGRESS",
    status: "WORKING",
    summary: "Reading the module",
    evidenceIds: []
  });
}

function resultMessage(
  request: AgentExecutionRequest,
  outcome: "SUCCESS" | "FAILURE" | "PARTIAL"
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
    summary: outcome === "SUCCESS" ? "Parser implemented" : "Parser crashed",
    artifactIds: outcome === "SUCCESS" ? [createArtifactId(UUID)] : [],
    evidenceIds: outcome === "SUCCESS" ? [createEvidenceId(UUID)] : [],
    verification: { kind: outcome === "SUCCESS" ? "PASSED" : "FAILED", evidenceIds: [] },
    ...(outcome === "FAILURE" ? { failure: { category: "TOOL_ERROR", detail: "crashed" } } : {})
  };
}

/** Executor whose steps can include protocol MESSAGE events derived from the request. */
class ScriptedChildExecutor implements AgentExecutor {
  constructor(private readonly steps: (request: AgentExecutionRequest) => ExecutionEvent[]) {}

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    for (const step of this.steps(request)) yield step;
  }
}

/** Executor that tracks the number of concurrently active runs. */
class TrackedExecutor implements AgentExecutor {
  active = 0;
  maxActive = 0;
  constructor(private readonly release: () => void) {}

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      yield { type: "TEXT_DELTA", text: "started" };
      if (signal.aborted) {
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
        return;
      }
      yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    } finally {
      this.active -= 1;
      this.release();
    }
  }
}

/** Executor that hangs on the first attempt and succeeds on later attempts. */
class FlakyExecutor implements AgentExecutor {
  private calls = 0;
  readonly started: Promise<void>;
  private resolveStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.calls += 1;
    this.resolveStarted();
    if (this.calls === 1) {
      yield { type: "TEXT_DELTA", text: "stuck" };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      if (signal.aborted) {
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      }
      return;
    }
    yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** Executor that yields a QUESTION and then waits for the answer promise. */
class QuestioningExecutor implements AgentExecutor {
  constructor(
    private readonly answer: Promise<string>,
    private readonly approvalPlan?: ApprovalPlan
  ) {}

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
        question: "Proceed with the risky refactor?",
        options: ["Yes", "No"],
        ...(this.approvalPlan !== undefined ? { approvalPlan: this.approvalPlan } : {})
      })
    };
    await this.answer;
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield { type: "MESSAGE", message: resultMessage(request, "SUCCESS") };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

async function withTempState(run: (stateRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m1-"));
  try {
    await run(stateRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
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

function childLimits(overrides: Partial<ChildRunLimits> = {}): ChildRunLimits {
  return { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000, ...overrides };
}

function makeCoordinator(
  stateRoot: string,
  executor: AgentExecutor,
  overrides: {
    now?: () => IsoTimestamp;
    schedule?: ManualScheduler["schedule"];
    maxConcurrentTasks?: number;
    generateId?: () => string;
    onQuestion?: ChildCoordinatorDeps["onQuestion"];
  } = {}
): ChildCoordinator {
  return new ChildCoordinator({
    stateRoot,
    executor,
    parentRunId: createRunId(overrides.generateId ?? UUID),
    project,
    registry: createAgentProfileRegistry(defaultAgentProfiles()),
    maxConcurrentTasks: overrides.maxConcurrentTasks ?? 2,
    now: overrides.now ?? (() => parseIsoTimestamp("2026-08-12T09:00:00.000Z")),
    generateId: overrides.generateId ?? UUID,
    ...(overrides.schedule !== undefined ? { schedule: overrides.schedule } : {}),
    ...(overrides.onQuestion !== undefined ? { onQuestion: overrides.onQuestion } : {})
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

test("a successful child persists correlated lifecycle and message events", async () => {
  await withTempState(async (stateRoot) => {
    const executor = new ScriptedChildExecutor((request) => [
      { type: "MESSAGE", message: progressMessage(request) },
      { type: "MESSAGE", message: resultMessage(request, "SUCCESS") },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    const coordinator = makeCoordinator(stateRoot, executor, { generateId: sequenceGenerator() });
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);
    const outcome = await handle.done;

    assert.equal(outcome.outcome, "SUCCESS");
    assert.equal(outcome.attempts, 1);
    assert.equal(outcome.messages.filter((m) => m.type === "PROGRESS").length, 1);
    assert.equal(outcome.messages.filter((m) => m.type === "TASK_RESULT").length, 1);
    assert.ok(outcome.childRunId.startsWith("run_"));

    const store = new EventStore(stateRoot, parentRunId);
    const read = await store.readAll();
    const types = read.events.map((e) => e.type);
    assert.ok(types.includes("CHILD_RUN_CREATED"), "parent log records the child run");
    assert.ok(types.includes("CHILD_MESSAGE"), "parent log records protocol messages");
    const messages = read.events.filter((e) => e.type === "CHILD_MESSAGE");
    assert.equal(messages.length, 3, "TASK_REQUEST + PROGRESS + TASK_RESULT");
    const first = messages[0]?.payload as { message: TaskRequest };
    assert.equal(first.message.type, "TASK_REQUEST");
  });
});

test("concurrency never exceeds the configured limit", async () => {
  await withTempState(async (stateRoot) => {
    let released = 0;
    const executor = new TrackedExecutor(() => {
      released += 1;
    });
    const coordinator = makeCoordinator(stateRoot, executor, { maxConcurrentTasks: 1 });
    const parentRunId = coordinator.parentRunId;
    await seedParentRun(stateRoot, parentRunId);
    const signal = new AbortController().signal;
    const seq = sequenceGenerator();
    const a = coordinator.startChildTask(childInput(createTaskId(seq), childLimits()), signal);
    const b = coordinator.startChildTask(childInput(createTaskId(seq), childLimits()), signal);
    const [outcomeA, outcomeB] = await Promise.all([a.done, b.done]);
    assert.equal(outcomeA.outcome, "SUCCESS");
    assert.equal(outcomeB.outcome, "SUCCESS");
    assert.equal(executor.maxActive, 1, "concurrency must never exceed the limit");
    assert.equal(released, 2);
  });
});

test("parent cancellation propagates to children and settles as CANCELLED", async () => {
  await withTempState(async (stateRoot) => {
    const controller = new AbortController();
    const seenAbort: string[] = [];
    const executor: AgentExecutor = {
      async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
        seenAbort.push(request.taskId);
        yield { type: "TEXT_DELTA", text: "working" };
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        if (signal.aborted) {
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
        }
      }
    };
    const coordinator = makeCoordinator(stateRoot, executor);
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), controller.signal);
    const pending = handle.done.then((outcome) => {
      assert.equal(outcome.outcome, "CANCELLED");
    });
    controller.abort();
    await pending;

    assert.equal(seenAbort.length, 1);
    const store = new EventStore(stateRoot, parentRunId);
    const read = await store.readAll();
    assert.ok(read.events.some((e) => e.type === "CHILD_RUN_CREATED"));
  });
});

test("timeout produces a TASK_TIMEOUT and a retry, then the child settles", async () => {
  await withTempState(async (stateRoot) => {
    const scheduler = manualScheduler();
    const flaky = new FlakyExecutor();
    const coordinator = makeCoordinator(
      stateRoot,
      flaky,
      { schedule: scheduler.schedule, generateId: sequenceGenerator() }
    );
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);

    const handle = coordinator.startChildTask(
      childInput(taskId, childLimits({ maxAttempts: 2, timeoutMs: 1_000 })),
      new AbortController().signal
    );
    const donePromise = handle.done;
    await flaky.started; // first attempt is now executing and its timer is registered
    scheduler.advance(1_000);
    const outcome = await donePromise;

    assert.equal(outcome.outcome, "SUCCESS", "retry after timeout must succeed on attempt two");
    assert.equal(outcome.attempts, 2);

    const store = new EventStore(stateRoot, parentRunId);
    const read = await store.readAll();
    const types = read.events.map((e) => e.type);
    assert.ok(types.includes("TASK_TIMEOUT"), "TASK_TIMEOUT recorded");
    assert.ok(types.includes("TASK_RETRY"), "retry decision recorded");
    const timeoutEvent = read.events.find((e) => e.type === "TASK_TIMEOUT");
    assert.equal((timeoutEvent?.payload as { attempt: number }).attempt, 1);
  });
});

test("a question pauses the child until an explicit answer is supplied", async () => {
  await withTempState(async (stateRoot) => {
    let resolveAnswer!: (text: string) => void;
    const answerPromise = new Promise<string>((resolve) => {
      resolveAnswer = resolve;
    });
    const coordinator = makeCoordinator(stateRoot, new QuestioningExecutor(answerPromise));
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);

    let settled = false;
    const donePromise = handle.done.then((outcome) => {
      settled = true;
      return outcome;
    });
    let questions = coordinator.pendingQuestions;
    for (let i = 0; i < 100 && questions.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      questions = coordinator.pendingQuestions;
    }
    assert.equal(settled, false, "child must not settle before the answer");
    assert.equal(questions.length, 1);
    const questionId = questions[0]!.id;
    await coordinator.answerQuestion(questionId, "Yes");
    resolveAnswer("Yes");

    const outcome = await donePromise;
    assert.equal(outcome.outcome, "SUCCESS");

    const store = new EventStore(stateRoot, parentRunId);
    const read = await store.readAll();
    const events = read.events.map((e) => e.type);
    assert.ok(events.includes("RUN_WAITING_FOR_USER"));
    assert.ok(events.includes("USER_ANSWER"));
  });
});

test("a selective approval reply is correlated against the coordinator's own pending plan", async () => {
  await withTempState(async (stateRoot) => {
    const approvalPlan: ApprovalPlan = {
      id: "plan-refactor",
      items: [
        { id: "rename", label: "Rename the helper", selectable: true, defaultSelected: true },
        { id: "delete", label: "Delete the legacy path", selectable: true },
        { id: "context", label: "Read the module", selectable: false }
      ]
    };
    let resolveAnswer!: (text: string) => void;
    const answerPromise = new Promise<string>((resolve) => {
      resolveAnswer = resolve;
    });
    const coordinator = makeCoordinator(stateRoot, new QuestioningExecutor(answerPromise, approvalPlan));
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);
    const donePromise = handle.done;

    let questions = coordinator.pendingQuestions;
    for (let i = 0; i < 100 && questions.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      questions = coordinator.pendingQuestions;
    }
    const questionId = questions[0]!.id;

    // Free text cannot stand in for an approval decision.
    await assert.rejects(
      () => coordinator.answerQuestion(questionId, "Yes"),
      /requires an approval reply/i
    );
    await assert.rejects(
      () => coordinator.answerQuestion(questionId, "Yes", { approvalPlanId: "other-plan", selectedActionIds: ["rename"] }),
      /does not match the pending plan/i
    );
    await assert.rejects(
      () => coordinator.answerQuestion(questionId, "Yes", { approvalPlanId: approvalPlan.id, selectedActionIds: ["context"] }),
      /non-selectable/i
    );
    await assert.rejects(
      () => coordinator.answerQuestion(questionId, "Yes", { approvalPlanId: approvalPlan.id, selectedActionIds: ["rename", "rename"] }),
      /unique/i
    );

    await coordinator.answerQuestion(questionId, "Yes", {
      approvalPlanId: approvalPlan.id,
      selectedActionIds: ["rename"]
    });
    resolveAnswer("Yes");
    assert.equal((await donePromise).outcome, "SUCCESS");

    const read = await new EventStore(stateRoot, parentRunId).readAll();
    const waiting = read.events.find((e) => e.type === "RUN_WAITING_FOR_USER");
    assert.deepEqual(
      (waiting?.payload as { approvalPlan?: ApprovalPlan }).approvalPlan,
      approvalPlan,
      "the authoritative plan is persisted when the run starts waiting"
    );
    const answers = read.events.filter((e) => e.type === "USER_ANSWER");
    assert.equal(answers.length, 1, "rejected replies must not persist an answer");
    assert.deepEqual((answers[0]!.payload as { approvalReply?: unknown }).approvalReply, {
      approvalPlanId: approvalPlan.id,
      selectedActionIds: ["rename"]
    });
  });
});

test("a plain-text answer without any approval reply stays valid", async () => {
  await withTempState(async (stateRoot) => {
    const approvalPlan: ApprovalPlan = {
      id: "plan-plain",
      items: [{ id: "go", label: "Go", selectable: true }]
    };
    let resolveAnswer!: (text: string) => void;
    const answerPromise = new Promise<string>((resolve) => {
      resolveAnswer = resolve;
    });
    const coordinator = makeCoordinator(stateRoot, new QuestioningExecutor(answerPromise));
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);
    const donePromise = handle.done;

    let questions = coordinator.pendingQuestions;
    for (let i = 0; i < 100 && questions.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      questions = coordinator.pendingQuestions;
    }
    const questionId = questions[0]!.id;

    // A question without a plan cannot accept a selective reply at all.
    await assert.rejects(
      () => coordinator.answerQuestion(questionId, "Yes", { approvalPlanId: approvalPlan.id, selectedActionIds: ["go"] }),
      /no pending approval plan/i
    );

    await coordinator.answerQuestion(questionId, "Yes");
    resolveAnswer("Yes");
    assert.equal((await donePromise).outcome, "SUCCESS");

    const read = await new EventStore(stateRoot, parentRunId).readAll();
    const answer = read.events.find((e) => e.type === "USER_ANSWER");
    assert.deepEqual(answer?.payload, { messageId: questionId, answer: "Yes" });
    const waiting = read.events.find((e) => e.type === "RUN_WAITING_FOR_USER");
    assert.deepEqual(waiting?.payload, { messageId: questionId });
  });
});

test("an onQuestion callback cannot answer an approval question with plain text", async () => {
  await withTempState(async (stateRoot) => {
    const approvalPlan: ApprovalPlan = {
      id: "plan-callback",
      items: [{ id: "go", label: "Go", selectable: true }]
    };
    const coordinator = makeCoordinator(
      stateRoot,
      new QuestioningExecutor(Promise.resolve("Yes"), approvalPlan),
      { onQuestion: () => "Yes" }
    );
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits({ maxAttempts: 1 })), new AbortController().signal);

    const outcome = await handle.done;
    assert.equal(outcome.outcome, "FAILURE", "a bypass attempt must fail the attempt, not proceed");
    assert.match(outcome.summary, /requires an approval reply/i, "the failure is attributed to the approval gate");

    const read = await new EventStore(stateRoot, parentRunId).readAll();
    assert.equal(
      read.events.filter((e) => e.type === "USER_ANSWER").length,
      0,
      "no answer is persisted when the approval gate rejects the reply"
    );
    assert.ok(read.events.some((e) => e.type === "RUN_WAITING_FOR_USER"), "the pause is still recorded");
  });
});

test("an onQuestion callback supplies a correlated selective approval reply", async () => {
  await withTempState(async (stateRoot) => {
    const approvalPlan: ApprovalPlan = {
      id: "plan-callback-ok",
      items: [
        { id: "go", label: "Go", selectable: true },
        { id: "extra", label: "Extra", selectable: true }
      ]
    };
    const coordinator = makeCoordinator(
      stateRoot,
      new QuestioningExecutor(Promise.resolve("Yes"), approvalPlan),
      {
        onQuestion: (question) => ({
          answer: "Yes",
          approvalReply: { approvalPlanId: question.approvalPlan!.id, selectedActionIds: ["go"] }
        })
      }
    );
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);

    assert.equal((await handle.done).outcome, "SUCCESS");

    const read = await new EventStore(stateRoot, parentRunId).readAll();
    const answer = read.events.find((e) => e.type === "USER_ANSWER");
    assert.deepEqual((answer?.payload as { approvalReply?: unknown }).approvalReply, {
      approvalPlanId: approvalPlan.id,
      selectedActionIds: ["go"]
    });
  });
});

test("PARTIAL TASK_RESULT persists without crashing AGENT_FINISHED", async () => {
  await withTempState(async (stateRoot) => {
    const executor = new ScriptedChildExecutor((request) => [
      { type: "TEXT_DELTA", text: "secret tool body should not be persisted" },
      { type: "TOOL_FINISHED", toolCallId: "t1", isError: false, summary: "read 10 secret lines" },
      { type: "MESSAGE", message: resultMessage(request, "PARTIAL") },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    const coordinator = makeCoordinator(stateRoot, executor);
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);
    const outcome = await handle.done;
    assert.equal(outcome.outcome, "PARTIAL");

    const childStore = new EventStore(stateRoot, handle.childRunId);
    const read = await childStore.readAll();
    const finished = read.events.find((e) => e.type === "AGENT_FINISHED");
    assert.equal((finished?.payload as { outcome: string }).outcome, "SUCCESS");
    const summaries = read.events
      .filter((e) => e.type === "AGENT_EVENT")
      .map((e) => (e.payload as { summary: string }).summary);
    assert.ok(summaries.some((summary) => summary.startsWith("text delta (")));
    assert.ok(!summaries.some((summary) => summary.includes("secret")));
    assert.ok(summaries.includes("tool finished"));
  });
});

test("a duplicate terminal result fails the child run", async () => {
  await withTempState(async (stateRoot) => {
    const executor = new ScriptedChildExecutor((request) => [
      { type: "MESSAGE", message: resultMessage(request, "SUCCESS") },
      { type: "MESSAGE", message: resultMessage(request, "SUCCESS") },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    const coordinator = makeCoordinator(stateRoot, executor);
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);
    const outcome = await handle.done;
    assert.equal(outcome.outcome, "FAILURE");
    assert.match(outcome.summary, /terminal|duplicate/i);
  });
});

test("malformed messages from the child are rejected by the coordinator", async () => {
  await withTempState(async (stateRoot) => {
    const malformed: AgentMessage = {
      protocolVersion: 1,
      id: createMessageId(UUID),
      occurredAt: "2026-08-12T09:00:00.000Z",
      runId: createRunId(UUID),
      taskId: createTaskId(UUID),
      from: "agt_01234567-89ab-cdef-0123-456789abcdef" as AgentInstanceId,
      to: SUPERVISOR,
      type: "PROGRESS",
      status: "DONE",
      summary: "",
      evidenceIds: []
    } as unknown as AgentMessage;
    const executor = new ScriptedChildExecutor(() => [
      { type: "MESSAGE", message: malformed },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
    const coordinator = makeCoordinator(stateRoot, executor);
    const parentRunId = coordinator.parentRunId;
    const taskId = await seedParentRun(stateRoot, parentRunId);
    const handle = coordinator.startChildTask(childInput(taskId, childLimits()), new AbortController().signal);
    const outcome = await handle.done;
    assert.equal(outcome.outcome, "FAILURE");
    assert.match(outcome.summary, /message|invalid/i);
  });
});
