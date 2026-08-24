import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { validateConfidenceScore, type Flowchart, type FlowEdge, type FlowNode } from "../../../src/domain/flowchart.js";
import { createTaskId, parseTaskId, type ArtifactId, type EvidenceId, type MessageId, type RunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import type { PauseController, PauseToken } from "../../../src/run/pause-controller.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-24T09:00:00.000Z");

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function router(): ModelRouter {
  return createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor", "critic"],
        maxComplexity: "MEDIUM",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000
      },
      {
        id: "premium",
        version: "premium-v1",
        roles: ["actor", "critic", "judge", "router"],
        maxComplexity: "HIGH",
        estimatedCostUsd: 0.5,
        estimatedDurationMs: 4_000
      }
    ]
  });
}

function node(id: string): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: "actor",
    objective: `Do ${id}`,
    modelPolicy: { allowedModels: ["cheap", "premium"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

const successEdge = (from: string, to: string): FlowEdge => ({
  from,
  to,
  condition: { type: "success", expected: true }
});

function chain(id: string, ids: readonly string[]): Flowchart {
  const edges: FlowEdge[] = [];
  for (let i = 1; i < ids.length; i += 1) edges.push(successEdge(ids[i - 1]!, ids[i]!));
  return { id, nodes: ids.map(node), edges };
}

function passingResult(request: AgentExecutionRequest): ExecutionEvent {
  return {
    type: "MESSAGE",
    message: {
      protocolVersion: 1,
      id: `msg_pass-${request.agentInstanceId}` as MessageId,
      occurredAt: TS,
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: SUPERVISOR,
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: "recording executor finished the task",
      artifactIds: [`art_pass-${request.taskId}` as ArtifactId],
      evidenceIds: [`evd_pass-${request.taskId}` as EvidenceId],
      verification: { kind: "PASSED", evidenceIds: [`evd_pass-${request.taskId}` as EvidenceId] }
    }
  };
}

/**
 * Records the signal handed to every `execute` call. The run-level controller is
 * only observable through it: whatever the run gives an executor is exactly what
 * a live provider call would be cancelled with.
 */
class RecordingExecutor implements AgentExecutor {
  readonly signals: AbortSignal[] = [];
  readonly taskIds: string[] = [];

  constructor(
    private readonly options: { readonly fail?: boolean; readonly onExecute?: () => void } = {}
  ) {}

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.signals.push(signal);
    this.taskIds.push(request.taskId);
    this.options.onExecute?.();
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (this.options.fail === true) {
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }
    yield passingResult(request);
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** In-memory pause token, so a pause can land mid-run without touching disk. */
class FakePauseController implements PauseController {
  paused = false;
  private pauseReason: string | undefined;

  async requestPause(_runId: RunId, reason?: string): Promise<PauseToken> {
    this.paused = true;
    this.pauseReason = reason;
    return this.token(_runId);
  }

  async clearPause(): Promise<void> {
    this.paused = false;
  }

  async token(_runId: RunId): Promise<PauseToken> {
    if (!this.paused) return { paused: false };
    return {
      paused: true,
      requestedAt: TS,
      ...(this.pauseReason !== undefined ? { reason: this.pauseReason } : {})
    };
  }
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-abort-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-abort-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function deps(stateRoot: string, executor: AgentExecutor, pause?: PauseController) {
  return {
    stateRoot,
    router: router(),
    now: () => TS,
    generateId: sequenceGenerator(),
    executor,
    ...(pause !== undefined ? { pause } : {})
  };
}

test("a failed flowchart run aborts the signal its node executor was given", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new RecordingExecutor({ fail: true });
    const outcome = await startFlowchartRun(deps(stateRoot, executor), {
      projectRoot,
      flowchart: chain("fail-teardown", ["only"])
    });

    assert.equal(outcome.status, "FAILED");
    assert.equal(executor.signals.length, 1);
    assert.equal(executor.signals[0]?.aborted, true, "run failure fires the run-level controller");
  });
});

test("a completed flowchart run aborts its run-level signal at teardown", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new RecordingExecutor();
    const outcome = await startFlowchartRun(deps(stateRoot, executor), {
      projectRoot,
      flowchart: chain("done-teardown", ["first", "second"])
    });

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(executor.signals.length, 2);
    for (const signal of executor.signals) {
      assert.equal(signal.aborted, true, "terminal teardown leaves nothing runnable behind");
    }
  });
});

test("a pause landing mid-node aborts the run and starts no further node", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const pause = new FakePauseController();
    // The user pauses while the first node is executing.
    const executor = new RecordingExecutor({
      onExecute: () => {
        pause.paused = true;
      }
    });

    const outcome = await startFlowchartRun(deps(stateRoot, executor, pause), {
      projectRoot,
      flowchart: chain("pause-teardown", ["first", "second"])
    });

    assert.equal(outcome.status, "PAUSED");
    assert.ok(outcome.events.some((event) => event.type === "PAUSE_REQUESTED"));
    assert.deepEqual(executor.taskIds, ["tsk_first"], "a paused run does not start the next node");
    assert.equal(executor.signals[0]?.aborted, true, "pause fires the run-level controller");
  });
});

function childSpec(taskId: string, role: "implementer" | "reviewer"): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(taskId),
    role,
    objective: `Do ${taskId}`,
    profile: registry.resolve(role),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

test("a coordinator child runs on the run-level signal, and teardown aborts it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new RecordingExecutor();
    const children = [childSpec("tsk_build", "implementer")];
    const flowchart = compileChildrenToFlowchart(
      children.map((child) => ({ taskId: child.taskId, role: "implementer" as const, objective: child.objective }))
    );

    const outcome = await startFlowchartRun(deps(stateRoot, executor), {
      projectRoot,
      flowchart,
      childTasks: children
    });

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(executor.signals.length, 1);
    assert.equal(
      executor.signals[0]?.aborted,
      true,
      "the child attempt signal composes the run signal, so teardown reaches a live child"
    );
  });
});
