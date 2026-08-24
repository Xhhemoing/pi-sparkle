import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createClusterHost } from "../../../src/cluster/host.js";
import { DEFAULT_MAX_ROLE_REQUEUES } from "../../../src/cluster/mailbox.js";
import { formatUndeliveredClusterMail } from "../../../src/cli/main.js";
import {
  createAgentInstanceId,
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId
} from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startParentRun, summarizeClusterMail } from "../../../src/run/coordinator.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";

const registry = createAgentProfileRegistry(defaultAgentProfiles());

/**
 * A scout that role-casts to its own role. The mailbox never hands a sender its
 * own role-cast mail, so unless a second scout registers the message can never
 * be delivered — the starvation R3-7 made reportable.
 */
class SelfCastExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (request.prompt.includes("Role: scout")) {
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: `msg_cast-${request.agentInstanceId}` as MessageId,
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "PEER_MESSAGE",
          body: "any other scout on this?",
          addressRole: "scout"
        }
      };
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_done-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "fake child completed the task",
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** Same executor, but the cast goes to a role a later child actually holds. */
class DeliveredCastExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (request.prompt.includes("Role: scout")) {
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: `msg_cast-${request.agentInstanceId}` as MessageId,
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "PEER_MESSAGE",
          body: "found src/parser.ts",
          addressRole: "implementer"
        }
      };
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_done-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "fake child completed the task",
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

function child(id: string, role: "scout" | "implementer", dependsOn?: string): ChildTaskInput {
  return {
    taskId: parseTaskId(`tsk_${id}`),
    role,
    objective: `Do ${id}`,
    profile: registry.resolve(role),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 },
    ...(dependsOn !== undefined ? { dependsOn: [parseTaskId(`tsk_${dependsOn}`)] } : {})
  };
}

function twoModelRouter() {
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

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-deadletter-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-deadletter-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("a starved role-cast reaches the parent run's outcome and the operator line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await startParentRun(
      { stateRoot, executor: new SelfCastExecutor(), registry, cluster: true },
      { projectRoot, objective: "Survey the parser", children: [child("scout", "scout")] }
    ).done;

    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(outcome.clusterMail, {
      pending: 1,
      pendingByRole: [{ role: "scout", count: 1 }],
      deadLettered: 0,
      deadLetteredByRole: [],
      deadLetteredByReason: []
    });
    assert.equal(
      formatUndeliveredClusterMail(outcome.clusterMail),
      "warning: cluster role-cast mail undelivered: pending=1 (scout=1), dead-lettered=0\n"
    );
  });
});

test("a starved role-cast reaches the flowchart run's outcome and the operator line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const children = [child("scout", "scout")];
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: twoModelRouter(),
        executor: new SelfCastExecutor(),
        registry,
        cluster: true
      },
      {
        projectRoot,
        flowchart: compileChildrenToFlowchart(
          children.map((entry) => ({
            taskId: entry.taskId,
            role: "scout" as const,
            objective: entry.objective
          }))
        ),
        objective: "Survey the parser",
        childTasks: children
      }
    );

    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(outcome.clusterMail, {
      pending: 1,
      pendingByRole: [{ role: "scout", count: 1 }],
      deadLettered: 0,
      deadLetteredByRole: [],
      deadLetteredByReason: []
    });
    assert.equal(
      formatUndeliveredClusterMail(outcome.clusterMail),
      "warning: cluster role-cast mail undelivered: pending=1 (scout=1), dead-lettered=0\n"
    );
  });
});

test("a cluster run that delivers its peer mail reports nothing and prints no line", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await startParentRun(
      { stateRoot, executor: new DeliveredCastExecutor(), registry, cluster: true },
      {
        projectRoot,
        objective: "Ship the parser",
        children: [child("scout", "scout"), child("impl", "implementer", "scout")]
      }
    ).done;

    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(outcome.clusterMail, {
      pending: 0,
      pendingByRole: [],
      deadLettered: 0,
      deadLetteredByRole: [],
      deadLetteredByReason: []
    });
    assert.equal(formatUndeliveredClusterMail(outcome.clusterMail), undefined);
  });
});

test("a run without a cluster carries no mail report", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const outcome = await startParentRun(
      { stateRoot, executor: new DeliveredCastExecutor(), registry },
      { projectRoot, objective: "Ship the parser", children: [child("impl", "implementer")] }
    ).done;

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.clusterMail, undefined);
    assert.equal(formatUndeliveredClusterMail(outcome.clusterMail), undefined);
  });
});

/**
 * The dead-letter half of the summary, driven straight at the host: a drop
 * needs the *same* agent id to re-register past the requeue bound, and
 * `ChildCoordinator` mints a fresh id per attempt, so no run can produce one
 * today (see loop4-r4-t2.md). The consumer still has to read it.
 */
test("dead letters from the host surface in the same summary and line", () => {
  const host = createClusterHost({ registry, onSpawn: () => {} });
  const lonely = createAgentInstanceId();
  const task = parseTaskId("tsk_lonely");
  host.register(lonely, "reviewer", task);
  host.send({ from: lonely, body: "anyone reviewing?", addressRole: "reviewer" });
  for (let claim = 0; claim <= DEFAULT_MAX_ROLE_REQUEUES; claim += 1) {
    host.register(lonely, "reviewer", task);
  }

  assert.equal(host.deadLetterReport().total, 1);
  assert.deepEqual(summarizeClusterMail(host), {
    pending: 0,
    pendingByRole: [],
    deadLettered: 1,
    deadLetteredByRole: [{ role: "reviewer", count: 1 }],
    deadLetteredByReason: [{ reason: "requeue-limit", count: 1 }]
  });
  assert.equal(
    formatUndeliveredClusterMail(summarizeClusterMail(host)),
    "warning: cluster role-cast mail undelivered: pending=0, dead-lettered=1 (reviewer=1; requeue-limit=1)\n"
  );
});

test("pending and dead-lettered mail share one line, counts ordered by size then role", () => {
  const host = createClusterHost({ registry, onSpawn: () => {} });
  const reviewer = createAgentInstanceId();
  host.register(reviewer, "reviewer", parseTaskId("tsk_reviewer"));
  host.send({ from: reviewer, body: "anyone reviewing?", addressRole: "reviewer" });
  for (let claim = 0; claim <= DEFAULT_MAX_ROLE_REQUEUES; claim += 1) {
    host.register(reviewer, "reviewer", parseTaskId("tsk_reviewer"));
  }
  const scout = createAgentInstanceId();
  host.register(scout, "scout", parseTaskId("tsk_scout"));
  host.send({ from: scout, body: "scout one", addressRole: "scout" });
  host.send({ from: scout, body: "scout two", addressRole: "scout" });
  const tester = createAgentInstanceId();
  host.register(tester, "tester", parseTaskId("tsk_tester"));
  host.send({ from: tester, body: "tester one", addressRole: "tester" });

  assert.equal(
    formatUndeliveredClusterMail(summarizeClusterMail(host)),
    "warning: cluster role-cast mail undelivered: pending=3 (scout=2, tester=1), dead-lettered=1 (reviewer=1; requeue-limit=1)\n"
  );
});

/**
 * The CLI has no seam to inject a peer-mail executor (`--children` and
 * `--track` build their own fake), so this pins the two summary paths that must
 * print the line instead: deleting either call fails here.
 */
test("both CLI run-summary paths warn about undelivered cluster mail", async () => {
  const mainPath = join(dirname(fileURLToPath(import.meta.url)), "../../../src/cli/main.ts");
  const source = await readFile(mainPath, "utf8");
  const calls = source.match(/warnUndeliveredClusterMail\(io, /g) ?? [];
  assert.equal(calls.length, 2, "flowchart/children summary and --track summary both warn");
  const flowchartSummary = source.match(
    /function printFlowchartOutcome\([\s\S]*?\n}\n/
  )?.[0];
  assert.ok(flowchartSummary !== undefined, "printFlowchartOutcome is still a function declaration");
  assert.match(flowchartSummary, /warnUndeliveredClusterMail\(io, outcome\.clusterMail\)/);
});
