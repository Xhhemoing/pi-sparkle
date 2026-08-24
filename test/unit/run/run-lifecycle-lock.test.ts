import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { validateConfidenceScore, type Flowchart, type FlowEdge, type FlowNode } from "../../../src/domain/flowchart.js";
import { createTaskId, parseTaskId, type RunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { startParentRun } from "../../../src/run/coordinator.js";
import { runLockPath } from "../../../src/run/event-store.js";
import { resumeFlowchartRun, startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createFilePauseController, type PauseController, type PauseToken } from "../../../src/run/pause-controller.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";

/**
 * The run lifecycle takes the run's cooperative lock once and holds it for the
 * whole run (`withRunLifecycleLock`). These pin both halves of that posture:
 * what it buys (a `delete --run` waits for a live run instead of removing its
 * records mid-flight — see `test/unit/privacy/deletion.test.ts` for the delete
 * side) and what it costs (every other writer that takes the lock waits too,
 * including a cross-process pause).
 */

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
    modelPolicy: { allowedModels: ["cheap"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

function chain(id: string, ids: readonly string[]): Flowchart {
  const edges: FlowEdge[] = [];
  for (let i = 1; i < ids.length; i += 1) {
    edges.push({ from: ids[i - 1]!, to: ids[i]!, condition: { type: "success", expected: true } });
  }
  return { id, nodes: ids.map(node), edges };
}

function result(id: string): ChildNodeResult {
  return { outcome: "SUCCESS", confidence: validateConfidenceScore(0.9), evidenceIds: [`evd_${id}`] };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-lifecycle-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-lifecycle-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** True when someone else holds the run lock right now, without stealing it. */
async function runLockHeld(stateRoot: string, runId: RunId): Promise<boolean> {
  try {
    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => undefined, {
      timeoutMs: 40,
      retryMs: 5
    });
    return false;
  } catch (error) {
    if ((error as { code?: unknown }).code === LOCK_TIMEOUT_CODE) return true;
    throw error;
  }
}

/**
 * Runs `probe` on the run's first pause poll, which is the cheapest seam that
 * fires while the run is live and knows the run's id.
 */
function probingPause(probe: (runId: RunId) => Promise<void>): PauseController {
  let probed = false;
  return {
    async requestPause(): Promise<PauseToken> {
      return { paused: false };
    },
    async clearPause(): Promise<void> {},
    async token(runId: RunId): Promise<PauseToken> {
      if (!probed) {
        probed = true;
        await probe(runId);
      }
      return { paused: false };
    }
  };
}

test("a live flowchart run holds the run lock, and teardown releases it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    let heldDuringRun: boolean | undefined;
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        generateId: sequenceGenerator(),
        pause: probingPause(async (runId) => {
          heldDuringRun = await runLockHeld(stateRoot, runId);
        })
      },
      { projectRoot, flowchart: chain("lifecycle-hold", ["only"]), childResults: { only: result("only") } }
    );

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(heldDuringRun, true, "the run holds its own lock while it runs");
    assert.equal(
      existsSync(runLockPath(stateRoot, outcome.runId)),
      false,
      "the run releases the lock it took"
    );
  });
});

test("a resumed flowchart run holds the same lock and releases it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const started = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        generateId: sequenceGenerator(),
        pause: probingPause(async () => {})
      },
      {
        projectRoot,
        flowchart: chain("lifecycle-resume", ["a", "b"]),
        childResults: { a: result("a") },
        limits: { maxConsecutiveStalls: 1, maxRounds: 3 }
      }
    );

    let heldDuringResume: boolean | undefined;
    const resumed = await resumeFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        generateId: sequenceGenerator(),
        pause: probingPause(async (runId) => {
          heldDuringResume = await runLockHeld(stateRoot, runId);
        })
      },
      started.runId,
      { childResults: { b: result("b") } }
    );

    assert.equal(heldDuringResume, true, "resume takes the lock a fresh start takes");
    assert.equal(existsSync(runLockPath(stateRoot, resumed.runId)), false);
  });
});

/**
 * A pause controller whose token read throws, so an error escapes the run loop
 * from inside the lifecycle lock: the release must be the teardown's, not the
 * happy path's.
 */
test("a crashed run releases the run lock on its way out", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    let seenRunId: RunId | undefined;
    await assert.rejects(
      startFlowchartRun(
        {
          stateRoot,
          router: router(),
          now: () => TS,
          generateId: sequenceGenerator(),
          pause: {
            async requestPause(): Promise<PauseToken> {
              return { paused: false };
            },
            async clearPause(): Promise<void> {},
            async token(runId: RunId): Promise<PauseToken> {
              seenRunId = runId;
              throw new Error("pause token unreadable");
            }
          }
        },
        { projectRoot, flowchart: chain("lifecycle-crash", ["only"]) }
      ),
      /pause token unreadable/
    );

    assert.ok(seenRunId, "the run reached its first pause poll");
    assert.equal(
      existsSync(runLockPath(stateRoot, seenRunId)),
      false,
      "a crash must not leave the lock behind for a process that is gone"
    );
    // The crash terminal still landed: taking the lock did not move teardown.
    const events = await readFile(
      join(runtimeRoot(stateRoot), "runs", seenRunId, "events.jsonl"),
      "utf8"
    );
    assert.match(events, /run crashed: pause token unreadable/);
  });
});

test("a run refuses to start while another holder has the run lock, and writes nothing", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    // The run id is deterministic here, so the lock can be taken before the run
    // that will want it — a `delete --run` already in progress, or a lock left
    // behind by a killed run.
    const generateId = sequenceGenerator();
    const runId = `run_00000000-0000-4000-8000-000000000000` as RunId;
    let outcome: unknown;

    await withExclusiveFileLock(runLockPath(stateRoot, runId), async () => {
      outcome = await startFlowchartRun(
        {
          stateRoot,
          router: router(),
          now: () => TS,
          generateId,
          runLock: { timeoutMs: 40, retryMs: 5 }
        },
        { projectRoot, flowchart: chain("lifecycle-blocked", ["only"]) }
      ).then(
        (value) => value,
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof Error, "a run that cannot take its lock must not start");
    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(
      existsSync(join(runtimeRoot(stateRoot), "runs", runId)),
      false,
      "a refused run records nothing at all"
    );
  });
});

/**
 * The disclosed cost of the acquisition. `requestPause` takes the run lock, so
 * a `pi-sparkle pause --run` aimed at a run another process is driving now
 * fails closed instead of writing `pause.json` and then settling that run's
 * episode and checkpoint from underneath it. `doctor` names the holder.
 */
test("a cross-process pause of a live run fails closed rather than racing it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    let pauseOutcome: unknown;
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => TS,
        generateId: sequenceGenerator(),
        pause: probingPause(async (runId) => {
          const operator = createFilePauseController(stateRoot, () => TS, {
            timeoutMs: 40,
            retryMs: 5
          });
          pauseOutcome = await operator.requestPause(runId, "stop this run").then(
            (token) => token,
            (error: unknown) => error
          );
        })
      },
      { projectRoot, flowchart: chain("lifecycle-pause", ["only"]), childResults: { only: result("only") } }
    );

    assert.ok(pauseOutcome instanceof Error);
    assert.equal((pauseOutcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(
      existsSync(join(runtimeRoot(stateRoot), "runs", outcome.runId, "pause.json")),
      false,
      "the refused pause wrote nothing"
    );
    assert.equal(outcome.status, "COMPLETED", "and the live run was not disturbed");
  });
});

/**
 * Yields one successful task result, probing a chosen run's lock as it runs.
 * The run id is supplied rather than read from the request: a child attempt's
 * request carries the *child's* run id, and the lock under test is the
 * parent's.
 */
class ProbingExecutor implements AgentExecutor {
  held: boolean | undefined;
  probeRunId: RunId | undefined;

  constructor(private readonly stateRoot: string) {}

  async *execute(_request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
    if (this.probeRunId !== undefined) this.held ??= await runLockHeld(this.stateRoot, this.probeRunId);
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
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

test("a parent run holds the run lock for its whole run", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new ProbingExecutor(stateRoot);
    const running = startParentRun(
      { stateRoot, executor, now: () => TS, generateId: sequenceGenerator() },
      { projectRoot, objective: "lifecycle parent", children: [childSpec("tsk_build")] }
    );
    executor.probeRunId = running.runId;

    const outcome = await running.done;
    assert.equal(executor.held, true, "the parent's lock is held while its children run");
    assert.equal(
      existsSync(runLockPath(stateRoot, outcome.runId)),
      false,
      "the parent releases the lock when its run settles"
    );
  });
});

test("the run lifecycles are the only place the acquisition lives", async () => {
  const flowchart = await readFile(new URL("../../../src/run/flowchart-run.ts", import.meta.url), "utf8");
  const coordinator = await readFile(new URL("../../../src/run/coordinator.ts", import.meta.url), "utf8");

  // Source pins: both flowchart entry points route through the shared helper
  // rather than rebuilding the path, and the helper is the one caller of
  // `withExclusiveFileLock` on the run plane's lifecycle.
  assert.match(flowchart, /withRunLifecycleLock\(\s*deps\.stateRoot,\s*runId,\s*\(\) => startLockedFlowchartRun/);
  assert.match(flowchart, /withRunLifecycleLock\(\s*deps\.stateRoot,\s*runId,\s*\(\) => resumeLockedFlowchartRun/);
  assert.doesNotMatch(flowchart, /runLockPath/);
  assert.match(
    coordinator,
    /return withRunLifecycleLock\(deps\.stateRoot, runId, \(\) => runM0Run\(project\), deps\.runLock\);/
  );
  assert.match(
    coordinator,
    /return withRunLifecycleLock\(deps\.stateRoot, runId, \(\) => runParentRun\(project\), deps\.runLock\);/
  );
  assert.match(
    coordinator,
    /export function withRunLifecycleLock<T>\([\s\S]*?\): Promise<T> \{\s*return withExclusiveFileLock\(runLockPath\(stateRoot, runId\), body, options\);/
  );
});
