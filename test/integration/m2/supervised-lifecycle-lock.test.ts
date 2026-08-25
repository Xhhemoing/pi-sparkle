import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createTaskId, type RunId } from "../../../src/domain/ids.js";
import type { TaskNode } from "../../../src/domain/task.js";
import { parseIsoTimestamp, type IsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { LOCK_TIMEOUT_CODE, withExclusiveFileLock } from "../../../src/persist/file-lock.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { runLockPath } from "../../../src/run/event-store.js";
import { resumeFlowchartRun } from "../../../src/run/flowchart-run.js";
import { resumeSupervisedRun, startSupervisedRun } from "../../../src/run/supervisor.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";

/**
 * The supervised plane's half of the run lifecycle lock. `startSupervisedRun`
 * took the lock *before* discovery and graph validation, so a refused
 * supervised start created `runtime/runs/` for a run that never happened —
 * where the M0, parent and flowchart planes all persist nothing. These pin the
 * hoisted pre-flight, the acquisition itself, and the one posture the resume
 * planes deliberately do not share.
 */

const TS: IsoTimestamp = parseIsoTimestamp("2026-08-24T09:00:00.000Z");

/** `startSupervisedRun` mints the run id from the generator's first value. */
const FIRST_RUN_ID = "run_00000000-0000-4000-8000-000000000000" as RunId;

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function task(id: string, dependencies: string[] = []): TaskNode {
  return {
    id: createTaskId(() => id),
    title: id,
    objective: `Do ${id}`,
    role: "worker",
    dependencies: dependencies.map((dep) => createTaskId(() => dep)),
    acceptanceCriteria: [{ id: "ac-1", description: "works" }],
    status: "PENDING",
    attempt: 0,
    maxAttempts: 3,
    timeoutMs: 60_000,
    artifactIds: [],
    evidenceIds: []
  };
}

function limits() {
  return {
    maxTasks: 2,
    maxConcurrentTasks: 2,
    maxAttemptsPerTask: 3,
    maxRounds: 10,
    maxConsecutiveStalls: 3,
    maxWallTimeMs: 600_000
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sup-lock-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sup-lock-proj-"));
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

/** Succeeds once, probing the parent run's lock while the child is executing. */
class ProbingExecutor implements AgentExecutor {
  held: boolean | undefined;
  probeRunId: RunId | undefined;

  constructor(private readonly stateRoot: string) {}

  async *execute(_request: AgentExecutionRequest): AsyncIterable<ExecutionEvent> {
    if (this.probeRunId !== undefined) this.held ??= await runLockHeld(this.stateRoot, this.probeRunId);
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

function supervisorDeps(stateRoot: string, executor: AgentExecutor) {
  return {
    stateRoot,
    executor,
    registry: createAgentProfileRegistry(defaultAgentProfiles()),
    now: () => TS,
    generateId: sequenceGenerator()
  };
}

const silentExecutor: AgentExecutor = {
  // eslint-disable-next-line require-yield
  async *execute(): AsyncIterable<ExecutionEvent> {
    throw new Error("a refused run must never reach its executor");
  }
};

/**
 * Mirrors `test/integration/m0/coordinator.test.ts`'s "a missing project root
 * rejects without persisting a run directory". The supervised plane refuses two
 * ways, and neither may leave a trace.
 */
const REFUSALS: ReadonlyArray<{ name: string; tasks: (root: string) => TaskNode[]; project: (root: string) => string; message: RegExp }> = [
  {
    name: "a missing project root",
    tasks: () => [task("a")],
    project: (projectRoot) => join(projectRoot, "missing"),
    message: /root/
  },
  {
    name: "a cyclic task graph",
    tasks: () => [task("a", ["b"]), task("b", ["a"])],
    project: (projectRoot) => projectRoot,
    message: /cycle/
  }
];

for (const refusal of REFUSALS) {
  test(`a supervised run refused by ${refusal.name} persists nothing`, async () => {
    await withRoots(async (stateRoot, projectRoot) => {
      const running = startSupervisedRun(supervisorDeps(stateRoot, silentExecutor), {
        projectRoot: refusal.project(projectRoot),
        objective: "Ship it",
        tasks: refusal.tasks(projectRoot),
        limits: limits()
      });
      await assert.rejects(() => running.done, refusal.message);

      assert.deepEqual(
        await readdir(stateRoot).catch(() => []),
        [],
        "pre-flight outside the lock means the refusal does not create runtime/runs/"
      );
    });
  });
}

test("a supervised run refused by the run lock persists nothing", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    let outcome: unknown;

    await withExclusiveFileLock(runLockPath(stateRoot, FIRST_RUN_ID), async () => {
      const running = startSupervisedRun(
        { ...supervisorDeps(stateRoot, silentExecutor), runLock: { timeoutMs: 40, retryMs: 5 } },
        { projectRoot, objective: "Ship it", tasks: [task("a")], limits: limits() }
      );
      outcome = await running.done.then(
        (value) => value,
        (error: unknown) => error
      );
    });

    assert.ok(outcome instanceof Error, "a run that cannot take its lock must not start");
    assert.equal((outcome as { code?: unknown }).code, LOCK_TIMEOUT_CODE);
    assert.equal(
      existsSync(join(runtimeRoot(stateRoot), "runs", FIRST_RUN_ID)),
      false,
      "a refused run records nothing at all"
    );
  });
});

test("a live supervised run holds the run lock, and teardown releases it", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const executor = new ProbingExecutor(stateRoot);
    const running = startSupervisedRun(supervisorDeps(stateRoot, executor), {
      projectRoot,
      objective: "Ship it",
      tasks: [task("a")],
      limits: limits()
    });
    executor.probeRunId = running.runId;

    const outcome = await running.done;
    assert.equal(executor.held, true, "the supervised run holds its own lock while its children run");
    assert.equal(
      existsSync(runLockPath(stateRoot, outcome.runId)),
      false,
      "the run releases the lock it took"
    );
  });
});

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

/**
 * The one posture the resume planes do not share with the start paths, pinned
 * here once for all of them rather than left as per-plane folklore.
 *
 * A start hoists its pre-flight outside the lock, so a refused start persists
 * nothing. A resume cannot: every check it makes is a read of the very records
 * the lock protects, and reading first would let a `delete --run` land in
 * between and have the resume rewrite records that were just deleted. So the
 * acquisition comes first, `withExclusiveFileLock` creates the lock's parent,
 * and a resume of a run id that does not exist leaves an empty
 * `runtime/runs/` directory. Nothing else: no run subtree, no lock file, and
 * `deleteRunRecords` still treats the run as a no-op.
 */
const GHOST_RUN_ID = "run_00000000-0000-4000-8000-999999999999" as RunId;

const RESUME_PLANES: ReadonlyArray<{ name: string; resume: (stateRoot: string) => Promise<unknown> }> = [
  {
    name: "supervised",
    resume: (stateRoot) => resumeSupervisedRun(supervisorDeps(stateRoot, silentExecutor), GHOST_RUN_ID).done
  },
  {
    name: "flowchart",
    resume: (stateRoot) =>
      resumeFlowchartRun(
        { stateRoot, router: router(), now: () => TS, generateId: sequenceGenerator() },
        GHOST_RUN_ID
      )
  }
];

for (const plane of RESUME_PLANES) {
  test(`a ${plane.name} resume of a run that does not exist leaves an empty runtime/runs/ and nothing else`, async () => {
    await withRoots(async (stateRoot) => {
      await assert.rejects(() => plane.resume(stateRoot), /not found/);

      assert.deepEqual(await readdir(stateRoot), ["runtime"]);
      assert.deepEqual(await readdir(runtimeRoot(stateRoot)), ["runs"]);
      assert.deepEqual(
        await readdir(join(runtimeRoot(stateRoot), "runs")),
        [],
        "the lock's parent directory is the whole trace: no run subtree, no lock file"
      );
    });
  });
}

test("the supervised lifecycle takes the lock through the shared helper, with its pre-flight outside", async () => {
  const supervisor = await readFile(new URL("../../../src/run/supervisor.ts", import.meta.url), "utf8");

  assert.match(
    supervisor,
    /const graph = validateTaskGraph\(input\.tasks\);\s*return withRunLifecycleLock\(\s*deps\.stateRoot,\s*runId,\s*\(\) => startLockedSupervisedRun\(project, graph\),\s*deps\.runLock\s*\);/,
    "discovery and graph validation are pre-flight; only the record-writing body is wrapped"
  );
  assert.match(
    supervisor,
    /const done = withRunLifecycleLock\(deps\.stateRoot, runId, async \(\): Promise<SupervisedRunOutcome> => \{/,
    "resume routes through the same helper"
  );
  assert.doesNotMatch(supervisor, /runLockPath/, "the path template is never rebuilt here");
  assert.ok(
    supervisor.indexOf("async function startLockedSupervisedRun") <
      supervisor.indexOf("export function resumeSupervisedRun"),
    "the locked start body is a named function, so the pin above names what is wrapped"
  );
});
