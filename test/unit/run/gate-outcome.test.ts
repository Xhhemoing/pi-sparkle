import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import {
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { Event } from "../../../src/run/events.js";
import {
  injectFlowchartRun,
  resumeFlowchartRun,
  startFlowchartRun
} from "../../../src/run/flowchart-run.js";
import { replayRun, TERMINAL_REPLAY_STATUSES } from "../../../src/run/replay.js";
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

/** A child that did the work and reported it, but whose verification failed. */
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
      summary: "the child finished and verification agreed",
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

/** An executor that never reports a result, so the node fails with no gate assessment. */
const failingExecutor: AgentExecutor = {
  async *execute(_request: AgentExecutionRequest, _signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
  }
};

async function withRoots(body: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-gate-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-gate-proj-"));
  try {
    await body(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function deps(stateRoot: string, executor: AgentExecutor) {
  return { stateRoot, router: router(), now: () => TS, generateId: sequenceGenerator(), executor };
}

function childSpec(taskId: string): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(taskId),
    role: "implementer",
    objective: `Do ${taskId}`,
    profile: registry.resolve("implementer"),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

/** The reviewer's seed: one clustered node, driven through `compileChildrenToFlowchart`. */
function oneNodeRun(stateRoot: string, projectRoot: string, executor: AgentExecutor) {
  const spec = childSpec("tsk_verify");
  return startFlowchartRun(deps(stateRoot, executor), {
    projectRoot,
    flowchart: compileChildrenToFlowchart([
      { taskId: spec.taskId, role: "implementer", objective: spec.objective }
    ]),
    childTasks: [spec]
  });
}

function terminals(events: readonly Event[]): Event["type"][] {
  return events
    .map((event) => event.type)
    .filter((type) => type === "RUN_COMPLETED" || type === "RUN_FAILED" || type === "RUN_BLOCKED");
}

test("a verification-failed clustered child ends BLOCKED with the analysis queued", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await oneNodeRun(stateRoot, projectRoot, executorYielding(verificationFailedResult));

    assert.equal(
      outcome.status,
      "BLOCKED",
      "the gate's queue_analysis decides the run's terminal, not the node's failure"
    );
    assert.equal(outcome.checkpoint.status, "BLOCKED", "the durable resume point agrees with the log");

    // The decided log shape for the verification-failed case, pinned end to end.
    assert.deepEqual(
      outcome.events.map((event) => event.type).slice(-5),
      ["TRACKING_ASSESSMENT", "GATE_TRANSITION", "RUN_BLOCKED", "LEDGER_UPDATED", "EPISODE_WAITING"],
      "assess, transition, block, ledger, and an episode left waiting"
    );

    const transition = outcome.events.find((event) => event.type === "GATE_TRANSITION");
    assert.equal((transition?.payload as { directive: string } | undefined)?.directive, "queue_analysis");
    assert.equal((transition?.payload as { to: string } | undefined)?.to, "BLOCKED");

    const blocked = outcome.events.find((event) => event.type === "RUN_BLOCKED");
    assert.equal(
      (blocked?.payload as { reason: string } | undefined)?.reason,
      "ANALYSIS_QUEUED",
      "the block carries the gate's reason, not the stall detector's"
    );
    assert.deepEqual(
      (blocked?.payload as { requiredEvidence: string[] } | undefined)?.requiredEvidence,
      ["evd_vf-tsk_verify"],
      "the queued analysis names the evidence the operator owes"
    );

    assert.deepEqual(terminals(outcome.events), ["RUN_BLOCKED"], "exactly one terminal event");
    assert.deepEqual(
      replayRun(outcome.events).anomalies,
      [],
      "a production-ordinary log must not replay as anomalous"
    );
  });
});

test("the blocked run stays operator-actionable: episode waiting, injectable, no failure", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await oneNodeRun(stateRoot, projectRoot, executorYielding(verificationFailedResult));

    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_WAITING"),
      true,
      "the bound episode is left waiting for the operator"
    );
    assert.equal(
      outcome.events.some((event) => event.type === "EPISODE_CLOSED"),
      false,
      "nothing closed the episode behind a queued analysis"
    );

    // The state the old RUN_FAILED buried: an operator can still act on this run.
    const injected = await injectFlowchartRun({ stateRoot, router: router(), now: () => TS }, outcome.runId, {
      kind: "fact",
      actor: "operator",
      key: "analysis",
      value: "reviewed"
    });
    assert.equal(injected.status, "BLOCKED", "injecting into a blocked run does not move its terminal");
    assert.deepEqual(terminals(injected.events), ["RUN_BLOCKED"], "still exactly one terminal event");
    assert.deepEqual(replayRun(injected.events).anomalies, []);
  });
});

test("resuming the blocked run repeats the block rather than burying it in a failure", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await oneNodeRun(stateRoot, projectRoot, executorYielding(verificationFailedResult));
    assert.equal(outcome.status, "BLOCKED");

    const afterBlock = executorYielding(verificationFailedResult);
    const resumed = await resumeFlowchartRun(deps(stateRoot, afterBlock), outcome.runId);

    assert.equal(resumed.status, "BLOCKED", "resume reports the state the log already replays");
    assert.deepEqual(terminals(resumed.events), ["RUN_BLOCKED"], "resume adds no second terminal");
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
    assert.equal(
      resumed.events.some((event) => event.type === "RUN_FAILED"),
      false,
      "the node is still FAILED in the supervisor, and the log still says BLOCKED"
    );
  });
});

test("a node that fails without a gate block still records RUN_FAILED", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await oneNodeRun(stateRoot, projectRoot, failingExecutor);

    // The negative control for the refusal above: it is keyed on the terminal the
    // log already replays, not on "a failed node never fails the run".
    assert.equal(outcome.status, "FAILED");
    assert.deepEqual(terminals(outcome.events), ["RUN_FAILED"]);
    assert.equal(
      outcome.events.some((event) => event.type === "GATE_TRANSITION"),
      false,
      "no result reached the gate, so nothing blocked the run"
    );
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
  });
});

test("a verification-passed clustered child still completes", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await oneNodeRun(stateRoot, projectRoot, executorYielding(passingResult));

    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(terminals(outcome.events), ["RUN_COMPLETED"]);
    assert.deepEqual(replayRun(outcome.events).anomalies, []);
  });
});

test("the loop's refusal and replay's anomaly rule read the same terminal set", () => {
  // Source pin: if one side learns a new terminal status, the other must too, or
  // the loop starts writing logs its own replay flags.
  assert.deepEqual([...TERMINAL_REPLAY_STATUSES].toSorted(), ["BLOCKED", "COMPLETED", "FAILED"]);
});
