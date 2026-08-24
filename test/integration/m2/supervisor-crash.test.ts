import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import {
  createEventId,
  createMessageId,
  createRunId,
  createTaskId,
  type RunId,
  type TaskId
} from "../../../src/domain/ids.js";
import type { Run } from "../../../src/domain/run.js";
import type { TaskNode } from "../../../src/domain/task.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { DeterministicJudge, type JudgeAdapter, type JudgeDecision } from "../../../src/graph/judge.js";
import { validateTaskGraph } from "../../../src/graph/validate.js";
import { discoverProject } from "../../../src/project/discovery.js";
import { SUPERVISOR, type TaskResult } from "../../../src/protocol/v1.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { bindEpisodeToRun, episodeIdFromEvents } from "../../../src/run/episode-bind.js";
import { EpisodeStore } from "../../../src/run/episode-store.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event } from "../../../src/run/events.js";
import { replayRun } from "../../../src/run/replay.js";
import { LeaseRegistry } from "../../../src/run/scheduler.js";
import {
  resumeSupervisedRun,
  runSupervisorRounds,
  startSupervisedRun,
  type SupervisorContext,
  type SupervisorState
} from "../../../src/run/supervisor.js";
import { createLedger } from "../../../src/supervisor/ledger.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

const NOW = () => parseIsoTimestamp("2026-08-12T09:00:00.000Z");

/** Terminal parent-run events: replay must never see two of these. */
const TERMINAL_TYPES = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_BLOCKED"]);

/**
 * The event types recorded after the crash terminal. The crash settle appends
 * the episode's closure there and nothing else — a round-mate still writing
 * after the terminal would show up here.
 */
function afterTerminal(events: readonly Event[]): string[] {
  const index = events.findIndex((event) => TERMINAL_TYPES.has(event.type));
  return index < 0 ? [] : events.slice(index + 1).map((event) => event.type);
}

function sequenceGenerator(start = 0): () => string {
  let n = start;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function resultMessage(request: AgentExecutionRequest): TaskResult {
  return {
    protocolVersion: 1,
    id: createMessageId(UUID),
    occurredAt: NOW(),
    runId: request.runId,
    taskId: request.taskId,
    from: request.agentInstanceId,
    to: SUPERVISOR,
    type: "TASK_RESULT",
    outcome: "SUCCESS",
    summary: "done",
    artifactIds: [],
    evidenceIds: [`evd_${request.taskId}` as never],
    verification: { kind: "PASSED", evidenceIds: [] }
  };
}

class SucceedingExecutor implements AgentExecutor {
  constructor(private readonly slowTasks: readonly TaskId[] = []) {}

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (this.slowTasks.includes(request.taskId)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    yield { type: "MESSAGE", message: resultMessage(request) };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/**
 * A judge that throws is the cheapest realistic way to make an error escape the
 * round loop: `judge.decide` is called directly by the task promise, so unlike
 * an executor throw (which the child coordinator converts into a FAILURE
 * outcome) it reaches `runSupervisorRounds` unhandled.
 */
class ExplodingJudge implements JudgeAdapter {
  decide(): JudgeDecision {
    throw new Error("judge exploded");
  }
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

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sup-crash-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-sup-crash-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

/** Starts a supervised run whose judge throws, and returns the crashed run id. */
async function crashedRun(stateRoot: string, projectRoot: string): Promise<RunId> {
  const running = startSupervisedRun(
    {
      stateRoot,
      executor: new SucceedingExecutor(),
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      judge: new ExplodingJudge(),
      now: NOW,
      generateId: sequenceGenerator()
    },
    { projectRoot, objective: "Ship it", tasks: [task("a")], limits: limits() }
  );
  await assert.rejects(() => running.done, /judge exploded/, "the error still reaches the caller");
  return running.runId;
}

test("an error escaping the supervised round loop records RUN_FAILED and rethrows", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const runId = await crashedRun(stateRoot, projectRoot);

    const read = await new EventStore(stateRoot, runId).readAll();
    const terminal = read.events.find((event) => event.type === "RUN_FAILED");
    assert.ok(terminal !== undefined, "the crashed run's log carries a terminal event");
    assert.match(
      (terminal.payload as { reason: string }).reason,
      /^run crashed: judge exploded$/,
      "the reason names the escaping error"
    );
    assert.deepEqual(
      afterTerminal(read.events),
      ["EPISODE_CLOSED"],
      "nothing follows the terminal but the crash settle"
    );

    const replayed = replayRun(read.events);
    assert.equal(replayed.status, "FAILED", "replay no longer reports the run as RUNNING forever");
    assert.deepEqual(replayed.anomalies, [], "no duplicate terminal, no out-of-order event");
    assert.equal(
      read.events.filter((event) => TERMINAL_TYPES.has(event.type)).length,
      1,
      "exactly one terminal event"
    );
  });
});

test("a crashed supervised run resumes as terminal and appends nothing", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const runId = await crashedRun(stateRoot, projectRoot);
    const before = await new EventStore(stateRoot, runId).readAll();

    const resumed = resumeSupervisedRun(
      {
        stateRoot,
        executor: new SucceedingExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: NOW,
        generateId: sequenceGenerator()
      },
      runId
    );
    const outcome = await resumed.done;
    assert.equal(outcome.status, "FAILED", "resume reports the crash, it does not restart the run");
    assert.equal(outcome.events.length, before.events.length, "a terminal run is resumed read-only");
    assert.equal(outcome.checkpoint.status, "FAILED");
  });
});

test("a crash waits for its round-mates, so nothing is appended after the terminal", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const failing = createTaskId(() => "a");
    const slow = createTaskId(() => "b");
    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new SucceedingExecutor([slow]),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        // Only the first task's verdict throws; its round-mate keeps working.
        judge: {
          decide: (input) => {
            if (input.taskId === failing) throw new Error("judge exploded");
            return { taskId: input.taskId, verdict: "APPROVED", evidenceIds: [] };
          }
        },
        now: NOW,
        generateId: sequenceGenerator()
      },
      { projectRoot, objective: "Ship it", tasks: [task("a"), task("b")], limits: limits() }
    );
    await assert.rejects(() => running.done, /judge exploded/);

    const read = await new EventStore(stateRoot, running.runId).readAll();
    const completed = read.events.findIndex(
      (event) =>
        event.type === "TASK_STATUS_CHANGED" &&
        (event.payload as { taskId: string; status: string }).taskId === "tsk_b" &&
        (event.payload as { status: string }).status === "COMPLETED"
    );
    assert.ok(completed >= 0, "the run must not return while a task it launched is still running");
    assert.deepEqual(
      afterTerminal(read.events),
      ["EPISODE_CLOSED"],
      "no round-mate appends after the crash terminal; only the crash settle does"
    );
    assert.deepEqual(replayRun(read.events).anomalies, []);
  });
});

/** The latest snapshot of the episode the run bound, as the operator reads it. */
async function boundEpisodeStatus(stateRoot: string, events: readonly Event[]): Promise<string | undefined> {
  const episodeId = episodeIdFromEvents(events);
  if (episodeId === undefined) return undefined;
  const read = await new EpisodeStore(stateRoot, episodeId).readAll();
  return read.episodes.at(-1)?.status;
}

async function checkpointStatus(stateRoot: string, runId: RunId): Promise<string | undefined> {
  const checkpoint = (await new CheckpointStore(stateRoot, runId).read()) as { status?: string } | undefined;
  return checkpoint?.status;
}

/**
 * The settle tail runs after `runSupervisorRounds` in both embedders, so before
 * the crash path settled for itself a crashed run left its episode bound open
 * and no checkpoint at all — the operator's two durable views disagreed with a
 * log that already said FAILED.
 */
test("a crashed supervised run closes its episode and leaves a FAILED checkpoint", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const runId = await crashedRun(stateRoot, projectRoot);
    const read = await new EventStore(stateRoot, runId).readAll();

    assert.equal(
      await boundEpisodeStatus(stateRoot, read.events),
      "FAILED",
      "the crashed run's episode is closed, not left bound forever"
    );
    assert.ok(
      read.events.some((event) => event.type === "EPISODE_CLOSED"),
      "the closure is on the run log too, where the CLI reads it"
    );
    assert.equal(
      await checkpointStatus(stateRoot, runId),
      "FAILED",
      "the durable resume point agrees with the log"
    );
    assert.deepEqual(replayRun(read.events).anomalies, []);
  });
});

/**
 * Seeds an in-flight supervised run — bound episode, graph accepted, no
 * terminal — so `resumeSupervisedRun` has something to crash on. A run started
 * here cannot reach this state on its own: an exploding judge closes the log.
 */
async function seedInFlightRun(stateRoot: string, projectRoot: string): Promise<RunId> {
  const generateId = sequenceGenerator();
  const project = await discoverProject(projectRoot, { now: NOW, generateId });
  const runId = createRunId(generateId);
  const graph = validateTaskGraph([task("a")]);
  const run: Run = {
    id: runId,
    projectId: project.id,
    rootTaskId: createTaskId(generateId),
    status: "PLANNING",
    limits: limits(),
    createdAt: NOW(),
    updatedAt: NOW()
  };
  const store = new EventStore(stateRoot, runId);
  const make = (type: Event["type"], payload: unknown): Event =>
    ({
      id: createEventId(generateId),
      schemaVersion: 1,
      occurredAt: NOW(),
      runId,
      type,
      actor: "supervisor",
      payload
    }) as Event;
  const append = (event: Event) => store.append(event);

  await append(make("PROJECT_DISCOVERED", { project }));
  await append(make("RUN_CREATED", { run }));
  await bindEpisodeToRun({
    stateRoot,
    runId,
    projectId: project.id,
    objective: "Ship it",
    append,
    make,
    generateId
  });
  await append(make("RUN_STARTED", {}));
  await append(make("TASK_GRAPH_ACCEPTED", { tasks: graph.tasks }));
  return runId;
}

test("a crashed supervised resume settles the same way", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const runId = await seedInFlightRun(stateRoot, projectRoot);

    const resumed = resumeSupervisedRun(
      {
        stateRoot,
        executor: new SucceedingExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new ExplodingJudge(),
        now: NOW,
        generateId: sequenceGenerator(100)
      },
      runId
    );
    await assert.rejects(() => resumed.done, /judge exploded/, "resume rethrows the crash too");

    const read = await new EventStore(stateRoot, runId).readAll();
    assert.equal(replayRun(read.events).status, "FAILED");
    assert.equal(await boundEpisodeStatus(stateRoot, read.events), "FAILED");
    assert.equal(await checkpointStatus(stateRoot, runId), "FAILED");
  });
});

/** A judge that damages the settle path on its way to throwing. */
function sabotagingJudge(sabotage: () => void): JudgeAdapter {
  return {
    decide: () => {
      sabotage();
      throw new Error("judge exploded");
    }
  };
}

async function crashedRunWithSabotage(
  stateRoot: string,
  projectRoot: string,
  sabotage: (runId: RunId) => void
): Promise<RunId> {
  let runId: RunId | undefined;
  const running = startSupervisedRun(
    {
      stateRoot,
      executor: new SucceedingExecutor(),
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      judge: sabotagingJudge(() => {
        if (runId === undefined) throw new Error("run id not published yet");
        sabotage(runId);
      }),
      now: NOW,
      generateId: sequenceGenerator()
    },
    { projectRoot, objective: "Ship it", tasks: [task("a")], limits: limits() }
  );
  runId = running.runId;
  await assert.rejects(() => running.done, /judge exploded/, "the settle never masks the escaping error");
  return runId;
}

test("a settle whose checkpoint cannot be written still closes the episode", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    // A directory where the checkpoint file belongs: the atomic publish cannot
    // rename over it, so the checkpoint half of the settle throws.
    const runId = await crashedRunWithSabotage(stateRoot, projectRoot, (id) => {
      mkdirSync(join(runtimeRoot(stateRoot), "runs", id, "checkpoint.json"), { recursive: true });
    });

    const read = await new EventStore(stateRoot, runId).readAll();
    assert.equal(await boundEpisodeStatus(stateRoot, read.events), "FAILED", "the episode still closed");
    assert.equal(read.events.at(-1)?.type, "EPISODE_CLOSED");
  });
});

test("a settle whose episode cannot be closed still writes the checkpoint", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    // A corrupt line in the episode snapshot log: the settle's read under the
    // episode lock throws, and only the episode half is lost.
    const runId = await crashedRunWithSabotage(stateRoot, projectRoot, () => {
      const episodesDir = join(runtimeRoot(stateRoot), "episodes");
      // The snapshot log, not the sibling `.events.jsonl`: the settle reads the
      // snapshots to decide whether the episode is already closed.
      const log = readdirSync(episodesDir).find(
        (name) => name.endsWith(".jsonl") && !name.endsWith(".events.jsonl")
      );
      assert.ok(log !== undefined, "the run bound an episode before it crashed");
      // Two lines: a torn tail is recoverable by contract, a corrupt line in
      // the middle of the log is not.
      appendFileSync(join(episodesDir, log), "{not json}\n{}\n");
    });

    const read = await new EventStore(stateRoot, runId).readAll();
    assert.equal(
      read.events.some((event) => event.type === "EPISODE_CLOSED"),
      false,
      "the episode half failed, as this case arranges"
    );
    assert.equal(
      await checkpointStatus(stateRoot, runId),
      "FAILED",
      "an episode that will not close does not also cost the checkpoint"
    );
  });
});

/**
 * Builds a supervisor context by hand so a crash can be provoked against a log
 * that already reads as settled. `startSupervisedRun` cannot reach this state:
 * it is the process-death-during-teardown case.
 */
async function seededContext(input: {
  stateRoot: string;
  projectRoot: string;
  seed: (make: (type: Event["type"], payload: unknown) => Event) => Event;
}): Promise<{ ctx: SupervisorContext; state: SupervisorState; store: EventStore }> {
  const generateId = sequenceGenerator();
  const project = await discoverProject(input.projectRoot, { now: NOW, generateId });
  const runId = createRunId(generateId);
  const graph = validateTaskGraph([task("a")]);
  const run: Run = {
    id: runId,
    projectId: project.id,
    rootTaskId: createTaskId(generateId),
    status: "PLANNING",
    limits: limits(),
    createdAt: NOW(),
    updatedAt: NOW()
  };
  const store = new EventStore(input.stateRoot, runId);
  const make = (type: Event["type"], payload: unknown, taskId?: TaskId): Event =>
    ({
      id: createEventId(generateId),
      schemaVersion: 1,
      occurredAt: NOW(),
      runId,
      ...(taskId !== undefined ? { taskId } : {}),
      type,
      actor: "supervisor",
      payload
    }) as Event;
  const append = (event: Event) => store.append(event);

  await append(make("PROJECT_DISCOVERED", { project }));
  await append(make("RUN_CREATED", { run }));
  await append(make("RUN_STARTED", {}));
  await append(make("TASK_GRAPH_ACCEPTED", { tasks: graph.tasks }));
  await append(input.seed((type, payload) => make(type, payload)));

  const ctx: SupervisorContext = {
    deps: {
      stateRoot: input.stateRoot,
      executor: new SucceedingExecutor(),
      registry: createAgentProfileRegistry(defaultAgentProfiles())
    },
    runId,
    project,
    run,
    limits: run.limits,
    now: NOW,
    generateId,
    judge: new ExplodingJudge(),
    eventStore: store,
    checkpointStore: new CheckpointStore(input.stateRoot, runId),
    controller: new AbortController(),
    append,
    make
  };
  const state: SupervisorState = {
    graph,
    statuses: new Map(graph.tasks.map((node) => [node.id, node.status])),
    attempts: new Map(graph.tasks.map((node) => [node.id, node.attempt])),
    leases: new LeaseRegistry(() => Date.parse(NOW())),
    ledger: createLedger("Ship it", 3)
  };
  return { ctx, state, store };
}

const SETTLED_LOGS: ReadonlyArray<{
  name: string;
  status: string;
  seed: (make: (type: Event["type"], payload: unknown) => Event) => Event;
}> = [
  {
    name: "RUN_BLOCKED",
    status: "BLOCKED",
    seed: (make) => make("RUN_BLOCKED", { reason: "needs a decision", requiredEvidence: ["a passing build"] })
  },
  {
    name: "RUN_CANCEL_REQUESTED",
    status: "CANCELLED",
    seed: (make) => make("RUN_CANCEL_REQUESTED", {})
  }
];

/**
 * The pre-rounds window: the opening appends and the episode bind, which run
 * before `runSupervisorRounds` has anything to drive.
 *
 * It used to sit outside the crash path entirely, so a run dying in there got
 * neither terminal nor settle — the log stopped after `RUN_STARTED` reading
 * RUNNING forever, no checkpoint, and an episode bound for good. Worse than the
 * post-rounds case it mirrors, because no command could settle it afterwards:
 * `resumeSupervisedRun` refuses a log with no accepted graph, and that is every
 * log this window can leave.
 *
 * The seed makes the episode snapshot store unwritable, so the bind fails
 * after RUN_CREATED and before TASK_GRAPH_ACCEPTED. Empty task lists are now
 * rejected during pre-flight and persist nothing.
 */
async function crashedBeforeRounds(stateRoot: string, projectRoot: string): Promise<RunId> {
  mkdirSync(runtimeRoot(stateRoot), { recursive: true });
  appendFileSync(join(runtimeRoot(stateRoot), "episodes"), "");
  const running = startSupervisedRun(
    {
      stateRoot,
      executor: new SucceedingExecutor(),
      registry: createAgentProfileRegistry(defaultAgentProfiles()),
      judge: new DeterministicJudge(),
      now: NOW,
      generateId: sequenceGenerator()
    },
    { projectRoot, objective: "Ship it", tasks: [task("a")], limits: limits() }
  );
  await assert.rejects(() => running.done, /ENOTDIR/, "the episode-store error still reaches the caller");
  return running.runId;
}

test("a supervised run that dies in its opening appends records a terminal and settles", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const runId = await crashedBeforeRounds(stateRoot, projectRoot);

    const read = await new EventStore(stateRoot, runId).readAll();
    const terminal = read.events.find((event) => event.type === "RUN_FAILED");
    assert.ok(terminal !== undefined, "the log does not just stop after RUN_STARTED");
    assert.match(
      (terminal.payload as { reason: string }).reason,
      /^run crashed: ENOTDIR: not a directory, open '.*\/runtime\/episodes\/ep_.*\.jsonl'$/,
      "the same bounded reason the rounds window records"
    );
    assert.deepEqual(afterTerminal(read.events), [], "the unbound episode produces no invented closure");

    const replayed = replayRun(read.events);
    assert.equal(replayed.status, "FAILED");
    assert.deepEqual(replayed.anomalies, []);
    assert.equal(await boundEpisodeStatus(stateRoot, read.events), undefined, "the failed bind exposes no episode");
    assert.equal(await checkpointStatus(stateRoot, runId), "FAILED", "the durable resume point agrees");
  });
});

test("a run that died before accepting a graph resumes as terminal rather than as a missing graph", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const runId = await crashedBeforeRounds(stateRoot, projectRoot);
    const before = await new EventStore(stateRoot, runId).readAll();

    const resumed = resumeSupervisedRun(
      {
        stateRoot,
        executor: new SucceedingExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: NOW,
        generateId: sequenceGenerator(100)
      },
      runId
    );
    const outcome = await resumed.done;
    assert.equal(outcome.status, "FAILED", "the settled state is readable through the run-id command");
    assert.equal(outcome.events.length, before.events.length, "a terminal run is resumed read-only");
  });
});

/**
 * The widened window keeps the module's best-effort rule: an event log that
 * cannot be appended to at all takes the crash terminal down with it, and the
 * original error is still what the caller sees.
 */
test("a pre-rounds crash whose own terminal cannot land still rethrows and writes no checkpoint", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    // A directory where the event log belongs: every append fails, including
    // the crash terminal's.
    const runId = "run_00000000-0000-4000-8000-000000000000" as RunId;
    mkdirSync(join(runtimeRoot(stateRoot), "runs", runId, "events.jsonl"), { recursive: true });

    const running = startSupervisedRun(
      {
        stateRoot,
        executor: new SucceedingExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        judge: new DeterministicJudge(),
        now: NOW,
        generateId: sequenceGenerator()
      },
      { projectRoot, objective: "Ship it", tasks: [task("a")], limits: limits() }
    );
    assert.equal(running.runId, runId, "the seeded log belongs to the run under test");
    await assert.rejects(() => running.done, /EISDIR/, "the settle never masks the escaping error");

    assert.equal(await checkpointStatus(stateRoot, runId), undefined, "nothing was invented about the run");
  });
});

for (const settled of SETTLED_LOGS) {
  test(`a crash after ${settled.name} keeps that state instead of appending a terminal`, async () => {
    await withTempState(async (stateRoot, projectRoot) => {
      const { ctx, state, store } = await seededContext({ stateRoot, projectRoot, seed: settled.seed });

      await assert.rejects(
        () => runSupervisorRounds(ctx, state, ctx.run.rootTaskId),
        /judge exploded/,
        "the error is rethrown whether or not a terminal was recorded"
      );

      const read = await store.readAll();
      assert.equal(
        read.events.some((event) => event.type === "RUN_FAILED"),
        false,
        "a settled log must not be overwritten by a crash terminal"
      );
      const replayed = replayRun(read.events);
      assert.equal(replayed.status, settled.status, "the run keeps the status it honestly recorded");
      assert.deepEqual(replayed.anomalies, []);
    });
  });
}
