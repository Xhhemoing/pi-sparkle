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
import type { AgentProfileRegistry } from "../agents/registry.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import type { AgentExecutor } from "../execution/contract.js";
import { discoverProject } from "../project/discovery.js";
import type { AgentQuestion } from "../protocol/v1.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { ChildCoordinator, type ChildTaskInput } from "./child-coordinator.js";
import { EventStore } from "./event-store.js";
import { type AgentEventKind, type Event, type M0EventType } from "./events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint, type RunCheckpoint } from "./replay.js";

const SUMMARY_LIMIT = 500;

export interface CoordinatorDeps {
  stateRoot: string;
  executor: AgentExecutor;
  registry?: AgentProfileRegistry;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
}

export interface StartRunInput {
  projectRoot: string;
  objective: string;
  limits?: RunLimits;
}

/** M1: a parent run that leases child tasks to executors. */
export interface ParentRunInput {
  projectRoot: string;
  objective: string;
  children: ChildTaskInput[];
  limits?: RunLimits;
}

export interface RunOutcome {
  runId: RunId;
  status: RunStatus;
  events: Event[];
  checkpoint: RunCheckpoint;
  project: ProjectSnapshot;
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
            await append(agentEvent("TEXT_DELTA", bounded(executionEvent.text)));
            break;
          case "TOOL_STARTED":
            await append(agentEvent("TOOL_STARTED", bounded(executionEvent.toolName)));
            break;
          case "TOOL_FINISHED":
            await append(agentEvent("TOOL_FINISHED", bounded(executionEvent.summary)));
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

    const read = await eventStore.readAll();
    const state = replayRun(read.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(state, now()));
    await checkpointStore.write(checkpoint);
    return { runId, status: state.status, events: read.events, checkpoint, project };
  })();

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
  const controller = new AbortController();
  const now = deps.now ?? nowIso;
  const generateId = deps.generateId;
  const registry = deps.registry ?? createAgentProfileRegistry(defaultAgentProfiles());
  const runId = createRunId(generateId);

  let resolveQuestion!: (question: AgentQuestion) => void;
  const questionPromise = new Promise<AgentQuestion>((resolve) => {
    resolveQuestion = resolve;
  });

  const done = (async (): Promise<RunOutcome> => {
    const project = await discoverProject(input.projectRoot, {
      now,
      ...(generateId !== undefined ? { generateId } : {})
    });
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
    await append(make("RUN_STARTED", {}));

    const childCoordinator = new ChildCoordinator({
      stateRoot: deps.stateRoot,
      executor: deps.executor,
      parentRunId: runId,
      project,
      registry,
      maxConcurrentTasks: (input.limits ?? defaultRunLimits()).maxConcurrentTasks,
      now,
      ...(generateId !== undefined ? { generateId } : {}),
      onQuestion: async (question) => {
        // M1: questions pause the parent in WAITING_FOR_USER until the CLI
        // supplies an explicit answer event. The child stays paused.
        resolveQuestion(question);
        await new Promise<void>(() => {});
        return "";
      }
    });

    const handles = input.children.map((child) =>
      childCoordinator.startChildTask(child, controller.signal)
    );

    let status: RunStatus;
    let failureReason: string | undefined;

    try {
      const allChildren = Promise.all(handles.map((handle) => handle.done));
      const raced = await Promise.race([
        allChildren.then((outcomes) => ({ kind: "settled" as const, outcomes })),
        questionPromise.then((q) => ({ kind: "question" as const, question: q }))
      ]);
      if (raced.kind === "question") {
        status = "WAITING_FOR_USER";
      } else {
        const failures = raced.outcomes.filter(
          (childOutcome) => childOutcome.outcome === "FAILURE" || childOutcome.outcome === "TIMEOUT"
        );
        if (controller.signal.aborted) {
          status = "CANCELLED";
          await append(make("RUN_CANCEL_REQUESTED", {}));
        } else if (failures.length > 0) {
          status = "FAILED";
          failureReason = failures
            .map((childOutcome) => `${childOutcome.taskId}: ${childOutcome.summary}`)
            .join("; ");
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
    }

    const read = await eventStore.readAll();
    const state = replayRun(read.events);
    const checkpoint = validateCheckpoint(materializeCheckpoint(state, now()));
    await checkpointStore.write(checkpoint);
    return { runId, status, events: read.events, checkpoint, project };
  })();

  const running: RunningRun = {
    runId,
    done,
    cancel: () => controller.abort()
  };
  return running;
}
