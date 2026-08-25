import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { DomainValidationError } from "../../../src/domain/errors.js";
import {
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId,
  type RunId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import type { Event } from "../../../src/run/events.js";
import { EventStore } from "../../../src/run/event-store.js";
import { resumeFlowchartRun, startFlowchartRun } from "../../../src/run/flowchart-run.js";
import type { PauseController, PauseToken } from "../../../src/run/pause-controller.js";
import { validateCheckpoint } from "../../../src/run/replay.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";

/**
 * The run-level USD ceiling on the flowchart plane — the plane the CLI's
 * `--children` mode compiles onto.
 *
 * `startParentRun` has forwarded `RunLimits.maxCostUsd` to `ChildCoordinator`
 * since the cost gate shipped (`coordinator.ts:726`), so a caller on the
 * coordinator plane gets the cap on the child's execution request and on the
 * child's own `RUN_CREATED.limits`. The flowchart plane had no input field for
 * one at all and built its coordinator capless at both call sites, so the same
 * declared intent was discarded without a word: request `undefined`, both
 * records capless, status COMPLETED.
 *
 * These tests pin the handoff and the four things it must not become: a
 * per-task declaration on `TASK_REQUEST.limits`, an entry in the
 * `taskCostCeilings` record, a cap invented where the caller declared none, or
 * something a resume can introduce.
 */

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

function deps(stateRoot: string) {
  return {
    stateRoot,
    router: router(),
    now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    generateId: sequenceGenerator()
  };
}

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-runcap-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-runcap-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** The three enforced fields every child here declares, ceiling aside. */
const TESTER_CHILD_BUDGET = { maxAttempts: 3, timeoutMs: 45_000, maxWallTimeMs: 900_000 } as const;

function testerChild(taskId: string, maxCostUsd?: number): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(taskId),
    role: "tester",
    objective: `Verify ${taskId}`,
    profile: registry.resolve("tester"),
    inputArtifactIds: ["art_seed" as ArtifactId],
    acceptanceCriteria: [],
    limits: { ...TESTER_CHILD_BUDGET, ...(maxCostUsd !== undefined ? { maxCostUsd } : {}) }
  };
}

/** Reports SUCCESS + verification PASSED for every task it is given. */
class PassingExecutor implements AgentExecutor {
  readonly taskIds: string[] = [];
  /**
   * The ceiling the coordinator forwarded per task, `undefined` when it
   * forwarded none. Keyed presence is the point: an entry holding `undefined`
   * is "this task ran uncapped", which is a different fact from never running.
   */
  readonly costCaps = new Map<string, number | undefined>();
  constructor(private readonly onExecute?: () => void) {}
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.taskIds.push(request.taskId);
    this.costCaps.set(request.taskId, request.maxCostUsd);
    this.onExecute?.();
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_${request.agentInstanceId}` as MessageId,
        occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "all acceptance checks passed",
        artifactIds: [`art_done_${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_done_${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_done_${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** In-memory pause, so a run can stop between nodes without touching disk. */
class TogglePause implements PauseController {
  paused = false;
  async requestPause(_runId: RunId): Promise<PauseToken> {
    this.paused = true;
    return this.token();
  }
  async clearPause(): Promise<void> {
    this.paused = false;
  }
  async token(): Promise<PauseToken> {
    if (!this.paused) return { paused: false };
    return { paused: true, requestedAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z") };
  }
}

async function eventsOf(stateRoot: string, runId: RunId): Promise<readonly Event[]> {
  return (await new EventStore(stateRoot, runId).readAll()).events;
}

/** The flowchart run's own `RUN_CREATED.limits`, read back from its log. */
async function runCreatedLimits(stateRoot: string, runId: RunId): Promise<Record<string, number>> {
  const created = (await eventsOf(stateRoot, runId)).flatMap((event) =>
    event.type === "RUN_CREATED" ? [event.payload.run.limits] : []
  );
  assert.equal(created.length, 1, "exactly one RUN_CREATED on the flowchart run's log");
  return created[0]! as unknown as Record<string, number>;
}

interface LoggedTaskRequest {
  readonly taskId: string;
  readonly limits: Readonly<Record<string, number>>;
}

/** The one `TASK_REQUEST` the parent log carries for a task. */
function requestLimits(events: readonly Event[], taskId: string): Readonly<Record<string, number>> {
  const requests = events.flatMap((event) => {
    if (event.type !== "CHILD_MESSAGE") return [];
    const message = event.payload.message as unknown as LoggedTaskRequest & { type: string };
    return message.type === "TASK_REQUEST" && message.taskId === taskId ? [message] : [];
  });
  assert.equal(requests.length, 1, `exactly one TASK_REQUEST for ${taskId}`);
  return requests[0]!.limits;
}

/** The ceiling on the child run's own `RUN_CREATED`, read from that run's log. */
async function childRunCeiling(
  stateRoot: string,
  events: readonly Event[],
  taskId: string
): Promise<number | undefined> {
  const childRunIds = events.flatMap((event) =>
    event.type === "CHILD_RUN_CREATED" && event.payload.childRun.rootTaskId === taskId
      ? [event.payload.childRun.id]
      : []
  );
  assert.equal(childRunIds.length, 1, `exactly one child run for ${taskId}`);
  const created = (await eventsOf(stateRoot, childRunIds[0]!)).flatMap((event) =>
    event.type === "RUN_CREATED" ? [event.payload.run.limits] : []
  );
  assert.equal(created.length, 1, `exactly one child RUN_CREATED for ${taskId}`);
  return created[0]!.maxCostUsd;
}

interface DispatchedBudget {
  /** `TASK_REQUEST.limits` on the parent log: what the child was asked for. */
  readonly request: Readonly<Record<string, number>>;
  /** The child run's own `RUN_CREATED.limits.maxCostUsd`: what it may spend. */
  readonly childRunCreated: number | undefined;
  /** `AgentExecutionRequest.maxCostUsd`: what the executor was told to enforce. */
  readonly executionRequest: number | undefined;
}

async function dispatchedBudget(
  stateRoot: string,
  runId: RunId,
  executor: PassingExecutor,
  taskId: string
): Promise<DispatchedBudget> {
  const events = await eventsOf(stateRoot, runId);
  assert.equal(executor.costCaps.has(taskId), true, `the executor really ran ${taskId}`);
  return {
    request: requestLimits(events, taskId),
    childRunCreated: await childRunCeiling(stateRoot, events, taskId),
    executionRequest: executor.costCaps.get(taskId)
  };
}

async function storedTaskCostCeilings(
  stateRoot: string,
  runId: RunId
): Promise<Record<string, number> | undefined> {
  const raw = await new CheckpointStore(stateRoot, runId).read();
  const recorded = validateCheckpoint(raw).flowchart?.taskCostCeilings;
  if (recorded === undefined) return undefined;
  return Object.fromEntries(recorded.map((entry) => [entry.taskId, entry.maxCostUsd]));
}

/**
 * One or two dependent tester children on the flowchart plane, with the
 * run-level cap, each child's own ceiling, and the pause all under the test's
 * control — so every case below differs from the control in exactly one input.
 */
async function cappedFlowchartRun(
  stateRoot: string,
  projectRoot: string,
  options: {
    readonly children: readonly ChildTaskInput[];
    readonly maxCostUsd?: number;
    readonly pauseAfterFirst?: boolean;
  }
): Promise<{ runId: RunId; executor: PassingExecutor }> {
  const children = options.children;
  const flowchart = compileChildrenToFlowchart(
    children.map((child, index) => ({
      taskId: child.taskId,
      role: "tester" as const,
      objective: child.objective,
      ...(index > 0 ? { dependsOn: [children[index - 1]!.taskId] } : {})
    }))
  );

  const pause = new TogglePause();
  const executor = new PassingExecutor(
    options.pauseAfterFirst === true
      ? () => {
          pause.paused = true;
        }
      : undefined
  );
  const outcome = await startFlowchartRun(
    { ...deps(stateRoot), executor, pause },
    {
      projectRoot,
      flowchart,
      childTasks: children,
      ...(options.maxCostUsd !== undefined ? { maxCostUsd: options.maxCostUsd } : {})
    }
  );
  assert.equal(outcome.status, options.pauseAfterFirst === true ? "PAUSED" : "COMPLETED");
  return { runId: outcome.runId, executor };
}

test("a run-level cap reaches the child's execution request and both RUN_CREATED records", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, executor } = await cappedFlowchartRun(stateRoot, projectRoot, {
      children: [testerChild("tsk_only")],
      maxCostUsd: 0.5
    });
    assert.deepEqual(executor.taskIds, ["tsk_only"]);

    // The run's own durable record of what its caller authorised. This is the
    // only place a resume may read the cap back from.
    assert.equal((await runCreatedLimits(stateRoot, runId)).maxCostUsd, 0.5);

    assert.deepEqual(await dispatchedBudget(stateRoot, runId, executor, "tsk_only"), {
      // Coordinator state, not a per-task declaration: the request still says
      // exactly what this child's caller asked for, which is no ceiling.
      request: { ...TESTER_CHILD_BUDGET },
      childRunCreated: 0.5,
      executionRequest: 0.5
    });
    // Nor is it a declared per-task ceiling, so the dispatch-fact record stays
    // empty: a resume must not turn a run cap into this child's own.
    assert.equal(await storedTaskCostCeilings(stateRoot, runId), undefined);
  });
});

test("each child attempt runs under the tighter of its own ceiling and the run-level cap", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, executor } = await cappedFlowchartRun(stateRoot, projectRoot, {
      children: [testerChild("tsk_first", 0.1), testerChild("tsk_second", 0.9)],
      maxCostUsd: 0.5
    });
    assert.deepEqual(executor.taskIds, ["tsk_first", "tsk_second"]);

    // A per-task budget under the run's stays its own: a run cap cannot loosen
    // a task that asked for less.
    assert.deepEqual(await dispatchedBudget(stateRoot, runId, executor, "tsk_first"), {
      request: { ...TESTER_CHILD_BUDGET, maxCostUsd: 0.1 },
      childRunCreated: 0.1,
      executionRequest: 0.1
    });
    // And a per-task budget above the run's cannot buy its way past it.
    assert.deepEqual(await dispatchedBudget(stateRoot, runId, executor, "tsk_second"), {
      request: { ...TESTER_CHILD_BUDGET, maxCostUsd: 0.9 },
      childRunCreated: 0.5,
      executionRequest: 0.5
    });
    // The record keeps the declared ceilings, not the effective ones.
    assert.deepEqual(await storedTaskCostCeilings(stateRoot, runId), {
      tsk_first: 0.1,
      tsk_second: 0.9
    });
  });
});

test("a run declaring no cap keeps an absent key on every record it writes", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, executor } = await cappedFlowchartRun(stateRoot, projectRoot, {
      children: [testerChild("tsk_only")]
    });
    assert.deepEqual(executor.taskIds, ["tsk_only"]);

    const limits = await runCreatedLimits(stateRoot, runId);
    assert.equal(
      Object.hasOwn(limits, "maxCostUsd"),
      false,
      "absent stays an absent key, not a present undefined and not a default"
    );
    assert.deepEqual(await dispatchedBudget(stateRoot, runId, executor, "tsk_only"), {
      request: { ...TESTER_CHILD_BUDGET },
      childRunCreated: undefined,
      executionRequest: undefined
    });
    assert.equal(await storedTaskCostCeilings(stateRoot, runId), undefined);
  });
});

test("a run-level cap that is not a positive finite number is refused before any write", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const child = testerChild("tsk_only");
    const flowchart = compileChildrenToFlowchart([
      { taskId: child.taskId, role: "tester" as const, objective: child.objective }
    ]);
    const rejected: readonly unknown[] = [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null];

    for (const value of rejected) {
      const executor = new PassingExecutor();
      await assert.rejects(
        startFlowchartRun(
          { ...deps(stateRoot), executor },
          {
            projectRoot,
            flowchart,
            childTasks: [child],
            maxCostUsd: value as number
          }
        ),
        (error: unknown) => {
          assert.ok(error instanceof DomainValidationError, `${String(value)} is refused as a domain error`);
          assert.equal(error.message, "flowchart maxCostUsd must be a positive finite number of US dollars");
          return true;
        },
        `${String(value)} is not a spend authorisation`
      );
      assert.deepEqual(executor.taskIds, [], `${String(value)} never reaches an executor`);
    }

    // The refusal happens outside the run lifecycle lock, so a refused start
    // leaves no run directory, no event log, and no lock file behind.
    assert.deepEqual(await readdir(stateRoot), [], "a refused start leaves the state root untouched");
  });
});

test("a resume restores the run-level cap from the replayed RUN_CREATED without inventing a per-task one", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, executor: firstLeg } = await cappedFlowchartRun(stateRoot, projectRoot, {
      children: [testerChild("tsk_first"), testerChild("tsk_second")],
      maxCostUsd: 0.5,
      pauseAfterFirst: true
    });
    assert.deepEqual(firstLeg.taskIds, ["tsk_first"]);
    // Nothing durable names a per-task ceiling, so the second leg has only the
    // run's own record to restore from.
    assert.equal(await storedTaskCostCeilings(stateRoot, runId), undefined);

    const secondLeg = new PassingExecutor();
    const resumed = await resumeFlowchartRun(
      { ...deps(stateRoot), executor: secondLeg, pause: new TogglePause() },
      runId,
      { unpause: true }
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(secondLeg.taskIds, ["tsk_second"]);

    // `tsk_second` is the substitution case: the log never saw it dispatched,
    // so its spec is rebuilt. The run-level cap still reaches it, because it
    // comes from the run's own `RUN_CREATED.limits` rather than from anything
    // the rebuild had to guess.
    assert.deepEqual(await dispatchedBudget(stateRoot, runId, secondLeg, "tsk_second"), {
      request: { ...TESTER_CHILD_BUDGET },
      childRunCreated: 0.5,
      executionRequest: 0.5
    });
    // And the resume learned no per-task ceiling from a cap that was never one.
    assert.equal(await storedTaskCostCeilings(stateRoot, runId), undefined);
  });
});
