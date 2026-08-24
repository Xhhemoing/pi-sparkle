import {
  createAgentInstanceId,
  createEventId,
  createRunId,
  createTaskId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { defaultRunLimits, type RunLimits } from "../domain/limits.js";
import type { ProjectSnapshot } from "../domain/project.js";
import type { Run } from "../domain/run.js";
import type { RunStatus } from "../domain/status.js";
import { nowIso, type IsoTimestamp } from "../domain/timestamp.js";
import type { RequirementContract } from "../domain/contract.js";
import { DomainValidationError } from "../domain/errors.js";
import type { AgentProfileRegistry } from "../agents/registry.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import type { AgentExecutor } from "../execution/contract.js";
import { buildProjectContextIndex } from "../context/index.js";
import { discoverProject } from "../project/discovery.js";
import type { AgentQuestion } from "../protocol/v1.js";
import {
  createClusterHost,
  type ClusterDeadLetterReasonCount,
  type ClusterHost
} from "../cluster/host.js";
import { AGENT_ROLES, isAgentRole, type AgentRole } from "../domain/roles.js";
import type { TaskAssignment } from "../routing/assign.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { ChildCoordinator, type ChildRunHandle, type ChildRunOutcome, type ChildTaskInput } from "./child-coordinator.js";
import { groundChildTask } from "./child-grounding.js";
import { EventStore, runLockPath } from "./event-store.js";
import { type AgentEventKind, type Event, type M0EventType, type ModelRoutedPayload, routingContextFields } from "./events.js";
import { assertCoverageAllowsStart } from "../requirement/coverage.js";
import { bindEpisodeToRun, settleBoundEpisode } from "./episode-bind.js";
import { applyChildThreeLine } from "./child-tracking.js";
import { materializeCheckpoint, replayRun, validateCheckpoint, type RunCheckpoint } from "./replay.js";

const SUMMARY_LIMIT = 500;

export interface CoordinatorDeps {
  stateRoot: string;
  executor: AgentExecutor;
  registry?: AgentProfileRegistry;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
  /** Enable peer mailbox and bounded spawn (implied by `--track`). */
  cluster?: boolean;
  /** Bounds the run's own acquisition of {@link withRunLifecycleLock}. */
  runLock?: FileLockOptions;
}

/**
 * Holds the run's cooperative lock (`runLockPath`) for one whole run: taken
 * before the run's first record and released by the same teardown that settles
 * it, whether the run finishes, pauses, or dies with an error.
 *
 * ## What it buys
 *
 * `delete --run` takes the same lock across its removal, so a delete aimed at
 * a live run now **waits** for the run instead of racing it. Before this, the
 * delete found the lock free between two of the run's own writes, removed the
 * subtree, watched the run's next append put it back, and threw
 * `RunRecordsSurvivedError` — correct, but only after it had already destroyed
 * part of a live run's records. Waiting means the two outcomes are now a clean
 * delete (the run ended inside the delete's bounded wait) or a `LOCK_TIMEOUT`
 * that removed nothing at all. Both are honest; neither damages a live run.
 *
 * The cost is one acquisition per *run*, not per write. The two per-step
 * writers (`EventStore.append`, `CheckpointStore.write`) stay lock-free and
 * their decision pins stay green: locking those measured +22.5% / +17.5%
 * end-to-end, where this measures inside the 5% bar (see the slot report's
 * bench).
 *
 * ## What it costs, stated rather than discovered
 *
 * While a run holds this lock, every other writer that takes it waits:
 *
 * - `delete --run` — the point of the change.
 * - `requestPause`, i.e. `pi-sparkle pause --run` from another process. A
 *   pause aimed at a live run now fails closed with `LOCK_TIMEOUT` instead of
 *   writing `pause.json` and then settling the run's episode and checkpoint
 *   from underneath the process that is still driving it. `doctor` names the
 *   holder (age + recorded PID) and the run's state; the remedy for a run you
 *   own is to stop its process.
 * - A run killed by SIGKILL leaves the lock behind, because locks are never
 *   stolen (`withExclusiveFileLock`). Delete, pause and track-question writes
 *   for that run then fail closed until an operator removes the file, which
 *   `doctor` inventories with the guidance for doing so. Accepted with parent
 *   sign-off: a stale lock is a visible, diagnosable stop, where the failure
 *   it replaces was a partially deleted live run.
 *
 * Not wrapped, deliberately: `pauseFlowchartRun` (its own `requestPause` takes
 * this lock — the lock is not reentrant, so wrapping it would deadlock against
 * itself) and `injectFlowchartRun` (a side channel documented as usable
 * against a run another process is driving).
 */
export function withRunLifecycleLock<T>(
  stateRoot: string,
  runId: RunId,
  body: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  return withExclusiveFileLock(runLockPath(stateRoot, runId), body, options);
}

export interface StartRunInput {
  projectRoot: string;
  objective: string;
  limits?: RunLimits;
  contract?: RequirementContract;
}

/** M1: a parent run that leases child tasks to executors. */
export interface ParentRunInput {
  projectRoot: string;
  objective: string;
  children: ChildTaskInput[];
  limits?: RunLimits;
  contract?: RequirementContract;
  assignments?: readonly TaskAssignment[];
  resolvedQuestionIds?: readonly string[];
}

export interface ClusterMailRoleCount {
  readonly role: AgentRole;
  readonly count: number;
}

/**
 * Peer mail a cluster run never delivered, read once at run end. Two kinds,
 * both invisible without this:
 *
 * - `pending`: role-cast mail still sitting in a role queue. The mailbox is
 *   process-local, so mail still queued when the run returns is gone — a
 *   resumed run builds an empty one.
 * - `deadLettered`: mail the mailbox itself gave up on, straight from
 *   {@link ClusterHost.deadLetterReport}.
 */
export interface ClusterMailReport {
  readonly pending: number;
  /** Roles with queued mail, most first, ties broken by role name. */
  readonly pendingByRole: readonly ClusterMailRoleCount[];
  readonly deadLettered: number;
  readonly deadLetteredByRole: readonly ClusterMailRoleCount[];
  readonly deadLetteredByReason: readonly ClusterDeadLetterReasonCount[];
}

/**
 * Reads both undelivered-mail surfaces the host publishes. Pull, not the
 * `onDeadLetter` push: the report is recomputed from the mailbox on every call,
 * so it also carries drops caused by an out-of-band `mailbox()` claim, which
 * the push seam only reports on the *next* registration — and a run that ends
 * has no next registration. The push seam stays available for embedders that
 * want a drop while the run is still going.
 */
export function summarizeClusterMail(host: ClusterHost): ClusterMailReport {
  const mailbox = host.mailbox();
  const pendingByRole = AGENT_ROLES.flatMap((role) => {
    const count = mailbox.pendingForRole(role).length;
    return count === 0 ? [] : [{ role, count }];
  }).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
  const deadLetters = host.deadLetterReport();
  return {
    pending: pendingByRole.reduce((total, entry) => total + entry.count, 0),
    pendingByRole,
    deadLettered: deadLetters.total,
    deadLetteredByRole: deadLetters.byRole,
    deadLetteredByReason: deadLetters.byReason
  };
}

export interface RunOutcome {
  runId: RunId;
  status: RunStatus;
  events: Event[];
  checkpoint: RunCheckpoint;
  project: ProjectSnapshot;
  /** Undelivered peer mail; absent when the run had no cluster. */
  clusterMail?: ClusterMailReport;
}

export interface RunningRun {
  runId: RunId;
  done: Promise<RunOutcome>;
  cancel(): void;
}

function bounded(text: string, limit = SUMMARY_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export function startRun(deps: CoordinatorDeps, input: StartRunInput): RunningRun {
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const runId = createRunId(generateId);

  // Same acquisition as the parent run below: `run --objective` reaches this
  // embedder, so a delete aimed at one of its runs must wait for it too.
  // Discovery stays outside it — a run refused there has written nothing, and
  // the lock would create `runtime/runs/` for a run that never started.
  const done = (async (): Promise<RunOutcome> => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
    return withRunLifecycleLock(deps.stateRoot, runId, () => runM0Run(project), deps.runLock);
  })();

  async function runM0Run(project: ProjectSnapshot): Promise<RunOutcome> {
    const eventStore = new EventStore(deps.stateRoot, runId);
    const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
    const rootTaskId = createTaskId(generateId);
    const agentInstanceId = createAgentInstanceId(generateId);

    const run: Run = {
      id: runId,
      projectId: project.id,
      rootTaskId,
      status: "PLANNING",
      limits: input.limits ?? defaultRunLimits(),
      createdAt: now(),
      updatedAt: now()
    };

    const make = (type: M0EventType, payload: unknown, taskId?: TaskId): Event =>
      ({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        ...(taskId !== undefined ? { taskId } : {}),
        type,
        actor: "coordinator",
        payload
      }) as Event;

    const append = (event: Event) => eventStore.append(event);

    await append(make("PROJECT_DISCOVERED", { project }));
    await append(make("RUN_CREATED", { run }));
    await bindEpisodeToRun({
      stateRoot: deps.stateRoot,
      runId,
      projectId: project.id,
      objective: input.objective,
      ...(input.contract !== undefined ? { contract: input.contract } : {}),
      append,
      make: (type, payload) => make(type, payload),
      ...(generateId !== undefined ? { generateId } : {})
    });
    await append(make("RUN_STARTED", {}));
    await append(make("AGENT_STARTED", { agentInstanceId, taskId: rootTaskId }, rootTaskId));

    const agentEvent = (kind: AgentEventKind, summary: string): Event =>
      make("AGENT_EVENT", { agentInstanceId, kind, summary }, rootTaskId);

    let outcome: "SUCCESS" | "FAILURE" | "CANCELLED" = "FAILURE";
    let failureReason = "agent execution ended without a terminal event";

    try {
      let sawTerminal = false;
      for await (const executionEvent of deps.executor.execute(
        {
          runId,
          taskId: rootTaskId,
          agentInstanceId,
          prompt: input.objective,
          workingDirectory: project.rootPath
        },
        controller.signal
      )) {
        if (sawTerminal) break;
        switch (executionEvent.type) {
          case "TEXT_DELTA":
            await append(agentEvent("TEXT_DELTA", `text delta (${executionEvent.text.length} chars)`));
            break;
          case "TOOL_STARTED":
            await append(agentEvent("TOOL_STARTED", bounded(executionEvent.toolName)));
            break;
          case "TOOL_FINISHED":
            await append(agentEvent("TOOL_FINISHED", executionEvent.isError ? "tool error" : "tool finished"));
            break;
          case "TURN_FINISHED":
            await append(agentEvent("TURN_FINISHED", "turn finished"));
            break;
          case "EXECUTION_FINISHED": {
            sawTerminal = true;
            outcome = executionEvent.outcome;
            if (executionEvent.outcome === "FAILURE") {
              failureReason = "agent reported failure";
            }
            await append(make("AGENT_FINISHED", { agentInstanceId, outcome }, rootTaskId));
            break;
          }
        }
      }
    } catch (error) {
      outcome = "FAILURE";
      failureReason = error instanceof Error ? error.message : String(error);
    }

    if (outcome === "SUCCESS") {
      await append(make("RUN_COMPLETED", {}));
    } else if (outcome === "FAILURE") {
      await append(make("RUN_FAILED", { reason: failureReason }));
    } else {
      await append(make("RUN_CANCEL_REQUESTED", {}));
    }

    const beforeSettle = await eventStore.readAll();
    await settleBoundEpisode({
      stateRoot: deps.stateRoot,
      events: beforeSettle.events,
      status: replayRun(beforeSettle.events).status,
      append,
      make: (type, payload) => make(type, payload)
    });
    const read = await eventStore.readAll();
    const state = replayRun(read.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(state, now()));
    await checkpointStore.write(checkpoint);
    return { runId, status: state.status, events: read.events, checkpoint, project };
  }

  const running: RunningRun = {
    runId,
    done,
    cancel: () => controller.abort()
  };
  return running;
}

/**
 * M1: starts a parent run that leases child tasks to executors through the
 * ChildCoordinator. The parent settles COMPLETED only when every child
 * settles with a terminal result, FAILED on child failure/timeout, or
 * CANCELLED when the parent is cancelled.
 */
export function startParentRun(deps: CoordinatorDeps, input: ParentRunInput): RunningRun {
  if (input.contract !== undefined) {
    assertCoverageAllowsStart(
      input.contract,
      input.children.map((child) => ({
        id: child.taskId,
        acceptanceCriteria: child.acceptanceCriteria
      })),
      input.resolvedQuestionIds !== undefined
        ? { resolvedQuestionIds: input.resolvedQuestionIds }
        : undefined
    );
  }
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const registry = deps.registry ?? createAgentProfileRegistry(defaultAgentProfiles());
  const runId = createRunId(generateId);

  let resolveQuestion!: (question: AgentQuestion) => void;
  const questionPromise = new Promise<AgentQuestion>((resolve) => {
    resolveQuestion = resolve;
  });

  // Every record this run writes happens under the run's cooperative lock, so
  // a concurrent `delete --run` waits for the run rather than removing its
  // records mid-flight. Discovery stays outside, so a run that never starts
  // leaves nothing behind — including the lock's own parent directory.
  const done = (async (): Promise<RunOutcome> => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
    return withRunLifecycleLock(deps.stateRoot, runId, () => runParentRun(project), deps.runLock);
  })();

  async function runParentRun(project: ProjectSnapshot): Promise<RunOutcome> {
    const index = buildProjectContextIndex(project);
    const eventStore = new EventStore(deps.stateRoot, runId);
    const checkpointStore = new CheckpointStore(deps.stateRoot, runId);
    const rootTaskId = createTaskId(generateId);

    const run: Run = {
      id: runId,
      projectId: project.id,
      rootTaskId,
      status: "PLANNING",
      limits: input.limits ?? defaultRunLimits(),
      createdAt: now(),
      updatedAt: now()
    };

    const make = (type: M0EventType, payload: unknown, taskId?: TaskId): Event =>
      ({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        ...(taskId !== undefined ? { taskId } : {}),
        type,
        actor: "coordinator",
        payload
      }) as Event;

    const append = (event: Event) => eventStore.append(event);

    await append(make("PROJECT_DISCOVERED", { project }));
    await append(make("RUN_CREATED", { run }));
    await bindEpisodeToRun({
      stateRoot: deps.stateRoot,
      runId,
      projectId: project.id,
      objective: input.objective,
      ...(input.contract !== undefined ? { contract: input.contract, skipContract: false } : {}),
      append,
      make: (type, payload) => make(type, payload),
      ...(generateId !== undefined ? { generateId } : {})
    });
    await append(make("RUN_STARTED", {}));

    if (input.assignments !== undefined) {
      for (const assignment of input.assignments) {
        await append(make("MODEL_ROUTED", toModelRoutedPayload(assignment), assignment.taskId));
      }
    }

    let cancelWritten = false;
    const writeCancel = async (): Promise<void> => {
      if (cancelWritten) return;
      cancelWritten = true;
      await append(make("RUN_CANCEL_REQUESTED", {}));
    };
    controller.signal.addEventListener("abort", () => {
      void writeCancel();
    }, { once: true });

    let releaseQuestionHang = (): void => {};
    const questionHang = new Promise<void>((resolve) => {
      releaseQuestionHang = resolve;
    });

    const handles: ChildRunHandle[] = [];
    let childCoordinator!: ChildCoordinator;
    let clusterHost: ClusterHost | undefined;
    let launchChild!: (child: ChildTaskInput) => void;
    if (deps.cluster === true) {
      clusterHost = createClusterHost({
        registry,
        maxTasks: (input.limits ?? defaultRunLimits()).maxTasks,
        ...(generateId !== undefined ? { generateId } : {}),
        onSpawn: (spawned) => {
          if (!isAgentRole(spawned.role)) return;
          launchChild({
            taskId: spawned.taskId,
            role: spawned.role,
            objective: spawned.objective,
            profile: registry.resolve(spawned.role),
            inputArtifactIds: [],
            acceptanceCriteria: [],
            limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
          });
        }
      });
    }

    childCoordinator = new ChildCoordinator({
      stateRoot: deps.stateRoot,
      executor: deps.executor,
      parentRunId: runId,
      project,
      registry,
      maxConcurrentTasks: (input.limits ?? defaultRunLimits()).maxConcurrentTasks,
      now,
      ...(generateId !== undefined ? { generateId } : {}),
      ...(clusterHost !== undefined ? { cluster: clusterHost } : {}),
      onQuestion: async (question) => {
        // Persist WAITING_FOR_USER via the child's QUESTION path. Never
        // auto-answer with "" — hang until the parent has recorded the pause,
        // then fail the in-flight attempt so the process can exit.
        resolveQuestion(question);
        await questionHang;
        throw new DomainValidationError("run is waiting for an explicit user answer");
      }
    });

    const remaining = [...input.children];
    const launched = new Map<TaskId, ChildTaskInput>();
    const finished = new Map<TaskId, ChildRunOutcome>();
    launchChild = (child: ChildTaskInput): void => {
      launched.set(child.taskId, child);
      const depIds = child.dependsOn ?? [];
      const predecessors = depIds.flatMap((id) => {
        const outcome = finished.get(id);
        return outcome === undefined
          ? []
          : [
              {
                taskId: outcome.taskId,
                summary: outcome.summary,
                artifactIds: outcome.artifactIds
              }
            ];
      });
      handles.push(
        childCoordinator.startChildTask(
          groundChildTask({
            child,
            predecessors,
            index,
            ...(input.contract !== undefined ? { contract: input.contract } : {})
          }),
          controller.signal
        )
      );
    };
    const startReady = (): void => {
      for (const child of [...remaining]) {
        const deps = child.dependsOn ?? [];
        const depFailed = deps.some((id) => {
          const outcome = finished.get(id);
          return (
            outcome !== undefined &&
            (outcome.outcome === "FAILURE" || outcome.outcome === "TIMEOUT" || outcome.outcome === "CANCELLED")
          );
        });
        if (depFailed) {
          remaining.splice(remaining.indexOf(child), 1);
          continue;
        }
        const ready = deps.every((id) => {
          const outcome = finished.get(id);
          return outcome?.outcome === "SUCCESS" || outcome?.outcome === "PARTIAL";
        });
        if (!ready) continue;
        remaining.splice(remaining.indexOf(child), 1);
        launchChild(child);
      }
    };
    startReady();

    let status: RunStatus = "RUNNING";
    let failureReason: string | undefined;
    let trackingBlocked = false;

    try {
      let waiting = false;
      while (!waiting && !trackingBlocked) {
        const active = handles.filter((handle) => !finished.has(handle.taskId));
        if (active.length === 0) {
          startReady();
          const stillActive = handles.filter((handle) => !finished.has(handle.taskId));
          if (stillActive.length === 0) break;
          continue;
        }
        const raced = await Promise.race([
          Promise.race(
            active.map((handle) => handle.done.then((childOutcome) => ({ kind: "child" as const, childOutcome })))
          ),
          questionPromise.then((question) => ({ kind: "question" as const, question }))
        ]);
        if (raced.kind === "question") {
          waiting = true;
          status = "WAITING_FOR_USER";
          break;
        }
        finished.set(raced.childOutcome.taskId, raced.childOutcome);
        const spec = launched.get(raced.childOutcome.taskId);
        const current = await eventStore.readAll();
        const gated = applyChildThreeLine({
          events: current.events,
          child: raced.childOutcome,
          nowIso: now(),
          generateEventId: () => createEventId(generateId),
          ...(spec !== undefined ? { spec } : {}),
          ...(input.contract !== undefined ? { contract: input.contract } : {})
        });
        for (const event of gated.events.slice(current.events.length)) {
          await append(event);
        }
        if (gated.result.directive === "wait_user") {
          waiting = true;
          status = "WAITING_FOR_USER";
          break;
        }
        if (gated.result.directive === "queue_analysis") {
          trackingBlocked = true;
          status = "BLOCKED";
          break;
        }
        startReady();
      }
      if (waiting) {
        // RUN_WAITING_FOR_USER already recorded on the question or gate path.
      } else if (trackingBlocked) {
        status = "BLOCKED";
      } else {
        const outcomes = [...finished.values()];
        const failures = outcomes.filter(
          (childOutcome) => childOutcome.outcome === "FAILURE" || childOutcome.outcome === "TIMEOUT"
        );
        if (controller.signal.aborted) {
          status = "CANCELLED";
          await writeCancel();
        } else if (failures.length > 0 || remaining.length > 0) {
          status = "FAILED";
          failureReason =
            failures.length > 0
              ? failures.map((childOutcome) => `${childOutcome.taskId}: ${childOutcome.summary}`).join("; ")
              : `unstarted children: ${remaining.map((child) => child.taskId).join(", ")}`;
          await append(make("RUN_FAILED", { reason: failureReason }));
        } else {
          status = "COMPLETED";
          await append(make("RUN_COMPLETED", {}));
        }
      }
    } catch (error) {
      status = "FAILED";
      failureReason = error instanceof Error ? error.message : String(error);
      await append(make("RUN_FAILED", { reason: failureReason }));
    } finally {
      releaseQuestionHang();
      await Promise.allSettled(handles.map((handle) => handle.done));
    }

    const beforeSettle = await eventStore.readAll();
    await settleBoundEpisode({
      stateRoot: deps.stateRoot,
      events: beforeSettle.events,
      status,
      append,
      make: (type, payload) => make(type, payload)
    });
    const read = await eventStore.readAll();
    const state = replayRun(read.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(state, now()));
    await checkpointStore.write(checkpoint);
    return {
      runId,
      status,
      events: read.events,
      checkpoint,
      project,
      ...(clusterHost !== undefined ? { clusterMail: summarizeClusterMail(clusterHost) } : {})
    };
  }

  const running: RunningRun = {
    runId,
    done,
    cancel: () => controller.abort()
  };
  return running;
}

function toModelRoutedPayload(assignment: TaskAssignment): ModelRoutedPayload {
  const decision = assignment.decision;
  return {
    taskId: decision.taskId,
    role: decision.role,
    complexity: decision.complexity,
    model: decision.model,
    justification: decision.justification,
    confidence: decision.confidence,
    approvalPlan: decision.approvalPlan,
    statusAfterRoute: decision.statusAfterRoute,
    policyVersion: decision.policyVersion,
    estimatedCostUsd: decision.estimatedCostUsd,
    estimatedDurationMs: decision.estimatedDurationMs,
    ...routingContextFields(decision)
  };
}
