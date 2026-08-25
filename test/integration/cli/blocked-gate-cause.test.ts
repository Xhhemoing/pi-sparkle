import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { formatBlockedRunReport, main, type CliIo } from "../../../src/cli/main.js";
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
import { SUPERVISOR, type CriterionVerification } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startFlowchartRun, type FlowchartRunOutcome } from "../../../src/run/flowchart-run.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

/**
 * What blocked the run, said out loud.
 *
 * The production-ordinary block writes `RUN_BLOCKED { reason: ANALYSIS_QUEUED }`
 * — the queue it was filed under — while the anomaly sits on
 * `GATE_TRANSITION.payload.reasonCode`, the failed dimensions sit on
 * `TRACKING_ASSESSMENT`, and the criterion the child said it did not meet sits
 * on that child's own terminal `CHILD_MESSAGE`. Every one of those is durable
 * and validated; none of them reached an operator through `inspect`, `list`,
 * `unblock` or the blocked report, so diagnosing the ordinary block meant
 * opening `events.jsonl` by hand.
 *
 * These cases measure the read-side fix end to end against a real gate-written
 * log: the run is the `unmet-acceptance-criterion` shape from
 * `test/integration/run/criteria-gate.test.ts` — a child that reports the task
 * PASSED and one acceptance criterion FAILED — driven through
 * `startFlowchartRun` and then read back through the shipped verb.
 *
 * Two things must stay exactly as they were, and both are asserted here rather
 * than assumed: the machine-readable `--summary-json` is still the frozen four
 * keys, and the blocked report's four routed lines keep their wording and their
 * order with the cause note added beside them.
 */

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-25T09:00:00.000Z");
const NODE = "tsk_migrate";
const DETERMINISTIC_NODE = "tsk_verify";
const CRITERION = "ac_no_regression";
const CRITERION_EVIDENCE = "evd_criterion_suite" as EvidenceId;
const TASK_EVIDENCE = "evd_task_run" as EvidenceId;

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out,
    err
  };
}

async function withRoots(body: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-gate-cause-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-gate-cause-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await withIsolatedPiEnv(() => body(stateRoot, projectRoot));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
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
 * The child from the criteria-gate fixture: the task passed, one criterion did
 * not, and the summary is deliberately not a success boast so no second code
 * joins the one under test.
 */
function reportingExecutor(criteria: readonly CriterionVerification[]): AgentExecutor {
  return {
    async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
      if (signal.aborted) {
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
        return;
      }
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: `msg_cause-${request.agentInstanceId}` as MessageId,
          occurredAt: TS,
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "TASK_RESULT",
          outcome: "SUCCESS",
          summary: "the migration landed and the child reported on each criterion it was given",
          artifactIds: [`art_cause-${request.taskId}` as ArtifactId],
          evidenceIds: [TASK_EVIDENCE],
          verification: {
            kind: "PASSED",
            evidenceIds: [TASK_EVIDENCE],
            criteria: criteria.map((entry) => ({ ...entry }))
          }
        }
      };
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
    }
  };
}

/**
 * The other production-ordinary block: a child that reports SUCCESS against a
 * verification that FAILED. The gate reads that as `deterministic-fail`, which
 * is the code most operators will actually meet — the criterion shape above
 * needs a child that reports per-criterion outcomes at all.
 */
const verificationFailedExecutor: AgentExecutor = {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_det-${request.agentInstanceId}` as MessageId,
        occurredAt: TS,
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "the child reported success; verification did not agree",
        artifactIds: [`art_det-${request.taskId}` as ArtifactId],
        evidenceIds: [TASK_EVIDENCE],
        verification: { kind: "FAILED", evidenceIds: [TASK_EVIDENCE] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
};

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

/** The run an operator meets: BLOCKED by one criterion the child reported unmet. */
async function blockedByCriterion(
  stateRoot: string,
  projectRoot: string
): Promise<FlowchartRunOutcome> {
  const spec = childSpec(NODE);
  const outcome = await startFlowchartRun(
    {
      stateRoot,
      router: router(),
      now: () => TS,
      executor: reportingExecutor([
        { id: CRITERION, kind: "FAILED", evidenceIds: [CRITERION_EVIDENCE] }
      ]),
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
  assert.equal(outcome.status, "BLOCKED", "the gate decides the terminal for this shape");
  return outcome;
}

/** The same operator, meeting the block a failed verification files. */
async function blockedByDeterministicFail(
  stateRoot: string,
  projectRoot: string
): Promise<FlowchartRunOutcome> {
  const spec = childSpec(DETERMINISTIC_NODE);
  const outcome = await startFlowchartRun(
    {
      stateRoot,
      router: router(),
      now: () => TS,
      executor: verificationFailedExecutor,
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
  assert.equal(outcome.status, "BLOCKED", "a failed verification blocks the run too");
  return outcome;
}

test("inspect names the anomaly the gate recorded, and the criterion behind it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const blocked = await blockedByCriterion(stateRoot, projectRoot);

    const inspected = capture();
    const code = await main(
      ["inspect", "--run", blocked.runId, "--state-root", stateRoot],
      inspected.io
    );
    assert.equal(code, 0, inspected.err.join(""));
    const out = inspected.out.join("");

    // The half `reason: ANALYSIS_QUEUED` never told anyone. The code is read off
    // GATE_TRANSITION, the kind off the assessment it cites, and the criterion
    // off the child's own verdict.
    assert.match(
      out,
      /^ {2}gate cause: unmet-acceptance-criterion \(hard gate, turn tsk_migrate\)$/m,
      out
    );
    assert.match(
      out,
      /^ {2}gate unmet criterion: ac_no_regression \(evidence: evd_criterion_suite\)$/m,
      out
    );

    // Additive: the lines that were there before are still there, unchanged.
    assert.match(out, new RegExp(`^Run ${blocked.runId}: BLOCKED \\(\\d+ events\\)$`, "m"), out);
    assert.match(out, /^ {2}required evidence \(\d+\):$/m, out);
    assert.match(out, /^ {4}- evd_criterion_suite$/m, out);
  });
});

test("the frozen --summary-json keys do not move when the prose gains a cause", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const blocked = await blockedByCriterion(stateRoot, projectRoot);

    const json = capture();
    const code = await main(
      ["inspect", "--run", blocked.runId, "--state-root", stateRoot, "--summary-json"],
      json.io
    );
    assert.equal(code, 0, json.err.join(""));
    const lines = json.out.join("").trim().split("\n");
    assert.equal(lines.length, 1, "JSON mode stdout is exactly one object");
    const summary = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(summary),
      ["type", "runId", "status", "requiredEvidence"],
      "the gate cause is prose; a machine-readable field would be a fifth key with its own pins"
    );
    assert.equal(summary.status, "BLOCKED");
    assert.ok(!("gateCause" in summary), "and it did not arrive under another name");
  });
});

test("a run the gate did not block prints no gate cause", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const spec = childSpec(NODE);
    const completed = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        executor: reportingExecutor([
          { id: CRITERION, kind: "PASSED", evidenceIds: [CRITERION_EVIDENCE] }
        ]),
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
    assert.equal(completed.status, "COMPLETED", "the control from the criteria-gate fixture");

    const inspected = capture();
    const code = await main(
      ["inspect", "--run", completed.runId, "--state-root", stateRoot],
      inspected.io
    );
    assert.equal(code, 0, inspected.err.join(""));
    assert.ok(!inspected.out.join("").includes("gate cause:"), inspected.out.join(""));
    assert.equal(formatBlockedRunReport(completed.runId, stateRoot, completed.events).includes("ANALYSIS_QUEUED"), false);
  });
});

test("the blocked report adds the cause as a note and leaves the four routed lines alone", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const blocked = await blockedByCriterion(stateRoot, projectRoot);
    const report = formatBlockedRunReport(blocked.runId, stateRoot, blocked.events);

    // Unchanged: the payload's own word, still printed verbatim.
    assert.match(report, /^ {2}reason: ANALYSIS_QUEUED$/m, report);

    // Added: the cause, on a note, naming the same code the log carries — and
    // saying that the word above it is a verdict rather than work in progress.
    assert.match(
      report,
      /^ {2}note: ANALYSIS_QUEUED is the tracking gate's verdict, not a running job — the gate recorded unmet-acceptance-criterion on turn tsk_migrate; no analysis consumer is wired and nothing dequeues this block, so unblock is still what clears it, and inspect prints the failed dimensions and any unmet criteria the gate recorded$/m,
      report
    );

    // The criterion itself is inspect's to print. Repeating it here would put
    // the diagnostics in the routing block and make the note grow with the
    // assessment.
    assert.ok(!report.includes("ac_no_regression"), report);

    // The freeze `blocked-next.test.ts` holds: the four an operator works
    // through, byte-for-byte, in order, as the prefix of the routed block, with
    // exactly three of them `next:`.
    const routed = report
      .split("\n")
      .filter((line) => line.startsWith("  next: ") || line.startsWith("  note: "));
    assert.deepEqual(
      routed.slice(0, 4),
      [
        `  next: pnpm cli inspect --run ${blocked.runId} --state-root ${stateRoot}`,
        `  next: pnpm cli inject --run ${blocked.runId} --type fact --key <key> --value <text> --state-root ${stateRoot}`,
        `  next: pnpm cli unblock --run ${blocked.runId} --reason <text> [--retry-node <nodeId>] --state-root ${stateRoot}`,
        `  note: resume alone replays BLOCKED — unblock is the event that clears this log, so run unblock first, then pnpm cli resume --run ${blocked.runId} --state-root ${stateRoot} executes the reopened work`
      ],
      report
    );
    assert.equal(routed.filter((line) => line.startsWith("  next: ")).length, 3, report);
    assert.equal(routed.length, 6, "the discard disclosure and the cause, and nothing else, follow");
  });
});

/**
 * The other half of the production surface. `unmet-acceptance-criterion` needs
 * a child that reports per-criterion outcomes; `deterministic-fail` is what an
 * ordinary child that claims success against a failed verification produces, so
 * it is the code most blocks carry and the one nothing asserted end to end.
 */
test("inspect and the blocked note name deterministic-fail on the verification-failed block", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const blocked = await blockedByDeterministicFail(stateRoot, projectRoot);

    const inspected = capture();
    const code = await main(
      ["inspect", "--run", blocked.runId, "--state-root", stateRoot],
      inspected.io
    );
    assert.equal(code, 0, inspected.err.join(""));
    const out = inspected.out.join("");

    assert.match(
      out,
      /^ {2}gate cause: deterministic-fail \(hard gate, turn tsk_verify\)$/m,
      out
    );
    // No criterion was reported, so the criterion line is absent rather than
    // rendered empty — the child spoke about the task only.
    assert.ok(!out.includes("gate unmet criterion:"), out);

    // The dimensions the gate scored FAIL are the diagnostics the blocked note
    // routes to, so they have to be here: a child claiming success against a
    // failed verification is exactly an evidence-consistency failure.
    assert.match(out, /^ {2}gate failed dimensions: evidence-consistency$/m, out);

    const report = formatBlockedRunReport(blocked.runId, stateRoot, blocked.events);
    assert.match(
      report,
      /^ {2}note: ANALYSIS_QUEUED is the tracking gate's verdict, not a running job — the gate recorded deterministic-fail on turn tsk_verify; no analysis consumer is wired and nothing dequeues this block, so unblock is still what clears it, and inspect prints the failed dimensions and any unmet criteria the gate recorded$/m,
      report
    );
  });
});
