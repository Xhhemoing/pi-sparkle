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
import type { AgentExecutor } from "../execution/contract.js";
import { discoverProject } from "../project/discovery.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { EventStore } from "./event-store.js";
import { type AgentEventKind, type Event, type M0EventType } from "./events.js";
import { materializeCheckpoint, replayRun, validateCheckpoint, type RunCheckpoint } from "./replay.js";

const SUMMARY_LIMIT = 500;

export interface CoordinatorDeps {
  stateRoot: string;
  executor: AgentExecutor;
  now?: () => IsoTimestamp;
  generateId?: IdGenerator;
}

export interface StartRunInput {
  projectRoot: string;
  objective: string;
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
