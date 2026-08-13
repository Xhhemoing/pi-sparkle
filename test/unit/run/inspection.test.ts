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
import { inspectRun } from "../../../src/run/inspection.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

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

    await new Promise((resolve) => setTimeout(resolve, 20));
    const paused = await inspectRun(stateRoot, parentRunId);
    assert.equal(paused.status, "WAITING_FOR_USER");
    assert.equal(paused.pendingQuestions.length, 1);
    const questionId = paused.pendingQuestions[0]!.id;
    assert.match(questionId, /^msg_/);

    coordinator.answerQuestion(questionId, "Yes");
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
