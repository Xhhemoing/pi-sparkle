import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAgentProfileRegistry,
  defaultAgentProfiles,
  type AgentProfile,
  type AgentProfileRegistry
} from "../../../src/agents/registry.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import {
  parseRunId,
  parseTaskId,
  type ArtifactId,
  type EvidenceId,
  type MessageId
} from "../../../src/domain/ids.js";
import { isAgentRole, type AgentRole } from "../../../src/domain/roles.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type {
  AgentExecutionRequest,
  AgentExecutor,
  ExecutionEvent
} from "../../../src/execution/contract.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { resumeFlowchartRun, startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { inspectRun } from "../../../src/run/inspection.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function child(id: string, role: string): ChildTaskInput {
  if (!isAgentRole(role)) throw new Error(`bad role ${role}`);
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(`tsk_${id}`),
    role,
    objective: `Do ${id}`,
    profile: registry.resolve(role),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-children-flow-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-children-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("compiled children execute through the flowchart supervisor and persist child protocol events", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const children = [child("parse", "implementer"), child("test", "tester")];
    const flowchart = compileChildrenToFlowchart(
      children.map((entry) => ({
        taskId: entry.taskId,
        role: isAgentRole(entry.role) ? entry.role : "worker",
        objective: entry.objective
      }))
    );
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: createModelRouter({
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
        }),
        executor: new ProtocolChildExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        flowchart,
        objective: "Ship the parser",
        childTasks: children
      }
    );

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["tsk_parse"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["tsk_test"]?.state, "COMPLETED");
    assert.ok(outcome.events.some((event) => event.type === "MODEL_ROUTED"));
    assert.ok(outcome.events.some((event) => event.type === "CHILD_RUN_CREATED"));

    const inspection = await inspectRun(stateRoot, outcome.runId);
    assert.equal(inspection.children.length, 2);
    assert.deepEqual(
      inspection.children.map((entry) => entry.outcome).sort(),
      ["SUCCESS", "SUCCESS"]
    );
    for (const childRun of inspection.children) {
      assert.ok(childRun.messages.some((message) => message.type === "TASK_REQUEST"));
      assert.ok(childRun.messages.some((message) => message.type === "TASK_RESULT"));
    }
  });
});

function router() {
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

/** A registry whose profile for one role blows up when the prompt is built. */
function registryFailingFor(brokenRole: AgentRole): AgentProfileRegistry {
  const base = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    has: (role) => base.has(role),
    list: () => base.list(),
    resolve: (role): AgentProfile => {
      if (role !== brokenRole) return base.resolve(role);
      return {
        ...base.resolve(role),
        get systemInstruction(): string {
          throw new Error(`profile lookup failed for ${role}`);
        }
      };
    }
  };
}

function roleFromPrompt(prompt: string): string {
  return /^Role: (.+)$/m.exec(prompt)?.[1] ?? "";
}

/**
 * The parent child spawns two peers: one that keeps working until it is
 * cancelled, and one that cannot launch at all. The failed launch throws out of
 * the node, which is the window where the run leaves the loop with a live child.
 */
class SpawningExecutor implements AgentExecutor {
  peerSawAbort = false;
  private resolvePeerStarted!: () => void;
  readonly peerStarted = new Promise<void>((resolve) => {
    this.resolvePeerStarted = resolve;
  });

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (roleFromPrompt(request.prompt) === "reviewer") {
      this.resolvePeerStarted();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          this.peerSawAbort = true;
          resolve();
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            this.peerSawAbort = true;
            resolve();
          },
          { once: true }
        );
      });
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }

    const cluster = request.cluster;
    assert.ok(cluster, "the parent child runs with a cluster session");
    cluster.spawn({ role: "reviewer", objective: "keep reviewing until cancelled" });
    cluster.spawn({ role: "tester", objective: "peer that cannot launch" });
    await this.peerStarted;
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_spawner-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "spawned the peers",
        artifactIds: [`art_spawner-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_spawner-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_spawner-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

interface LoggedEvent {
  type: string;
  payload: Record<string, unknown>;
}

async function eventsByRun(stateRoot: string): Promise<Map<string, LoggedEvent[]>> {
  const runsRoot = join(runtimeRoot(stateRoot), "runs");
  const runIds = await readdir(runsRoot);
  const byRun = new Map<string, LoggedEvent[]>();
  for (const runId of runIds) {
    const raw = await readFile(join(runsRoot, runId, "events.jsonl"), "utf8").catch(() => "");
    const events = raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as LoggedEvent);
    byRun.set(runId, events);
  }
  return byRun;
}

async function eventTypesByRun(stateRoot: string): Promise<Map<string, string[]>> {
  const byRun = await eventsByRun(stateRoot);
  return new Map([...byRun].map(([runId, events]) => [runId, events.map((event) => event.type)]));
}

const TERMINAL_TYPES = ["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCEL_REQUESTED"];

function terminalsOf(events: readonly LoggedEvent[]): LoggedEvent[] {
  return events.filter((event) => TERMINAL_TYPES.includes(event.type));
}

test("an error escaping a node cancels the peer that is still running", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const spawner = child("spawner", "worker");
    const flowchart = compileChildrenToFlowchart([
      { taskId: spawner.taskId, role: "worker", objective: spawner.objective }
    ]);
    const executor = new SpawningExecutor();

    await assert.rejects(
      startFlowchartRun(
        {
          stateRoot,
          router: router(),
          executor,
          registry: registryFailingFor("tester"),
          generateId: sequenceGenerator()
        },
        { projectRoot, flowchart, objective: "Spawn peers", childTasks: [spawner] }
      ),
      /profile lookup failed for tester/
    );

    assert.equal(executor.peerSawAbort, true, "teardown aborts the peer that was still running");
    const byRun = await eventTypesByRun(stateRoot);
    const cancelled = [...byRun.values()].filter((types) => types.includes("RUN_CANCEL_REQUESTED"));
    assert.equal(cancelled.length, 1, "the live peer settles as a cancelled child run");
  });
});

test("an error escaping a node closes both the run's log and the crashed child's", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const spawner = child("spawner", "worker");
    const flowchart = compileChildrenToFlowchart([
      { taskId: spawner.taskId, role: "worker", objective: spawner.objective }
    ]);

    await assert.rejects(
      startFlowchartRun(
        {
          stateRoot,
          router: router(),
          executor: new SpawningExecutor(),
          registry: registryFailingFor("tester"),
          generateId: sequenceGenerator()
        },
        { projectRoot, flowchart, objective: "Spawn peers", childTasks: [spawner] }
      ),
      /profile lookup failed for tester/
    );

    const byRun = await eventsByRun(stateRoot);
    for (const [runId, events] of byRun) {
      assert.equal(terminalsOf(events).length, 1, `run ${runId} ends with exactly one terminal event`);
    }

    const parent = [...byRun].find(([, events]) => events.some((event) => event.type === "PROJECT_DISCOVERED"));
    assert.ok(parent, "the parent run is the one that recorded the project");
    assert.equal(
      terminalsOf(parent[1])[0]?.payload.reason,
      "run crashed: profile lookup failed for tester",
      "the run that died mid-node records why, instead of just stopping"
    );

    const crashedChild = [...byRun.values()].find((events) =>
      events.some(
        (event) =>
          event.type === "RUN_FAILED" &&
          String(event.payload.reason).startsWith("child run crashed:")
      )
    );
    assert.ok(crashedChild, "the child that threw instead of settling closes its own log");
    assert.equal(
      terminalsOf(crashedChild)[0]?.payload.reason,
      "child run crashed: profile lookup failed for tester"
    );
    assert.equal(
      crashedChild.some((event) => event.type === "AGENT_STARTED"),
      false,
      "this child died launching its first attempt, which is why nothing else closed it"
    );

    const parentRunId = parseRunId(parent[0]);
    const resumed = await resumeFlowchartRun(
      {
        stateRoot,
        router: router(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        generateId: sequenceGenerator()
      },
      parentRunId
    );
    assert.equal(resumed.status, "FAILED", "the crashed run resumes as a failure, not as more work");
  });
});
