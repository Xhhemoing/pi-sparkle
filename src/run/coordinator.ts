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
import { createClusterHost, type ClusterHost } from "../cluster/host.js";
import { isAgentRole } from "../domain/roles.js";
import type { TaskAssignment } from "../routing/assign.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { ChildCoordinator, type ChildRunHandle, type ChildRunOutcome, type ChildTaskInput } from "./child-coordinator.js";
import { groundChildTask } from "./child-grounding.js";
import { EventStore } from "./event-store.js";
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

export interface RunOutcome {
  runId: RunId;
  status: RunStatus;
  events: Event[];
  checkpoint: RunCheckpoint;
  project: ProjectSnapshot;
}

export interface SteerOptions {
  /** Who is steering. Recorded as the event actor. Defaults to `user`. */
  actor?: string;
}

export interface RunningRun {
  runId: RunId;
  done: Promise<RunOutcome>;
  cancel(): void;
  /**
   * Push user-authored text into the agent loop while `done` is still
   * pending. The agent picks it up after its current turn, so a steer sent
   * during a long tool call lands before the next model call.
   *
   * This is not the flowchart `inject` verb. `inject` records a typed policy
   * fact (`fact | override | skip`) for the supervisor to read; `steer` adds a
   * conversational turn the model itself sees. The two are logged as different
   * event types on purpose, so an audit can tell which one changed a run.
   *
   * Throws `DomainValidationError` synchronously when the text is blank, when
   * no run is in flight, or when the executor does not implement steering —
   * the text is never accepted and then quietly dropped. The returned promise
   * resolves once the steer is recorded in the event log; the run itself also
   * waits for that write before it settles, so ignoring the promise loses the
   * error, not the record.
   */
  steer(text: string, options?: SteerOptions): Promise<void>;
}

const DEFAULT_STEER_ACTOR = "user";

/**
 * The run-level half of steering: a window that is open only while the
 * executor is running, plus the event-log write that must land before the run
 * settles.
 *
 * Validation and delivery are synchronous even though the log write is not, so
 * a rejected steer reaches the caller as a thrown error rather than a rejected
 * promise nobody awaited.
 */
class SteerChannel {
  private record: ((text: string, actor: string) => Promise<void>) | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly executor: AgentExecutor) {}

  open(record: (text: string, actor: string) => Promise<void>): void {
    this.record = record;
  }

  close(): void {
    this.record = undefined;
  }

  steer(text: string, options: SteerOptions = {}): Promise<void> {
    if (text.trim() === "") {
      throw new DomainValidationError("steer text must be a non-empty string");
    }
    const actor = options.actor ?? DEFAULT_STEER_ACTOR;
    if (actor.trim() === "") {
      throw new DomainValidationError("steer actor must be a non-empty string");
    }
    const record = this.record;
    if (record === undefined) {
      throw new DomainValidationError("cannot steer: the run has no agent execution in flight");
    }
    if (this.executor.steerText === undefined) {
      throw new DomainValidationError("cannot steer: this executor does not support steering");
    }
    // Delivery before logging: an event describing a steer the agent never
    // received would be a false record of what the run was told.
    this.executor.steerText(text);
    const write = record(text, actor);
    this.writes = Promise.allSettled([this.writes, write]).then(() => undefined);
    return write;
  }

  /** Resolves once every accepted steer has finished writing, failures included. */
  async settled(): Promise<void> {
    await this.writes;
  }
}

function bounded(text: string, limit = SUMMARY_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export function startRun(deps: CoordinatorDeps, input: StartRunInput): RunningRun {
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const runId = createRunId(generateId);
  const steerChannel = new SteerChannel(deps.executor);

  const done = (async (): Promise<RunOutcome> => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
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

    // Open before the first `next()` on the executor's iterator so a steer
    // arriving with the very first event has somewhere to go.
    steerChannel.open((text, actor) =>
      append({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        taskId: rootTaskId,
        type: "STEER_INJECTED",
        actor,
        payload: { agentInstanceId, text }
      })
    );

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
          case "THINKING_DELTA":
            await append(agentEvent("THINKING_DELTA", `thinking delta (${executionEvent.bytes} bytes)`));
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
    } finally {
      steerChannel.close();
    }
    // Accepted steers are written concurrently with the stream; the run must
    // not read its own log back before they land.
    await steerChannel.settled();

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
  })();

  const running: RunningRun = {
    runId,
    done,
    cancel: () => controller.abort(),
    steer: (text, options) => steerChannel.steer(text, options)
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
  const steerChannel = new SteerChannel(deps.executor);

  let resolveQuestion!: (question: AgentQuestion) => void;
  const questionPromise = new Promise<AgentQuestion>((resolve) => {
    resolveQuestion = resolve;
  });

  const done = (async (): Promise<RunOutcome> => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
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

    // A parent run has no agent of its own, so a steer targets whichever child
    // the shared executor currently has in flight. The executor refuses when
    // that is ambiguous rather than broadcasting to every concurrent child.
    steerChannel.open((text, actor) =>
      append({
        id: createEventId(generateId),
        schemaVersion: 1,
        occurredAt: now(),
        runId,
        type: "STEER_INJECTED",
        actor,
        payload: { text }
      })
    );

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
      steerChannel.close();
      releaseQuestionHang();
      await Promise.allSettled(handles.map((handle) => handle.done));
    }
    await steerChannel.settled();

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
    return { runId, status, events: read.events, checkpoint, project };
  })();

  const running: RunningRun = {
    runId,
    done,
    cancel: () => controller.abort(),
    steer: (text, options) => steerChannel.steer(text, options)
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
