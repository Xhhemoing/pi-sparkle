import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import type { RequirementContract } from "../../../src/domain/contract.js";
import { validateFlowchart, type Flowchart } from "../../../src/domain/flowchart.js";
import {
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId,
  type RunId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import {
  resumeFlowchartRun,
  startFlowchartRun,
  unblockFlowchartRun,
  type FlowchartRunOutcome
} from "../../../src/run/flowchart-run.js";
import { replayRun, replayedTerminalStatus, type RunCheckpoint } from "../../../src/run/replay.js";
import { reopenBlockedFlowchartSnapshot } from "../../../src/supervisor/flowchart-supervisor.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";

/**
 * End to end for the contract R7-3 designed and this round implemented: a run
 * that the tracking gate blocked can be authorized to continue, and the work
 * the block interrupted actually runs again.
 *
 * The seed is the reviewer's R6-1 shape — a clustered child that reports
 * success against a failed verification — because that is the block operators
 * meet in production and the one that, until now, no command could end. What
 * these cases prove is the whole chain, not one link: the event clears replay's
 * terminal latch, the checkpoint transform reopens the FAILED node, resume
 * re-executes it, and the run reaches COMPLETED with a single anomaly-free log
 * carrying both terminals in order.
 *
 * They also pin the two halves apart. `unblock` authorizes and executes
 * nothing; `resume` executes and authorizes nothing. That separation is what
 * makes the operator's two steps separately auditable, and it is easy to lose
 * by accident, so it is asserted directly rather than implied.
 */

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-24T09:00:00.000Z");

/** One generator per run: event ids must stay unique across start, unblock and resume. */
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

function verificationFailedResult(request: AgentExecutionRequest): ExecutionEvent {
  return {
    type: "MESSAGE",
    message: {
      protocolVersion: 1,
      id: `msg_vf-${request.agentInstanceId}` as MessageId,
      occurredAt: TS,
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: SUPERVISOR,
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: "the child reported success; verification did not agree",
      artifactIds: [`art_vf-${request.taskId}` as ArtifactId],
      evidenceIds: [`evd_vf-${request.taskId}` as EvidenceId],
      verification: { kind: "FAILED", evidenceIds: [`evd_vf-${request.taskId}` as EvidenceId] }
    }
  };
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
      summary: "the operator's fix landed and verification agreed",
      artifactIds: [`art_pass-${request.taskId}` as ArtifactId],
      evidenceIds: [`evd_pass-${request.taskId}` as EvidenceId],
      verification: { kind: "PASSED", evidenceIds: [`evd_pass-${request.taskId}` as EvidenceId] }
    }
  };
}

function executorYielding(result: (request: AgentExecutionRequest) => ExecutionEvent): AgentExecutor & {
  readonly taskIds: string[];
} {
  const taskIds: string[] = [];
  return {
    taskIds,
    async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
      taskIds.push(request.taskId);
      if (signal.aborted) {
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
        return;
      }
      yield result(request);
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  };
}

async function withRoots(body: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-unblock-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-unblock-proj-"));
  try {
    await body(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function childSpec(taskId: string): ChildTaskInput {
  return {
    taskId: parseTaskId(taskId),
    role: "implementer",
    objective: `Do ${taskId}`,
    profile: createAgentProfileRegistry(defaultAgentProfiles()).resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

/** `compileChildrenToFlowchart` uses the task id as the node id, so this is both. */
const NODE = "tsk_verify";

function terminals(events: readonly Event[]): Event["type"][] {
  return events
    .map((event) => event.type)
    .filter((type) => type === "RUN_COMPLETED" || type === "RUN_FAILED" || type === "RUN_BLOCKED");
}

function unblockEvents(events: readonly Event[]): Extract<Event, { type: "RUN_UNBLOCKED" }>[] {
  return events.filter((event) => event.type === "RUN_UNBLOCKED");
}

/** The R6-1 seed: one clustered child whose verification fails, so the gate blocks. */
async function blockedRun(
  stateRoot: string,
  projectRoot: string,
  generateId: () => string
): Promise<{ runId: RunId; checkpoint: RunCheckpoint; blockedEventId: string }> {
  const spec = childSpec(NODE);
  const outcome = await startFlowchartRun(
    {
      stateRoot,
      router: router(),
      now: () => TS,
      generateId,
      executor: executorYielding(verificationFailedResult),
      cluster: true
    },
    {
      projectRoot,
      flowchart: compileChildrenToFlowchart([
        { taskId: spec.taskId, role: "implementer", objective: spec.objective }
      ]),
      childTasks: [spec]
    }
  );
  assert.equal(outcome.status, "BLOCKED", "the gate's queue_analysis decides the terminal");
  assert.equal(outcome.snapshot.nodes[NODE]?.state, "FAILED", "and the node behind it failed");
  const blocked = outcome.events.find((event) => event.type === "RUN_BLOCKED");
  assert.ok(blocked !== undefined);
  return { runId: outcome.runId, checkpoint: outcome.checkpoint, blockedEventId: blocked.id };
}

test("unblock clears the gate's block and resume re-executes the reopened node to COMPLETED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const { runId, blockedEventId } = await blockedRun(stateRoot, projectRoot, generateId);

    const afterUnblock = executorYielding(passingResult);
    const unblocked = await unblockFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor: afterUnblock },
      runId,
      { reason: "operator reviewed the queued analysis and fixed the test", retryNodeId: NODE }
    );

    // Exactly one authorization, naming exactly the block it clears.
    assert.equal(unblockEvents(unblocked.events).length, 1);
    const authorization = unblockEvents(unblocked.events)[0];
    assert.deepEqual(authorization?.payload, {
      blockedEventId,
      reason: "operator reviewed the queued analysis and fixed the test",
      retryNodeId: NODE
    });

    // The latch is open and the node is re-drivable, but nothing has run.
    assert.equal(unblocked.status, "RUNNING");
    assert.equal(replayedTerminalStatus(unblocked.events), undefined);
    assert.deepEqual(replayRun(unblocked.events).anomalies, []);
    assert.equal(unblocked.snapshot.nodes[NODE]?.state, "READY", "FAILED reopened, not fabricated anew");
    assert.equal(unblocked.checkpoint.status, "RUNNING", "the durable resume point agrees with the log");
    assert.equal(unblocked.checkpoint.flowchart?.snapshot.nodes[NODE]?.state, "READY");
    assert.deepEqual(afterUnblock.taskIds, [], "unblock authorizes; it does not spend a single model call");

    // Resume is the execution surface, and the reopened node really runs again.
    const resumed = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor: afterUnblock, cluster: true },
      runId
    );
    assert.deepEqual(afterUnblock.taskIds, [NODE], "the node the block named executed exactly once more");
    assert.equal(resumed.status, "COMPLETED", "the run that could never end now ends");
    assert.equal(resumed.snapshot.nodes[NODE]?.state, "COMPLETED");

    // One log, both terminals, in order, and no anomaly anywhere in it.
    assert.deepEqual(terminals(resumed.events), ["RUN_BLOCKED", "RUN_COMPLETED"]);
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
    assert.equal(replayedTerminalStatus(resumed.events), "COMPLETED");
    assert.equal(
      resumed.events.some((event) => event.type === "TASK_STATUS_CHANGED"),
      false,
      "the flowchart reopen moves a FlowNodeState; it does not forge the DAG scheduler's transition"
    );
  });
});

/**
 * The retry that does not work, which is the outcome an operator has to be
 * allowed to reach: reopening a node is permission to try again, not a promise.
 *
 * It is also the only end-to-end shape that observes `currentGateStatus`. The
 * gate writes `from` on each transition by reconstructing the run's status from
 * the log, separately from replay. If a matched unblock did not read as RUNNING
 * there, this second transition would record `from: "BLOCKED"` — one run with
 * two reconstructions disagreeing in writing about whether it was ever
 * unblocked, which is precisely the drift the shared rule exists to prevent.
 */
test("a reopened node that fails again blocks again, and the second block is a first terminal", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const { runId, blockedEventId } = await blockedRun(stateRoot, projectRoot, generateId);

    await unblockFlowchartRun({ stateRoot, router: router(), now: () => TS, generateId }, runId, {
      reason: "operator believes the verification was flaky",
      retryNodeId: NODE
    });

    const stillFailing = executorYielding(verificationFailedResult);
    const reblocked = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor: stillFailing, cluster: true },
      runId
    );
    assert.deepEqual(stillFailing.taskIds, [NODE], "the reopened node really was re-driven");
    assert.equal(reblocked.status, "BLOCKED", "and it failed the gate a second time");

    const transitions = reblocked.events
      .filter((event) => event.type === "GATE_TRANSITION")
      .map((event) => ({ from: event.payload.from, to: event.payload.to }));
    assert.deepEqual(transitions, [
      { from: "RUNNING", to: "BLOCKED" },
      { from: "RUNNING", to: "BLOCKED" }
    ]);

    // Two blocks, one unblock between them, and no "multiple terminal events":
    // the interval the unblock ended is closed, so the second block opens a new one.
    assert.deepEqual(terminals(reblocked.events), ["RUN_BLOCKED", "RUN_BLOCKED"]);
    assert.deepEqual(replayRun(reblocked.events).anomalies, []);
    assert.equal(replayedTerminalStatus(reblocked.events), "BLOCKED");

    // The new block needs its own authorization; the first one is spent.
    const active = replayRun(reblocked.events).activeBlockedEventId;
    assert.notEqual(active, blockedEventId, "the active block is the newer one");
    const second = await unblockFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      runId,
      { reason: "operator escalated to a human reviewer", retryNodeId: NODE }
    );
    assert.equal(second.status, "RUNNING");
    assert.deepEqual(
      unblockEvents(second.events).map((event) => event.payload.blockedEventId),
      [blockedEventId, active],
      "each authorization names the block it actually cleared"
    );
    assert.deepEqual(replayRun(second.events).anomalies, []);
  });
});

test("a stall block is cleared without a retry node, and the ledger latch goes with it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    // No executor and no results: the node is leased, nothing answers, and the
    // stall detector — not the gate — writes the block.
    const stalled = await startFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      {
        projectRoot,
        flowchart: compileChildrenToFlowchart([
          { taskId: parseTaskId(NODE), role: "implementer", objective: "Do the work" }
        ])
      }
    );
    assert.equal(stalled.status, "BLOCKED");
    assert.equal(stalled.snapshot.ledger.isBlocked, true, "the stall shape blocks the ledger, not a node");
    assert.ok(stalled.snapshot.ledger.consecutiveStalls > 0);

    const unblocked = await unblockFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      stalled.runId,
      { reason: "operator supplied the missing result out of band" }
    );

    assert.equal(unblocked.status, "RUNNING");
    assert.deepEqual(replayRun(unblocked.events).anomalies, []);
    assert.equal(unblocked.snapshot.ledger.isBlocked, false);
    assert.equal(unblocked.snapshot.ledger.consecutiveStalls, 0);
    assert.deepEqual(unblocked.snapshot.ledger.requiredEvidence, []);
    assert.equal(
      unblockEvents(unblocked.events)[0]?.payload.retryNodeId,
      undefined,
      "a run-level block reopens no node, so it names none"
    );

    // And the reopened run is drivable: given the result it was waiting for, it ends.
    const resumed = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      stalled.runId,
      { childResults: { [NODE]: { outcome: "SUCCESS", confidence: 0.9, evidenceIds: ["evd_late"] } } }
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(terminals(resumed.events), ["RUN_BLOCKED", "RUN_COMPLETED"]);
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
  });
});

test("a crash between the appended unblock and its checkpoint is recovered by resume, once", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const { runId, checkpoint: beforeUnblock } = await blockedRun(stateRoot, projectRoot, generateId);

    const executor = executorYielding(passingResult);
    await unblockFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      runId,
      { reason: "operator reviewed the queued analysis", retryNodeId: NODE }
    );

    // The window the append-before-checkpoint order deliberately leaves open:
    // the authorization is durable, the reopened checkpoint is not. Restoring
    // the pre-unblock checkpoint is exactly what that crash leaves behind.
    const store = new CheckpointStore(stateRoot, runId);
    await store.write(beforeUnblock);
    assert.equal((await store.read() as RunCheckpoint).flowchart?.snapshot.nodes[NODE]?.state, "FAILED");

    const recovered = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor, cluster: true },
      runId
    );
    assert.equal(recovered.status, "COMPLETED", "resume re-derived the reopen the checkpoint had lost");
    assert.deepEqual(executor.taskIds, [NODE], "and re-executed the node exactly once");
    assert.deepEqual(replayRun(recovered.events).anomalies, []);
    assert.deepEqual(terminals(recovered.events), ["RUN_BLOCKED", "RUN_COMPLETED"]);
  });
});

test("a checkpoint that already carries the reopen is not reopened a second time", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const { runId } = await blockedRun(stateRoot, projectRoot, generateId);

    const unblocked = await unblockFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      runId,
      { reason: "operator reviewed the queued analysis", retryNodeId: NODE }
    );
    assert.equal(unblocked.checkpoint.flowchart?.snapshot.nodes[NODE]?.state, "READY");

    // The recovery above keys on `checkpoint.lastEventId` predating the unblock,
    // not on the log merely carrying one. Re-applying here would throw, because
    // the node it names is no longer FAILED — so a resume that reaches the
    // executor at all is the proof that it did not try.
    const executor = executorYielding(passingResult);
    const resumed = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor, cluster: true },
      runId
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(executor.taskIds, [NODE]);
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
  });
});

test("unblock refuses a run it cannot authorize, and writes nothing when it does", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const { runId } = await blockedRun(stateRoot, projectRoot, generateId);
    const deps = { stateRoot, router: router(), now: () => TS, generateId };

    await assert.rejects(
      unblockFlowchartRun(deps, runId, { reason: "   ", retryNodeId: NODE }),
      /non-empty reason/
    );
    await assert.rejects(
      unblockFlowchartRun(deps, runId, { reason: "ok", retryNodeId: "" }),
      /non-empty node id/
    );
    // The gate block names its failed node, so the operator must name that one.
    await assert.rejects(
      unblockFlowchartRun(deps, runId, { reason: "ok" }),
      new RegExp(`this block names failed node ${NODE}`)
    );
    await assert.rejects(
      unblockFlowchartRun(deps, runId, { reason: "ok", retryNodeId: "some-other-node" }),
      new RegExp(`is not the failed node this block names \\(${NODE}\\)`)
    );

    // Every refusal above happened before the append, so the log is untouched.
    const stillBlocked = await unblockFlowchartRun(deps, runId, {
      reason: "operator reviewed the queued analysis",
      retryNodeId: NODE
    });
    assert.equal(unblockEvents(stillBlocked.events).length, 1, "four refusals left no authorization behind");

    // And the authorization is spent: a repeat is refused on the run's status.
    await assert.rejects(
      unblockFlowchartRun(deps, runId, { reason: "again", retryNodeId: NODE }),
      /cannot unblock a RUNNING run/
    );
    const onDisk = (await new EventStore(stateRoot, runId).readAll()).events;
    assert.equal(unblockEvents(onDisk).length, 1, "the refused repeat wrote nothing either");
    assert.deepEqual(replayRun(onDisk).anomalies, []);
  });
});

test("unblock refuses a run that never blocked", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const completed = await startFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor: executorYielding(passingResult), cluster: true },
      {
        projectRoot,
        flowchart: compileChildrenToFlowchart([
          { taskId: parseTaskId(NODE), role: "implementer", objective: "Do the work" }
        ]),
        childTasks: [childSpec(NODE)]
      }
    );
    assert.equal(completed.status, "COMPLETED");
    await assert.rejects(
      unblockFlowchartRun({ stateRoot, router: router(), now: () => TS, generateId }, completed.runId, {
        reason: "nothing to clear"
      }),
      /cannot unblock a COMPLETED run/
    );
  });
});

/**
 * The reopen's fail-closed edge. Rewinding a node that already executed would
 * discard real work and real spend on nothing more than an operator's `--reason`
 * string, so the transform refuses rather than deciding for them. Allowing it
 * needs its own authorization contract; silently erasing is the one outcome
 * that must not be available.
 *
 * The snapshot is a real blocked one with a single field changed, so the
 * refusal is checked against production shape rather than a hand-built fiction.
 */
test("reopening a node whose descendant already executed fails closed", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const specs = [childSpec("tsk_first"), childSpec("tsk_second")];
    const flowchart = compileChildrenToFlowchart([
      { taskId: specs[0]!.taskId, role: "implementer", objective: "First" },
      { taskId: specs[1]!.taskId, role: "implementer", objective: "Second", dependsOn: [specs[0]!.taskId] }
    ]);
    const blocked = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        generateId,
        executor: executorYielding(verificationFailedResult),
        cluster: true
      },
      { projectRoot, flowchart, childTasks: specs }
    );
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.snapshot.nodes.tsk_first?.state, "FAILED");

    const config = { flowchart, router: router(), limits: blocked.checkpoint.flowchart!.limits, now: () => TS };

    // Untouched, the dependent node is rewindable and the reopen is allowed.
    const reopened = reopenBlockedFlowchartSnapshot(config, blocked.snapshot, { retryNodeId: "tsk_first" });
    assert.equal(reopened.nodes.tsk_first?.state, "READY");
    assert.notEqual(reopened.nodes.tsk_second?.state, "COMPLETED");

    const withExecutedDescendant = {
      ...blocked.snapshot,
      nodes: {
        ...blocked.snapshot.nodes,
        tsk_second: { ...blocked.snapshot.nodes.tsk_second!, state: "COMPLETED" as const, success: true }
      }
    };
    assert.throws(
      () => reopenBlockedFlowchartSnapshot(config, withExecutedDescendant, { retryNodeId: "tsk_first" }),
      /tsk_second already executed/
    );

    // The same refusal protects the reopened node itself from being re-driven twice.
    assert.throws(
      () => reopenBlockedFlowchartSnapshot(config, reopened, { retryNodeId: "tsk_first" }),
      /only a FAILED node can be re-driven/
    );
  });
});

/**
 * The authorization the refusal above says is missing: `--discard-executed`.
 *
 * These cases need a block an operator can actually reach with executed work
 * behind it, so the seed is a three-node investigation rather than a mutated
 * snapshot. A scout completes; root-cause analysis and the summary that reads
 * it both become ready, because the summary joins on `any` — one real reason a
 * flowchart author writes a summary that can run on partial input. They lease
 * in the same round, the summary passes, root-cause analysis fails
 * verification, and the gate blocks. The run is now BLOCKED with a FAILED node
 * whose descendant is COMPLETED, which is precisely the shape ordinary unblock
 * cannot end.
 */

const SCOUT = "tsk_scout";
const ROOT_CAUSE = "tsk_root_cause";
const SUMMARY = "tsk_summarize";

/** Covered by every child spec below, so the coverage gate lets the run start. */
const CRITERION = { id: "crit-root-cause", description: "the summary cites the root cause" };

function investigationContract(): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "Explain the outage",
    deliverables: [],
    constraints: [{ id: "con-no-prod", description: "do not touch prod" }],
    nonGoals: [],
    acceptanceCriteria: [CRITERION],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  } as unknown as RequirementContract;
}

function investigationChild(taskId: string): ChildTaskInput {
  return { ...childSpec(taskId), acceptanceCriteria: [CRITERION] };
}

/**
 * `compileChildrenToFlowchart` compiles two dependencies into an all-join, so
 * the summary's `any` join is declared directly on the node. Everything else —
 * ids, edges, model policy — stays exactly what the compiler produces.
 */
function investigationFlowchart(): Flowchart {
  const compiled = compileChildrenToFlowchart([
    { taskId: parseTaskId(SCOUT), role: "implementer", objective: "Collect the logs" },
    {
      taskId: parseTaskId(ROOT_CAUSE),
      role: "implementer",
      objective: "Find the root cause",
      dependsOn: [parseTaskId(SCOUT)]
    },
    {
      taskId: parseTaskId(SUMMARY),
      role: "implementer",
      objective: "Summarize for the incident review",
      dependsOn: [parseTaskId(SCOUT), parseTaskId(ROOT_CAUSE)]
    }
  ]);
  return validateFlowchart({
    ...compiled,
    nodes: compiled.nodes.map((node) =>
      node.id === SUMMARY
        ? { ...node, joinPolicy: { mode: "any" as const, requiredNodeIds: [SCOUT, ROOT_CAUSE] } }
        : node
    )
  });
}

/** Fails verification for the named tasks and passes for every other one. */
function executorFailing(failing: readonly string[]): AgentExecutor & { readonly taskIds: string[] } {
  return executorYielding((request) =>
    failing.includes(request.taskId) ? verificationFailedResult(request) : passingResult(request)
  );
}

async function blockedWithExecutedDescendant(
  stateRoot: string,
  projectRoot: string,
  generateId: () => string
): Promise<FlowchartRunOutcome> {
  const outcome = await startFlowchartRun(
    {
      stateRoot,
      router: router(),
      now: () => TS,
      generateId,
      executor: executorFailing([ROOT_CAUSE]),
      cluster: true
    },
    {
      projectRoot,
      flowchart: investigationFlowchart(),
      childTasks: [
        investigationChild(SCOUT),
        investigationChild(ROOT_CAUSE),
        investigationChild(SUMMARY)
      ],
      contract: investigationContract(),
      limits: { remainingCostUsd: 9, remainingTimeMs: 900_000 }
    }
  );
  assert.equal(outcome.status, "BLOCKED");
  assert.deepEqual(
    Object.fromEntries(Object.entries(outcome.snapshot.nodes).map(([id, node]) => [id, node.state])),
    { [SCOUT]: "COMPLETED", [ROOT_CAUSE]: "FAILED", [SUMMARY]: "COMPLETED" },
    "the summary really executed behind the node that failed"
  );
  return outcome;
}

function discardEvents(
  events: readonly Event[]
): Extract<Event, { type: "RUN_UNBLOCKED_WITH_DISCARD" }>[] {
  return events.filter((event) => event.type === "RUN_UNBLOCKED_WITH_DISCARD");
}

test("--discard-executed authorizes the rewind ordinary unblock refuses, and resume re-runs both nodes", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const blocked = await blockedWithExecutedDescendant(stateRoot, projectRoot, generateId);
    const { runId } = blocked;
    const blockedEventId = blocked.events.find((event) => event.type === "RUN_BLOCKED")!.id;
    const summaryRoute = blocked.events.find(
      (event) => event.type === "MODEL_ROUTED" && event.payload.taskId === SUMMARY
    )!;
    const summaryChildRun = blocked.events.find(
      (event) => event.type === "CHILD_RUN_CREATED" && event.payload.childRun.rootTaskId === SUMMARY
    )!;
    const deps = { stateRoot, router: router(), now: () => TS, generateId };

    // Without the flag the operator gets today's refusal, naming the node in
    // the way — the R9-3 fail-closed pin, reached through the shipped command.
    await assert.rejects(
      unblockFlowchartRun(deps, runId, { reason: "retry the analysis", retryNodeId: ROOT_CAUSE }),
      new RegExp(
        `cannot reopen node ${ROOT_CAUSE}: ${SUMMARY} already executed, and rewinding executed work is not authorized by an unblock`
      )
    );
    assert.equal(
      (await new EventStore(stateRoot, runId).readAll()).events.length,
      blocked.events.length,
      "a refused transform appends nothing at all"
    );

    const executor = executorFailing([]);
    const discarded = await unblockFlowchartRun(
      { ...deps, executor },
      runId,
      {
        reason: "operator accepted losing the summary to re-derive the root cause",
        retryNodeId: ROOT_CAUSE,
        discardExecuted: true,
        actor: "sre-oncall"
      }
    );

    // One event, of the stronger type only. A second ordinary RUN_UNBLOCKED
    // would mean the authorization was split across a crash window.
    assert.equal(unblockEvents(discarded.events).length, 0, "the ordinary event is not also written");
    assert.equal(discardEvents(discarded.events).length, 1);
    const authorization = discardEvents(discarded.events)[0]!;
    assert.equal(authorization.actor, "sre-oncall");
    assert.deepEqual(authorization.payload, {
      blockedEventId,
      reason: "operator accepted losing the summary to re-derive the root cause",
      retryNodeId: ROOT_CAUSE,
      rewoundDescendants: [
        {
          nodeId: SUMMARY,
          taskId: parseTaskId(SUMMARY),
          previousState: "COMPLETED",
          modelRouteEventIds: [summaryRoute.id],
          childRunIds: [summaryChildRun.type === "CHILD_RUN_CREATED" ? summaryChildRun.payload.childRun.id : ""],
          chargedEstimatedCostUsd: 0.1,
          chargedEstimatedDurationMs: 1_000
        }
      ]
    });
    assert.deepEqual(
      summaryRoute.type === "MODEL_ROUTED"
        ? [summaryRoute.payload.estimatedCostUsd, summaryRoute.payload.estimatedDurationMs]
        : [],
      [0.1, 1_000],
      "the charged estimate is the routed row's own number, not a figure the event invented"
    );

    // Authorization only: the latch is open and both nodes are drivable again,
    // and not one model call was spent proving it.
    assert.equal(discarded.status, "RUNNING");
    assert.deepEqual(replayRun(discarded.events).anomalies, []);
    assert.equal(discarded.snapshot.nodes[ROOT_CAUSE]?.state, "READY");
    assert.equal(discarded.snapshot.nodes[SUMMARY]?.state, "READY", "the discarded node is re-derivable");
    assert.equal(discarded.snapshot.nodes[SCOUT]?.state, "COMPLETED", "an unrelated node is untouched");
    assert.deepEqual(executor.taskIds, [], "unblock authorizes; it does not spend a single model call");

    // Discard is a control-state operation, so the facts survive and the money
    // does not come back.
    assert.equal(discarded.snapshot.nodes[SUMMARY]?.evidenceCount, 1, "its evidence still counts");
    assert.equal(discarded.snapshot.nodes[SUMMARY]?.success, undefined, "but its stale success cannot satisfy an edge");
    assert.equal(discarded.snapshot.nodes[SUMMARY]?.confidence, undefined);
    assert.equal(discarded.snapshot.remainingCostUsd, blocked.snapshot.remainingCostUsd, "no refund");
    assert.equal(discarded.snapshot.remainingTimeMs, blocked.snapshot.remainingTimeMs, "no refund");
    assert.equal(
      discarded.events.filter((event) => event.type === "CHILD_MESSAGE" && event.taskId === SUMMARY).length,
      blocked.events.filter((event) => event.type === "CHILD_MESSAGE" && event.taskId === SUMMARY).length,
      "every row the discarded attempt wrote is still on the log"
    );

    // The fourth flowchart checkpoint writer carries the run contract forward.
    assert.deepEqual(
      discarded.checkpoint.flowchart?.contract,
      investigationContract(),
      "authorizing a blocked run changes what may execute, never what the run was asked to honour"
    );

    // Resume is the execution surface, and it re-runs the target and the work
    // the operator agreed to lose.
    const resumed = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor, cluster: true },
      runId
    );
    assert.deepEqual(executor.taskIds, [ROOT_CAUSE, SUMMARY], "both re-executed; the scout did not");
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(terminals(resumed.events), ["RUN_BLOCKED", "RUN_COMPLETED"]);
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
    assert.deepEqual(
      resumed.checkpoint.flowchart?.contract,
      investigationContract(),
      "and the resumed leg still has it"
    );
  });
});

test("--discard-executed is refused when the block has nothing executed behind it, and when it names no node", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const deps = { stateRoot, router: router(), now: () => TS, generateId };

    // A gate block whose failed node has no executed descendant: the flag would
    // record a discard that discarded nothing, so it is refused rather than
    // written.
    const ordinary = await blockedRun(stateRoot, projectRoot, generateId);
    await assert.rejects(
      unblockFlowchartRun(deps, ordinary.runId, {
        reason: "belt and braces",
        retryNodeId: NODE,
        discardExecuted: true
      }),
      /no descendant of it has executed; nothing to discard; omit --discard-executed/
    );
    // And the ordinary path still ends that same block, which is the proof the
    // refusal wrote nothing that could have spent it.
    const cleared = await unblockFlowchartRun(deps, ordinary.runId, {
      reason: "retry it",
      retryNodeId: NODE
    });
    assert.equal(unblockEvents(cleared.events).length, 1);
    assert.equal(discardEvents(cleared.events).length, 0);

    // A stall block is run-level: it names no failed node, so there is no
    // consequence set for the flag to authorize.
    const stalled = await startFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId },
      {
        projectRoot,
        flowchart: compileChildrenToFlowchart([
          { taskId: parseTaskId(NODE), role: "implementer", objective: "Do the work" }
        ])
      }
    );
    assert.equal(stalled.status, "BLOCKED");
    await assert.rejects(
      unblockFlowchartRun(deps, stalled.runId, { reason: "supplied out of band", discardExecuted: true }),
      /this block names no failed node, so there is nothing to discard behind/
    );
    assert.deepEqual(
      discardEvents((await new EventStore(stateRoot, stalled.runId).readAll()).events),
      [],
      "the targetless refusal wrote nothing"
    );
  });
});

test("a crash between the appended discard authorization and its checkpoint is recovered once", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const blocked = await blockedWithExecutedDescendant(stateRoot, projectRoot, generateId);
    const { runId } = blocked;

    await unblockFlowchartRun({ stateRoot, router: router(), now: () => TS, generateId }, runId, {
      reason: "operator accepted losing the summary",
      retryNodeId: ROOT_CAUSE,
      discardExecuted: true
    });

    // The window the append-before-checkpoint order leaves open, for the
    // stronger authorization too: the event is durable, the rewound checkpoint
    // is not.
    const store = new CheckpointStore(stateRoot, runId);
    await store.write(blocked.checkpoint);
    assert.equal(
      ((await store.read()) as RunCheckpoint).flowchart?.snapshot.nodes[SUMMARY]?.state,
      "COMPLETED"
    );

    const executor = executorFailing([]);
    const recovered = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor, cluster: true },
      runId
    );
    assert.equal(recovered.status, "COMPLETED", "resume re-derived the discard the checkpoint had lost");
    assert.deepEqual(executor.taskIds, [ROOT_CAUSE, SUMMARY], "and applied it exactly once");
    assert.deepEqual(replayRun(recovered.events).anomalies, []);
    assert.deepEqual(terminals(recovered.events), ["RUN_BLOCKED", "RUN_COMPLETED"]);
    assert.deepEqual(
      recovered.checkpoint.flowchart?.contract,
      investigationContract(),
      "the recovered write carries the contract too"
    );
  });
});

/**
 * Restore recomputes the consequence set rather than trusting the list it is
 * handed. Without that, anyone who could append a row could name an unrelated
 * COMPLETED node and have the next resume rewind it — the audit record would
 * become the authorization instead of describing one.
 */
test("a discard authorization whose node list the checkpoint cannot justify fails closed", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const blocked = await blockedWithExecutedDescendant(stateRoot, projectRoot, generateId);
    const blockedEventId = blocked.events.find((event) => event.type === "RUN_BLOCKED")!.id;

    // Well-formed by the schema — it validates, it is ordered, and it claims an
    // executed prior state — but it names the scout, which is not a consequence
    // of the failed node at all.
    await new EventStore(stateRoot, blocked.runId).append({
      id: `evt_${generateId()}`,
      schemaVersion: 1,
      occurredAt: TS,
      runId: blocked.runId,
      type: "RUN_UNBLOCKED_WITH_DISCARD",
      actor: "hand-edited",
      payload: {
        blockedEventId,
        reason: "rewind something this block never touched",
        retryNodeId: ROOT_CAUSE,
        rewoundDescendants: [
          {
            nodeId: SCOUT,
            taskId: parseTaskId(SCOUT),
            previousState: "COMPLETED",
            modelRouteEventIds: [],
            childRunIds: [],
            chargedEstimatedCostUsd: 0,
            chargedEstimatedDurationMs: 0
          }
        ]
      }
    } as unknown as Event);

    await assert.rejects(
      resumeFlowchartRun(
        {
          stateRoot,
          router: router(),
          now: () => TS,
          generateId,
          executor: executorFailing([]),
          cluster: true
        },
        blocked.runId
      ),
      new RegExp(
        `authorized rewinding ${SCOUT}:${SCOUT}:COMPLETED, but this checkpoint's consequence set is ${SUMMARY}:${SUMMARY}:COMPLETED`
      )
    );
  });
});

/**
 * The gate writes each transition's `from` by reconstructing the run's status
 * from the log, separately from replay. If `currentGateStatus` did not read the
 * specialized event as clearing, this second block would record
 * `from: "BLOCKED"` — one run whose two reconstructions disagree in writing
 * about whether it was ever unblocked.
 */
test("a discard-unblocked run that fails again re-blocks from RUNNING, and the second block needs its own authorization", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const blocked = await blockedWithExecutedDescendant(stateRoot, projectRoot, generateId);
    const firstBlockId = blocked.events.find((event) => event.type === "RUN_BLOCKED")!.id;
    const deps = { stateRoot, router: router(), now: () => TS, generateId };

    await unblockFlowchartRun(deps, blocked.runId, {
      reason: "operator believes the analysis will land this time",
      retryNodeId: ROOT_CAUSE,
      discardExecuted: true
    });

    const stillFailing = executorFailing([ROOT_CAUSE]);
    const reblocked = await resumeFlowchartRun(
      { ...deps, executor: stillFailing, cluster: true },
      blocked.runId
    );
    assert.equal(reblocked.status, "BLOCKED");
    assert.deepEqual(
      reblocked.events
        .filter((event) => event.type === "GATE_TRANSITION")
        .map((event) => ({ from: event.payload.from, to: event.payload.to })),
      [
        { from: "RUNNING", to: "BLOCKED" },
        { from: "RUNNING", to: "BLOCKED" }
      ],
      "the gate saw the specialized event clear the first block"
    );
    assert.deepEqual(terminals(reblocked.events), ["RUN_BLOCKED", "RUN_BLOCKED"]);
    assert.deepEqual(replayRun(reblocked.events).anomalies, []);

    // The first authorization is spent; the new block is a new one to clear.
    // The summary re-ran and completed again, so the second block carries the
    // same executed descendant and needs the same strength of authorization —
    // the flag is per-block permission, not a mode the run stays in.
    const active = replayRun(reblocked.events).activeBlockedEventId;
    assert.notEqual(active, firstBlockId);
    await assert.rejects(
      unblockFlowchartRun(deps, blocked.runId, {
        reason: "escalated to a human reviewer",
        retryNodeId: ROOT_CAUSE
      }),
      new RegExp(`${SUMMARY} already executed`)
    );
    const second = await unblockFlowchartRun(deps, blocked.runId, {
      reason: "escalated to a human reviewer",
      retryNodeId: ROOT_CAUSE,
      discardExecuted: true
    });
    assert.equal(unblockEvents(second.events).length, 0);
    assert.deepEqual(
      discardEvents(second.events).map((event) => event.payload.blockedEventId),
      [firstBlockId, active],
      "each authorization names the block it actually cleared"
    );
    assert.deepEqual(replayRun(second.events).anomalies, []);
  });
});
