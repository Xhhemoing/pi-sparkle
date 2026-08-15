import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createMessageId, createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { SUPERVISOR, validateAgentMessage } from "../../../src/protocol/v1.js";
import { startParentRun } from "../../../src/run/coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function childInput(): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: createTaskId(() => "ask"),
    role: "implementer",
    objective: "Ask before proceeding",
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parent-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-parent-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => undefined);
  }
}

class StickyExecutor implements AgentExecutor {
  readonly started: Promise<void>;
  private resolveStarted!: () => void;

  constructor(private readonly holdMs: number) {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.resolveStarted();
    yield { type: "TEXT_DELTA", text: "working" };
    await new Promise<void>((resolve) => setTimeout(resolve, this.holdMs));
    yield { type: "EXECUTION_FINISHED", outcome: signal.aborted ? "CANCELLED" : "SUCCESS" };
  }
}

class QuestionExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, _signal: AbortSignal): AsyncIterable<ExecutionEvent> {
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
        options: ["Yes", "No"]
      })
    };
  }
}

test("parent cancel writes RUN_CANCEL_REQUESTED before children settle", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new StickyExecutor(400);
    const running = startParentRun(
      { stateRoot, executor },
      { projectRoot, objective: "x", children: [childInput()] }
    );
    await executor.started;
    running.cancel();

    const store = new EventStore(stateRoot, running.runId);
    let sawCancel = false;
    for (let i = 0; i < 20; i += 1) {
      const read = await store.readAll();
      if (read.events.some((event) => event.type === "RUN_CANCEL_REQUESTED")) {
        sawCancel = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sawCancel, true, "cancel must be persisted before the slow child settles");

    const outcome = await running.done;
    assert.equal(outcome.status, "CANCELLED");
    assert.ok(outcome.events.some((event) => event.type === "RUN_CANCEL_REQUESTED"));
  });
});

test("a child question settles the parent as WAITING_FOR_USER without hanging", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const running = startParentRun(
      { stateRoot, executor: new QuestionExecutor() },
      { projectRoot, objective: "x", children: [childInput()] }
    );
    const outcome = await Promise.race([
      running.done,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("parent run hung waiting for a question answer")), 2000);
      })
    ]);
    assert.equal(outcome.status, "WAITING_FOR_USER");
    assert.ok(outcome.events.some((event) => event.type === "RUN_WAITING_FOR_USER"));
    assert.ok(!outcome.events.some((event) => event.type === "RUN_COMPLETED"));
    assert.ok(!outcome.events.some((event) => event.type === "USER_ANSWER"));
  });
});
