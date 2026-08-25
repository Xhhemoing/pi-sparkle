import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { parseTaskId, type ArtifactId, type EvidenceId, type MessageId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR, type CriterionVerification } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { Event } from "../../../src/run/events.js";
import {
  resumeFlowchartRun,
  startFlowchartRun,
  unblockFlowchartRun,
  type FlowchartRunOutcome
} from "../../../src/run/flowchart-run.js";
import { replayRun, replayedTerminalStatus } from "../../../src/run/replay.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";

/**
 * Production reachability for `unmet-acceptance-criterion` (Loop 4 R11-1's
 * option (a)), the measured-reachability analogue R9-2 built for the verdict
 * tool.
 *
 * The channel is already covered a layer at a time — the gate's ordering and
 * all-roles blocking in `test/unit/tracking/gates.test.ts`, the producer in
 * `test/unit/pi-adapter/report-task-result.test.ts`, the persisted rows in the
 * event fuzz. What none of those show is the thing an operator actually meets:
 * a whole run that a single reported criterion put on the floor. That is what
 * these cases measure, end to end and in one process — a child reports the
 * task PASSED and one acceptance criterion FAILED, and the *run* lands BLOCKED
 * with that code stamped on its `GATE_TRANSITION`, then leaves by the
 * sanctioned `unblock` door.
 *
 * No loopback server and no live provider: a test executor's terminal
 * `verification` reaches the gate through `child-tracking.ts`'s wholesale
 * spread of the child's verdict, which is the same path a pi child's
 * `sparkle_report_task_result` takes.
 *
 * The control carries as much weight as the block. The same run shape, changed
 * in exactly one field — the criterion PASSED, the criterion UNOBSERVED, the
 * array omitted — completes. Without that, "the run blocked" would be evidence
 * about the fixture rather than about the channel.
 */

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-25T09:00:00.000Z");

/** `compileChildrenToFlowchart` uses the task id as the node id, so this is both. */
const NODE = "tsk_migrate";

const CRITERION = "ac_no_regression";
/** Cited by the criterion itself — the reference the anomaly has to stay auditable to. */
const CRITERION_EVIDENCE = "evd_criterion_suite" as EvidenceId;
/** Cited by the whole-task verdict, which is PASSED throughout this file. */
const TASK_EVIDENCE = "evd_task_run" as EvidenceId;

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

/**
 * A child that finished its task, says so, and reports per-criterion outcomes.
 *
 * The summary is deliberately not a success boast: `isSuccessClaim` matches
 * prose like "passed", and a match would recruit `evidence-consistency` and
 * `claimed-verification-without-checks` into the result. Keeping it plain
 * leaves exactly one thing that can differ between the block and its controls.
 */
function passedResult(criteria?: readonly CriterionVerification[]) {
  return (request: AgentExecutionRequest): ExecutionEvent => ({
    type: "MESSAGE",
    message: {
      protocolVersion: 1,
      id: `msg_criteria-${request.agentInstanceId}` as MessageId,
      occurredAt: TS,
      runId: request.runId,
      taskId: request.taskId,
      from: request.agentInstanceId,
      to: SUPERVISOR,
      type: "TASK_RESULT",
      outcome: "SUCCESS",
      summary: "the migration landed and the child reported on each criterion it was given",
      artifactIds: [`art_criteria-${request.taskId}` as ArtifactId],
      evidenceIds: [TASK_EVIDENCE],
      verification: {
        kind: "PASSED",
        evidenceIds: [TASK_EVIDENCE],
        ...(criteria !== undefined ? { criteria: criteria.map((entry) => ({ ...entry })) } : {})
      }
    }
  });
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
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-criteria-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-criteria-proj-"));
  try {
    await body(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/**
 * The child spec carries no `acceptanceCriteria` and the role is `implementer`
 * on purpose. Only a tester's asked-for criteria become `requiredChecks`
 * (`child-tracking.ts`), so this shape has none — which means the gate here is
 * reading what the child *reported*, with nothing request-derived left that
 * could be doing the work instead.
 */
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

/** One clustered child, driven by whatever verdict the caller's executor reports. */
async function runReporting(
  stateRoot: string,
  projectRoot: string,
  generateId: () => string,
  executor: AgentExecutor
): Promise<FlowchartRunOutcome> {
  const spec = childSpec(NODE);
  return startFlowchartRun(
    { stateRoot, router: router(), now: () => TS, generateId, executor, cluster: true },
    {
      projectRoot,
      flowchart: compileChildrenToFlowchart([
        { taskId: spec.taskId, role: "implementer", objective: spec.objective }
      ]),
      childTasks: [spec]
    }
  );
}

function terminals(events: readonly Event[]): Event["type"][] {
  return events
    .map((event) => event.type)
    .filter((type) => type === "RUN_COMPLETED" || type === "RUN_FAILED" || type === "RUN_BLOCKED");
}

function gateTransitions(events: readonly Event[]): Extract<Event, { type: "GATE_TRANSITION" }>[] {
  return events.filter((event) => event.type === "GATE_TRANSITION");
}

function assessments(events: readonly Event[]): Extract<Event, { type: "TRACKING_ASSESSMENT" }>[] {
  return events.filter((event) => event.type === "TRACKING_ASSESSMENT");
}

/** What the child's terminal TASK_RESULT durably says about its criteria. */
function reportedCriteria(events: readonly Event[]): readonly CriterionVerification[] | undefined {
  for (const event of events) {
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type === "TASK_RESULT") return message.verification.criteria;
  }
  return undefined;
}

test("a child that reports the task PASSED with one FAILED criterion blocks the run, and unblock ends it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const reporting = executorYielding(
      passedResult([{ id: CRITERION, kind: "FAILED", evidenceIds: [CRITERION_EVIDENCE] }])
    );
    const blocked = await runReporting(stateRoot, projectRoot, generateId, reporting);

    // The node succeeded: this run is not blocked by a failure anywhere in the
    // flowchart plane. The whole-task verdict agreed with the child, the state
    // machine completed the node, and the block came from the one criterion.
    assert.deepEqual(reporting.taskIds, [NODE]);
    assert.equal(blocked.snapshot.nodes[NODE]?.state, "COMPLETED");
    assert.equal(blocked.status, "BLOCKED", "the run itself, not just the assessment");
    assert.deepEqual(terminals(blocked.events), ["RUN_BLOCKED"]);
    assert.equal(replayedTerminalStatus(blocked.events), "BLOCKED");
    assert.deepEqual(replayRun(blocked.events).anomalies, []);

    // The criterion rode the child's verdict onto the log, whole.
    assert.deepEqual(reportedCriteria(blocked.events), [
      { id: CRITERION, kind: "FAILED", evidenceIds: [CRITERION_EVIDENCE] }
    ]);

    // Exactly one code fired, and it is the one this channel exists for. If
    // anything else had also fired it would sit ahead of this in `gates.ts`'s
    // order and stamp the transition instead, so the assertion below would be
    // reading a different mechanism's reason code.
    const assessment = assessments(blocked.events);
    assert.equal(assessment.length, 1);
    assert.equal(assessment[0]?.payload.assessment.gate.kind, "hard");
    assert.deepEqual(assessment[0]?.payload.assessment.gate.codes, ["unmet-acceptance-criterion"]);

    const transitions = gateTransitions(blocked.events);
    assert.equal(transitions.length, 1);
    const transition = transitions[0];
    assert.ok(transition !== undefined);
    assert.equal(transition.payload.reasonCode, "unmet-acceptance-criterion");
    assert.equal(transition.payload.from, "RUNNING");
    assert.equal(transition.payload.to, "BLOCKED");
    assert.equal(transition.payload.directive, "queue_analysis");
    assert.equal(transition.payload.turnId, NODE, "the transition names the child it blocked on");
    assert.ok(
      transition.payload.evidenceRefs.includes(CRITERION_EVIDENCE),
      "the criterion's own evidence is on the record the block cites"
    );

    // The sanctioned exit. This block names no failed node — the task passed —
    // so it takes no retry target, and asking for one is refused by the
    // transform rather than half-applied.
    const deps = { stateRoot, router: router(), now: () => TS, generateId };
    await assert.rejects(
      unblockFlowchartRun(deps, blocked.runId, { reason: "operator waived it", retryNodeId: NODE }),
      /cannot reopen node tsk_migrate in state COMPLETED: only a FAILED node can be re-driven/
    );

    const blockedEventId = replayRun(blocked.events).activeBlockedEventId;
    const unblocked = await unblockFlowchartRun(deps, blocked.runId, {
      reason: "operator reviewed the unmet criterion and accepted the gap"
    });
    assert.equal(unblocked.status, "RUNNING");
    assert.equal(replayedTerminalStatus(unblocked.events), undefined, "the refusal above wrote nothing");
    const authorizations = unblocked.events.filter((event) => event.type === "RUN_UNBLOCKED");
    assert.equal(authorizations.length, 1);
    assert.deepEqual(authorizations[0]?.payload, {
      blockedEventId,
      reason: "operator reviewed the unmet criterion and accepted the gap"
    });

    // And the run ends. Nothing was left to execute — the block, not unfinished
    // work, was the only thing between this run and its terminal.
    const afterUnblock = executorYielding(passedResult());
    const resumed = await resumeFlowchartRun(
      { stateRoot, router: router(), now: () => TS, generateId, executor: afterUnblock, cluster: true },
      blocked.runId
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.deepEqual(afterUnblock.taskIds, [], "a completed node is not re-driven by an unblock");
    assert.deepEqual(terminals(resumed.events), ["RUN_BLOCKED", "RUN_COMPLETED"]);
    assert.equal(replayedTerminalStatus(resumed.events), "COMPLETED");
    assert.deepEqual(replayRun(resumed.events).anomalies, []);
  });
});

/**
 * The control, in the three shapes that must not block.
 *
 * Each arm is the run above with one field changed, so a completion here is
 * what makes the block attributable to the reported FAILED rather than to the
 * fixture, to clustering, or to the presence of a `criteria` array at all.
 *
 * The last two arms are also the frozen unknown-is-not-unmet rule seen from
 * production: an `UNOBSERVED` criterion says the verifier did not look, an
 * absent array says it spoke only about the task as a whole, and neither is
 * the child saying it fell short.
 */
for (const arm of [
  {
    name: "the criterion PASSED",
    criteria: [{ id: CRITERION, kind: "PASSED", evidenceIds: [CRITERION_EVIDENCE] }] as CriterionVerification[]
  },
  {
    name: "the criterion UNOBSERVED",
    criteria: [{ id: CRITERION, kind: "UNOBSERVED", evidenceIds: [] }] as CriterionVerification[]
  },
  { name: "the criteria array omitted", criteria: undefined }
]) {
  test(`the same run completes when ${arm.name}`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const generateId = sequenceGenerator();
      const reporting = executorYielding(passedResult(arm.criteria));
      const completed = await runReporting(stateRoot, projectRoot, generateId, reporting);

      assert.deepEqual(reporting.taskIds, [NODE], "the same child ran the same once");
      assert.equal(completed.snapshot.nodes[NODE]?.state, "COMPLETED");
      assert.equal(completed.status, "COMPLETED");
      assert.deepEqual(terminals(completed.events), ["RUN_COMPLETED"]);
      assert.deepEqual(replayRun(completed.events).anomalies, []);
      assert.deepEqual(reportedCriteria(completed.events), arm.criteria);

      // Not "the gate never looked": it assessed the same child through the
      // same path and returned no directive, so there is no transition to
      // stamp. An arm that stopped reaching the gate would pass the assertions
      // above while proving nothing about the criterion.
      const assessment = assessments(completed.events);
      assert.equal(assessment.length, 1);
      assert.equal(assessment[0]?.payload.assessment.gate.kind, "none");
      assert.deepEqual(assessment[0]?.payload.assessment.gate.codes, []);
      assert.deepEqual(gateTransitions(completed.events), []);
    });
  });
}
