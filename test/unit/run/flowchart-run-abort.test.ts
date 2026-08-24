import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { validateConfidenceScore, type Flowchart, type FlowEdge, type FlowNode } from "../../../src/domain/flowchart.js";
import { createTaskId, parseRunId, parseTaskId, type ArtifactId, type EvidenceId, type MessageId, type RunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildRunOutcome, ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { observationFromChild } from "../../../src/run/child-tracking.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { injectFlowchartRun, resumeFlowchartRun, startFlowchartRun } from "../../../src/run/flowchart-run.js";
import type { PauseController, PauseToken } from "../../../src/run/pause-controller.js";
import { replayRun } from "../../../src/run/replay.js";
import { prescoreInputFromObservation } from "../../../src/tracking/from-child.js";
import { computePrescore } from "../../../src/tracking/prescore.js";
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
    private readonly options: {
      readonly fail?: boolean;
      readonly onExecute?: () => void;
      /** Fires once the task result has been handed to the run. */
      readonly onResult?: () => void;
    } = {}
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
    this.options.onResult?.();
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

/**
 * A pause controller whose token read blows up, which is the cheapest way to
 * make an error escape the run loop from inside {@link startFlowchartRun}: the
 * thin executor path swallows its own throws, so a node cannot produce one.
 */
class ThrowingPauseController implements PauseController {
  calls = 0;

  constructor(private readonly beforeThrow?: (runId: RunId) => Promise<void>) {}

  async requestPause(runId: RunId): Promise<PauseToken> {
    return this.token(runId);
  }

  async clearPause(): Promise<void> {}

  async token(runId: RunId): Promise<PauseToken> {
    this.calls += 1;
    await this.beforeThrow?.(runId);
    throw new Error("pause token unreadable");
  }
}

/** The one run directory the state root holds; a crashed run never returns its id. */
async function soleRunId(stateRoot: string): Promise<RunId> {
  const ids = await readdir(join(runtimeRoot(stateRoot), "runs"));
  assert.equal(ids.length, 1, "exactly one run under the state root");
  return parseRunId(ids[0]);
}

function eventsPath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", runId, "events.jsonl");
}

test("an error escaping the run records RUN_FAILED naming the escaping error", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new RecordingExecutor();
    await assert.rejects(
      startFlowchartRun(deps(stateRoot, executor, new ThrowingPauseController()), {
        projectRoot,
        flowchart: chain("crash-terminal", ["only"])
      }),
      /pause token unreadable/
    );

    const runId = await soleRunId(stateRoot);
    const read = await new EventStore(stateRoot, runId).readAll();
    const failed = read.events.filter((event) => event.type === "RUN_FAILED");
    assert.equal(failed.length, 1, "the crashed run records exactly one terminal event");
    assert.equal(
      (failed[0]?.payload as { reason: string }).reason,
      "run crashed: pause token unreadable",
      "the reason names the error that killed the run, not an invented node failure"
    );
    assert.deepEqual(executor.taskIds, [], "the run died before any node ran");
  });
});

test("a run that crashed replays as FAILED and resume redoes no work", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    await assert.rejects(
      startFlowchartRun(deps(stateRoot, new RecordingExecutor(), new ThrowingPauseController()), {
        projectRoot,
        flowchart: chain("crash-replay", ["only"])
      }),
      /pause token unreadable/
    );

    const runId = await soleRunId(stateRoot);
    const crashed = await new EventStore(stateRoot, runId).readAll();
    const replayed = replayRun(crashed.events);
    assert.equal(replayed.status, "FAILED", "replay sees a failure, not a run that just stops");
    assert.deepEqual(replayed.anomalies, [], "the appended terminal is the log's only one");

    const afterCrash = new RecordingExecutor();
    const resumed = await resumeFlowchartRun(deps(stateRoot, afterCrash), runId);
    assert.equal(resumed.status, "FAILED", "resuming a crashed run reports the failure");
    assert.deepEqual(afterCrash.taskIds, [], "a crashed run is not silently restarted");
  });
});

test("a crash while resuming a paused run leaves the pause resumable", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const pause = new FakePauseController();
    const executor = new RecordingExecutor({
      onExecute: () => {
        pause.paused = true;
      }
    });
    const paused = await startFlowchartRun(deps(stateRoot, executor, pause), {
      projectRoot,
      flowchart: chain("pause-then-crash", ["first", "second"])
    });
    assert.equal(paused.status, "PAUSED");

    await assert.rejects(
      resumeFlowchartRun(deps(stateRoot, new RecordingExecutor(), new ThrowingPauseController()), paused.runId),
      /pause token unreadable/
    );

    const read = await new EventStore(stateRoot, paused.runId).readAll();
    assert.equal(
      read.events.some((event) => event.type === "RUN_FAILED"),
      false,
      "a crash during teardown must not bury a state the operator can still resume"
    );
    assert.equal(replayRun(read.events).status, "PAUSED");
  });
});

/**
 * Runs out of ids `budget` generations after it is armed, which is how the
 * tests below drop a crash into one chosen window of a resumed run. Any dep
 * failing there would do; the id generator is simply the one seam every append
 * on the path goes through.
 */
function armableGenerator(): { generate: () => string; armAfter: (budget: number) => void } {
  let n = 0;
  let budget: number | undefined;
  return {
    generate: () => {
      if (budget !== undefined) {
        if (budget === 0) throw new Error("id generator exhausted");
        budget -= 1;
      }
      return `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
    },
    armAfter: (remaining: number) => {
      budget = remaining;
    }
  };
}

async function readCheckpoint(stateRoot: string, runId: RunId): Promise<{
  flowchart: { snapshot: { nodes: Record<string, { state: string }>; facts: Record<string, unknown> } };
}> {
  const raw = await readFile(join(runtimeRoot(stateRoot), "runs", runId, "checkpoint.json"), "utf8");
  return JSON.parse(raw) as {
    flowchart: { snapshot: { nodes: Record<string, { state: string }>; facts: Record<string, unknown> } };
  };
}

/** Node id → node state, read from the durable checkpoint rather than memory. */
async function checkpointNodeStates(stateRoot: string, runId: RunId): Promise<Record<string, string>> {
  const { flowchart } = await readCheckpoint(stateRoot, runId);
  return Object.fromEntries(Object.entries(flowchart.snapshot.nodes).map(([id, node]) => [id, node.state]));
}

/**
 * A two-node run paused after its first node finished: node `a` is COMPLETED
 * and durable, node `b` has never run.
 */
async function pausedAfterFirstNode(stateRoot: string, projectRoot: string): Promise<RunId> {
  const pause = new FakePauseController();
  const executor = new RecordingExecutor({
    onExecute: () => {
      pause.paused = true;
    }
  });
  const paused = await startFlowchartRun(deps(stateRoot, executor, pause), {
    projectRoot,
    flowchart: chain("paused-resume", ["a", "b"])
  });
  assert.equal(paused.status, "PAUSED");
  assert.deepEqual(await checkpointNodeStates(stateRoot, paused.runId), { a: "COMPLETED", b: "READY" });
  return paused.runId;
}

/**
 * Resumes {@link pausedAfterFirstNode} with no pause token, which is the state
 * a process leaves behind when it dies between `clearPause` and the
 * `PAUSE_CLEARED` append: the token is gone, the log's `PAUSE_REQUESTED` is
 * still unmatched, so the run executes while replaying as PAUSED. The resume is
 * killed `budget` ids after node `b`'s result arrives.
 */
async function crashResumingPausedRun(stateRoot: string, runId: RunId, budget: number): Promise<void> {
  const generator = armableGenerator();
  const executor = new RecordingExecutor({ onResult: () => generator.armAfter(budget) });
  await assert.rejects(
    resumeFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        generateId: generator.generate,
        executor,
        pause: new FakePauseController()
      },
      runId
    ),
    /id generator exhausted/
  );
}

test("a crash after a node lands keeps a paused run's resume point level with its log", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await pausedAfterFirstNode(stateRoot, projectRoot);
    await crashResumingPausedRun(stateRoot, runId, 3);

    const crashed = await new EventStore(stateRoot, runId).readAll();
    const types = crashed.events.map((event) => event.type);
    // The window this pin is about: node b's result was accepted and gated, and
    // the round that records it never got to append its ledger entry.
    assert.ok(types.includes("TRACKING_ASSESSMENT"), "node b's result was accepted");
    assert.equal(types.lastIndexOf("LEDGER_UPDATED") < types.indexOf("PAUSE_REQUESTED"), true);
    assert.equal(replayRun(crashed.events).status, "PAUSED", "the crash left the pause standing");
    assert.equal(
      crashed.events.some((event) => event.type === "RUN_FAILED"),
      false,
      "a state the operator can still resume is never buried under a terminal"
    );
    assert.deepEqual(
      await checkpointNodeStates(stateRoot, runId),
      { a: "COMPLETED", b: "COMPLETED" },
      "teardown flushes the resume point, so the checkpoint is not a node behind the log"
    );

    const afterCrash = new RecordingExecutor();
    const resumed = await resumeFlowchartRun(deps(stateRoot, afterCrash), runId);
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(afterCrash.taskIds, [], "resume re-pays for nothing the paused run had finished");
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
  });
});

test("a node still in flight when a paused run crashes is retried on the record, not silently", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await pausedAfterFirstNode(stateRoot, projectRoot);
    await crashResumingPausedRun(stateRoot, runId, 2);

    const crashed = await new EventStore(stateRoot, runId).readAll();
    assert.ok(
      crashed.events.some(
        (event) =>
          event.type === "CHILD_MESSAGE" &&
          (event.payload as { message: { type: string } }).message.type === "TASK_RESULT"
      ),
      "node b's child did report a result"
    );
    assert.equal(
      crashed.events.some((event) => event.type === "TRACKING_ASSESSMENT"),
      false,
      "the crash landed before that result was accepted: b is still in flight"
    );
    assert.equal(replayRun(crashed.events).status, "PAUSED");
    assert.deepEqual(await checkpointNodeStates(stateRoot, runId), { a: "COMPLETED", b: "RUNNING" });

    const afterCrash = new RecordingExecutor();
    const resumed = await resumeFlowchartRun(deps(stateRoot, afterCrash), runId);
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(afterCrash.taskIds, ["tsk_b"], "an in-flight node is re-executed, at least once");

    // The disclosed cost of that retry stays inspectable: both attempts kept
    // their own child run, and the parent log names both.
    const launches = resumed.events.filter(
      (event) => event.type === "CHILD_RUN_CREATED" && event.taskId === "tsk_b"
    );
    assert.equal(launches.length, 2, "the interrupted attempt is still on the parent's record");
    const childRunIds = new Set(
      launches.map((event) => (event.payload as { childRun: { id: RunId } }).childRun.id)
    );
    assert.equal(childRunIds.size, 2, "the retry is a distinct child run, not an overwrite");
    for (const childRunId of childRunIds) {
      const childLog = await new EventStore(stateRoot, childRunId).readAll();
      assert.equal(
        childLog.events.filter((event) => event.type === "RUN_COMPLETED" || event.type === "RUN_FAILED")
          .length,
        1,
        `child run ${childRunId} closed its own log`
      );
    }
  });
});

test("a crash while a run waits for the user records no terminal and stays answerable", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const gate = { ...node("gate"), approvalRequired: true };
    const waiting = await startFlowchartRun(deps(stateRoot, new RecordingExecutor()), {
      projectRoot,
      flowchart: { id: "waiting-crash", nodes: [gate], edges: [] }
    });
    assert.equal(waiting.status, "WAITING_FOR_USER");
    const pending = waiting.pendingApproval;
    assert.ok(pending, "the run stopped on a real approval");

    await assert.rejects(
      resumeFlowchartRun(
        deps(stateRoot, new RecordingExecutor(), new ThrowingPauseController()),
        waiting.runId
      ),
      /pause token unreadable/
    );

    const crashed = await new EventStore(stateRoot, waiting.runId).readAll();
    assert.equal(
      crashed.events.some((event) => event.type === "RUN_FAILED"),
      false,
      "a question the operator still owes an answer to is not buried under a terminal"
    );
    assert.equal(replayRun(crashed.events).status, "WAITING_FOR_USER");

    const answered = await resumeFlowchartRun(deps(stateRoot, new RecordingExecutor()), waiting.runId, {
      approvalReply: { approvalPlanId: pending.plan.id, selectedActionIds: [pending.approveActionId!] }
    });
    assert.notEqual(answered.status, "WAITING_FOR_USER", "the crash cost the run nothing it had recorded");
    assert.deepEqual(replayRun(answered.events).anomalies, []);
  });
});

test("a crash while injecting into a paused run keeps the injection it applied", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await pausedAfterFirstNode(stateRoot, projectRoot);
    assert.deepEqual((await readCheckpoint(stateRoot, runId)).flowchart.snapshot.facts, {});

    // Ids run out on the ledger entry that follows the injection: the fact is
    // applied to the supervisor and INJECTION_REQUESTED is on the log, but the
    // round that would have checkpointed it never finishes.
    const generator = armableGenerator();
    generator.armAfter(1);
    await assert.rejects(
      injectFlowchartRun(
        { stateRoot, router: router(), now: () => TS, generateId: generator.generate },
        runId,
        { actor: "operator", kind: "fact", key: "deploy-window", value: "closed" }
      ),
      /id generator exhausted/
    );

    const crashed = await new EventStore(stateRoot, runId).readAll();
    assert.ok(
      crashed.events.some((event) => event.type === "INJECTION_REQUESTED"),
      "the injection was recorded before the crash"
    );
    assert.equal(
      crashed.events.some((event) => event.type === "RUN_FAILED"),
      false,
      "inject is a side channel: it never fails a run it does not own"
    );
    assert.deepEqual(
      (await readCheckpoint(stateRoot, runId)).flowchart.snapshot.facts,
      { "deploy-window": "closed" },
      "an injection the log records is one resume will actually see"
    );
  });
});

test("a crash while a run is blocked records no terminal and keeps the block resumable", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // No executor and no results: the run stalls its way to BLOCKED.
    const blocked = await startFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId: sequenceGenerator() },
      {
        projectRoot,
        flowchart: chain("blocked-crash", ["only"]),
        limits: { maxConsecutiveStalls: 1, maxRounds: 4 }
      }
    );
    assert.equal(blocked.status, "BLOCKED");

    await assert.rejects(
      resumeFlowchartRun(
        deps(stateRoot, new RecordingExecutor(), new ThrowingPauseController()),
        blocked.runId
      ),
      /pause token unreadable/
    );

    const crashed = await new EventStore(stateRoot, blocked.runId).readAll();
    assert.equal(
      crashed.events.filter((event) => event.type === "RUN_FAILED").length,
      0,
      "a block an injection can still clear is not converted into a failure"
    );
    const replayed = replayRun(crashed.events);
    assert.equal(replayed.status, "BLOCKED");
    assert.deepEqual(replayed.anomalies, [], "the crash added no second terminal");
    assert.deepEqual(await checkpointNodeStates(stateRoot, blocked.runId), { only: "RUNNING" });
  });
});

/**
 * The crash terminal this plane records now comes from the shared module
 * (`run/crash-terminal.ts`), not from a private copy: the three planes had
 * deliberately identical copies, and a fourth fork is how they would drift.
 * The behavioural pins above are unchanged by the swap — same in-flight-only
 * rule, same `run crashed: ` prefix — which is what makes it safe to assert
 * the source shape here.
 */
test("the flowchart plane records its crash terminal through the shared helper", async () => {
  const source = await readFile(new URL("../../../src/run/flowchart-run.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ recordCrashTerminal \} from "\.\/crash-terminal\.js";/);
  assert.doesNotMatch(source, /function recordCrashTerminal/, "no private copy survives the swap");
  assert.doesNotMatch(source, /function crashReason/, "nor the reason formatter it used");
});

/**
 * R4-4 pinned that a node still in flight at crash time is re-executed on
 * resume. The three tests below pin the facts that decide whether a future
 * resume could instead *adopt* the recorded result (R5-5's investigation):
 * what the crashed log actually carries, what the retry costs, and why a
 * `TASK_RESULT` on the parent log is not by itself the child's answer.
 */

test("a crash inside the acceptance window leaves a committed child result the supervisor never took", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await pausedAfterFirstNode(stateRoot, projectRoot);
    await crashResumingPausedRun(stateRoot, runId, 2);

    const crashed = await new EventStore(stateRoot, runId).readAll();
    const launches = crashed.events.filter(
      (event) => event.type === "CHILD_RUN_CREATED" && event.taskId === "tsk_b"
    );
    assert.equal(launches.length, 1, "node b's child was launched once");
    const childRunId = (launches[0]?.payload as { childRun: { id: RunId } }).childRun.id;

    // Everything an adopter would read is already durable on the parent log:
    // which child ran, how many attempts it took, and what it finally reported.
    const childMessages = crashed.events
      .filter((event) => event.type === "CHILD_MESSAGE")
      .map((event) => (event.payload as { message: { type: string; runId: RunId } }).message)
      .filter((message) => message.runId === childRunId);
    assert.equal(
      childMessages.filter((message) => message.type === "TASK_REQUEST").length,
      1,
      "the parent log carries the attempt the child was given"
    );
    assert.equal(
      childMessages.filter((message) => message.type === "TASK_RESULT").length,
      1,
      "the parent log carries the child's terminal result"
    );

    // And the child run committed: it closed its own log before the crash.
    const childLog = await new EventStore(stateRoot, childRunId).readAll();
    assert.equal(
      childLog.events.filter(
        (event) =>
          event.type === "RUN_COMPLETED" ||
          event.type === "RUN_FAILED" ||
          event.type === "RUN_CANCEL_REQUESTED"
      ).length,
      1,
      "the child run reached its own terminal, so its result is final"
    );

    // The supervisor still never took it, and the resume point says so.
    assert.equal(
      crashed.events.some((event) => event.type === "TRACKING_ASSESSMENT"),
      false,
      "no three-line gate ran, so nothing accepted the result"
    );
    assert.deepEqual(await checkpointNodeStates(stateRoot, runId), { a: "COMPLETED", b: "RUNNING" });
  });
});

test("the retry a crashed acceptance window costs is one node, accepted once", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const runId = await pausedAfterFirstNode(stateRoot, projectRoot);
    await crashResumingPausedRun(stateRoot, runId, 2);

    const afterCrash = new RecordingExecutor();
    const resumed = await resumeFlowchartRun(deps(stateRoot, afterCrash), runId);
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(afterCrash.taskIds, ["tsk_b"], "exactly one node is paid for twice");

    // The accepted cost is bounded at the re-execution: the second attempt is
    // gated once, so the ledger does not carry two accepted results for one node.
    const accepted = resumed.events.filter(
      (event) =>
        event.type === "TRACKING_ASSESSMENT" &&
        (event.payload as { assessment: { turnId: string } }).assessment.turnId === "tsk_b"
    );
    assert.equal(accepted.length, 1, "node b's result is accepted exactly once, by the retry");
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
  });
});

/**
 * The premise behind requiring a *committed* child run rather than a recorded
 * `TASK_RESULT`: `maybeCascadeRetry` can turn a reported result into another
 * attempt, and production sets a cascade plan on every routed child
 * (`cli/main.ts`, `track/loop.ts`). So the parent log can carry a `TASK_RESULT`
 * that the child run itself went on to supersede.
 */
test("a TASK_RESULT on the parent log is not by itself the child's committed answer", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    let attempt = 0;
    const executor: AgentExecutor = {
      async *execute(request, signal) {
        attempt += 1;
        if (signal.aborted) {
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
          return;
        }
        const failing = attempt === 1;
        const passing = passingResult(request);
        assert.equal(passing.type, "MESSAGE");
        yield failing
          ? {
              type: "MESSAGE",
              message: {
                ...passing.message,
                outcome: "FAILURE",
                summary: "first attempt did not hold up",
                verification: { kind: "FAILED", evidenceIds: [`evd_fail-${request.taskId}` as EvidenceId] }
              }
            }
          : passing;
        yield { type: "EXECUTION_FINISHED", outcome: failing ? "FAILURE" : "SUCCESS" };
      }
    };

    const spec: ChildTaskInput = {
      ...childSpec("tsk_cascaded", "implementer"),
      assignedModel: "cheap",
      cascade: {
        highRisk: false,
        tiers: [
          { modelId: "cheap", version: "cheap-v1" },
          { modelId: "premium", version: "premium-v1" }
        ]
      },
      limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
    };
    const outcome = await startFlowchartRun(deps(stateRoot, executor), {
      projectRoot,
      flowchart: compileChildrenToFlowchart([
        { taskId: spec.taskId, role: "implementer", objective: spec.objective }
      ]),
      childTasks: [spec]
    });

    assert.equal(outcome.status, "COMPLETED");
    const launches = outcome.events.filter((event) => event.type === "CHILD_RUN_CREATED");
    assert.equal(launches.length, 1, "one child run, not two: the retry is inside it");

    const results = outcome.events.filter(
      (event) =>
        event.type === "CHILD_MESSAGE" &&
        (event.payload as { message: { type: string } }).message.type === "TASK_RESULT"
    );
    assert.equal(results.length, 2, "the parent log carries both the superseded result and the final one");
    const retryIndex = outcome.events.findIndex((event) => event.type === "TASK_RETRY");
    assert.ok(retryIndex > 0, "the cascade retry is on the record");
    assert.ok(
      outcome.events.indexOf(results[0]!) < retryIndex && retryIndex < outcome.events.indexOf(results[1]!),
      "the first result is followed by a retry, so reading it as final would be wrong"
    );
  });
});

test("a terminal append that cannot land still rethrows the original error", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // The log is torn just before the run dies, so the best-effort terminal
    // append fails on the read it needs first.
    const pause = new ThrowingPauseController(async (runId) => {
      await appendFile(eventsPath(stateRoot, runId), "{not json\n", "utf8");
    });

    await assert.rejects(
      startFlowchartRun(deps(stateRoot, new RecordingExecutor(), pause), {
        projectRoot,
        flowchart: chain("crash-unwritable", ["only"])
      }),
      /pause token unreadable/,
      "the append failure is swallowed, the escaping error is not"
    );

    const runId = await soleRunId(stateRoot);
    const raw = await readFile(eventsPath(stateRoot, runId), "utf8");
    assert.equal(raw.includes("RUN_FAILED"), false, "nothing was appended to the torn log");
  });
});

/**
 * R6-2's investigation: `childTasksFromDefinition` rebuilds every resumed child
 * spec from the checkpointed flowchart, so a resumed node runs under a spec the
 * caller never wrote. The three tests below pin what that costs today — the
 * exact rebuilt shape, the gate verdict it produces, and the invariant that
 * currently keeps the shape change away from the verdict.
 *
 * Measured at HEAD over all 240 observations a routed child can produce: the
 * gate directive never differs between the original and the rebuilt spec, so
 * the re-specification is not a false-accept vector *today*. It is inert, not
 * harmless — see the third test for the invariant that makes it inert.
 */

/** A production-shaped tester child: real criteria, a routed model, a cascade. */
function testerSpecWithCriteria(taskId: string): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(taskId),
    role: "tester",
    objective: `Verify ${taskId}`,
    profile: registry.resolve("tester"),
    inputArtifactIds: ["art_seed" as ArtifactId],
    acceptanceCriteria: [
      { id: "crit-integration", description: "the integration suite passes" },
      { id: "crit-regression", description: "no perf regression" }
    ],
    assignedModel: "premium",
    cascade: {
      highRisk: true,
      tiers: [
        { modelId: "cheap", version: "cheap-v1" },
        { modelId: "premium", version: "premium-v1" }
      ]
    },
    limits: { maxAttempts: 1, timeoutMs: 30_000, maxWallTimeMs: 300_000 }
  };
}

interface RecordedTaskRequest {
  readonly taskId: string;
  readonly inputArtifactIds: readonly string[];
  readonly acceptanceCriteria: readonly { readonly id: string }[];
  readonly limits: Readonly<Record<string, number>>;
}

/** Every TASK_REQUEST the parent log recorded for one task, in order. */
function taskRequestsFor(events: readonly Event[], taskId: string): RecordedTaskRequest[] {
  return events.flatMap((event) => {
    if (event.type !== "CHILD_MESSAGE") return [];
    const message = event.payload.message as unknown as RecordedTaskRequest & { type: string };
    if (message.type !== "TASK_REQUEST" || message.taskId !== taskId) return [];
    return [message];
  });
}

interface RecordedAssessment {
  readonly turnId: string;
  readonly prescore: number;
  readonly gate: { readonly kind: string; readonly codes: readonly string[] };
  readonly dimensions: readonly { readonly id: string; readonly verdict: string }[];
}

function assessmentFor(events: readonly Event[], taskId: string): RecordedAssessment | undefined {
  for (const event of events) {
    if (event.type !== "TRACKING_ASSESSMENT") continue;
    const assessment = event.payload.assessment as unknown as RecordedAssessment;
    if (assessment.turnId === taskId) return assessment;
  }
  return undefined;
}

/**
 * A two-node tester run whose second node is re-executed on resume: node `a` is
 * accepted under the caller's spec before the crash, node `b` under the rebuilt
 * one after it. Both nodes see identical executor behaviour, so any difference
 * between their assessments is the re-specification and nothing else.
 */
async function resumedAfterCrashBeforeAcceptance(
  stateRoot: string,
  projectRoot: string
): Promise<{ runId: RunId; events: readonly Event[]; reexecuted: readonly string[] }> {
  const specs = [testerSpecWithCriteria("tsk_a"), testerSpecWithCriteria("tsk_b")];
  const flowchart = compileChildrenToFlowchart(
    specs.map((spec, index) => ({
      taskId: spec.taskId,
      role: "tester" as const,
      objective: spec.objective,
      ...(index > 0 ? { dependsOn: [specs[index - 1]!.taskId] } : {})
    }))
  );

  // Leg 1: node a lands and is accepted; the pause stops the run before node b.
  const pause = new FakePauseController();
  const first = new RecordingExecutor({
    onExecute: () => {
      pause.paused = true;
    }
  });
  const paused = await startFlowchartRun(deps(stateRoot, first, pause), {
    projectRoot,
    flowchart,
    childTasks: specs
  });
  assert.equal(paused.status, "PAUSED");

  // Leg 2: node b's result lands, then the process dies before acceptance.
  await crashResumingPausedRun(stateRoot, paused.runId, 2);

  // Leg 3: the real resume, which re-executes node b under the rebuilt spec.
  const after = new RecordingExecutor();
  const resumed = await resumeFlowchartRun(deps(stateRoot, after, new FakePauseController()), paused.runId);
  assert.equal(resumed.status, "COMPLETED");
  return { runId: paused.runId, events: resumed.events, reexecuted: after.taskIds };
}

test("a resumed node is re-specified: the rebuilt child spec's exact shape", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { events, reexecuted } = await resumedAfterCrashBeforeAcceptance(stateRoot, projectRoot);
    assert.deepEqual(reexecuted, ["tsk_b"], "only the in-flight node is redone");

    // Node a ran once, under the caller's spec, and the log proves it.
    const original = taskRequestsFor(events, "tsk_a");
    assert.equal(original.length, 1);
    assert.deepEqual(
      original[0]?.acceptanceCriteria.map((criterion) => criterion.id),
      ["crit-integration", "crit-regression"],
      "the caller's criteria reached the child the run started"
    );
    assert.deepEqual(original[0]?.inputArtifactIds, ["art_seed"]);
    assert.deepEqual(original[0]?.limits, { maxAttempts: 1, timeoutMs: 30_000, maxWallTimeMs: 300_000 });

    // Node b was still unstarted when the crash landed, so every attempt it ever
    // got came from a resume — and none of them is the task the caller wrote.
    // This is the gap, pinned field by field so it cannot change silently.
    const rebuilt = taskRequestsFor(events, "tsk_b");
    assert.equal(rebuilt.length, 2, "node b was attempted twice, both times from a resume");
    for (const attempt of rebuilt) {
      assert.deepEqual(attempt.acceptanceCriteria, [], "the caller's criteria are gone");
      assert.deepEqual(attempt.inputArtifactIds, [], "so are the input artifacts");
      assert.deepEqual(
        attempt.limits,
        { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 },
        "and the caller's budget is replaced by childTasksFromDefinition's hard-coded one"
      );
    }
  });
});

test("the re-specification does not change the gate's verdict", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const { events } = await resumedAfterCrashBeforeAcceptance(stateRoot, projectRoot);

    // Node a was gated under the caller's spec, node b under the rebuilt one,
    // on identical child behaviour. R6-2's measurement, pinned: the recorded
    // dimensions differ, the decision does not.
    const specified = assessmentFor(events, "tsk_a");
    const respecified = assessmentFor(events, "tsk_b");
    assert.ok(specified, "node a was accepted under the caller's spec");
    assert.ok(respecified, "node b was accepted under the rebuilt spec");

    const verdict = (assessment: RecordedAssessment): { kind: string; codes: readonly string[] } => ({
      kind: assessment.gate.kind,
      codes: assessment.gate.codes
    });
    assert.deepEqual(verdict(respecified), verdict(specified), "same gate decision either way");
    assert.deepEqual(verdict(specified), { kind: "none", codes: [] });
    assert.equal(
      events.some((event) => event.type === "GATE_TRANSITION"),
      false,
      "a passing child transitions neither run, so there is no false accept to find here"
    );

    // What *did* change: the criteria the caller wrote decided a dimension for
    // node a and were absent for node b. The gap is real; it just stops here.
    const verdictOf = (assessment: RecordedAssessment, id: string): string | undefined =>
      assessment.dimensions.find((dimension) => dimension.id === id)?.verdict;
    assert.equal(verdictOf(specified, "check-coverage"), "PASS");
    assert.equal(verdictOf(respecified, "check-coverage"), "NOT_APPLICABLE");
  });
});

/**
 * Why the re-specification cannot currently reach the verdict, stated as the
 * invariant it depends on. `prescoreInputFromObservation` derives
 * `completedChecks` from `requiredChecks` itself, so check-coverage compares a
 * list against a copy of itself: acceptance criteria are never checked against
 * anything the child did, and the dimension cannot FAIL.
 *
 * This is the tripwire for R6-2's decision. The moment check-coverage becomes a
 * real check, a resumed node — whose criteria are empty — is gated more weakly
 * than the node the run started, and the re-specification becomes a
 * false-accept vector. Whoever makes that change must fix
 * `childTasksFromDefinition` in the same diff; this test is where they find out.
 */
test("check-coverage cannot fail, which is what keeps the rebuilt spec off the verdict", () => {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const spec: ChildTaskInput = {
    taskId: parseTaskId("tsk_probe"),
    role: "tester",
    objective: "Verify",
    profile: registry.resolve("tester"),
    inputArtifactIds: [],
    acceptanceCriteria: [{ id: "crit-only", description: "the one criterion" }],
    limits: { maxAttempts: 1, timeoutMs: 30_000, maxWallTimeMs: 300_000 }
  };

  const reachable = new Set<string>();
  for (const kind of ["PASSED", "FAILED"] as const) {
    for (const outcome of ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED", "TIMEOUT"] as const) {
      const child = {
        childRunId: parseRunId("run_00000000-0000-4000-8000-000000000000"),
        taskId: parseTaskId("tsk_probe"),
        outcome,
        attempts: 1,
        summary: "all checks passed and verified",
        messages: [],
        artifactIds: ["art_one" as ArtifactId],
        evidenceIds: ["evd_one" as EvidenceId],
        terminalResult: { verification: { kind, evidenceIds: ["evd_one" as EvidenceId] } }
      } as unknown as ChildRunOutcome;
      const observation = observationFromChild(child, spec);
      // The child never reports which criteria it met, so the shipped
      // derivation can only echo the ones it was asked for.
      const input = prescoreInputFromObservation(observation);
      assert.deepEqual(
        input.completedChecks,
        kind === "PASSED" ? input.requiredChecks : [],
        "completedChecks is a copy of requiredChecks, never an independent observation"
      );
      const dimension = computePrescore(input).dimensions.find((entry) => entry.id === "check-coverage");
      assert.ok(dimension);
      reachable.add(dimension.outcome);
    }
  }
  assert.equal(reachable.has("FAIL"), false, "no acceptance criterion can fail a child");
  assert.deepEqual([...reachable].toSorted(), ["PASS", "UNOBSERVED"]);
});
