import {
  type AgentInstanceId,
  type MessageId,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import type { RunStatus } from "../domain/status.js";
import {
  isTerminalMessage,
  type AgentMessage,
  type AgentQuestion,
  type TaskResult
} from "../protocol/v1.js";
import { EventStore } from "./event-store.js";
import type { Event } from "./events.js";
import { replayRun } from "./replay.js";

export interface ChildInspection {
  childRunId: RunId;
  taskId: TaskId;
  /** Outcome derived from the terminal TASK_RESULT, or "RUNNING" if open. */
  outcome: "SUCCESS" | "PARTIAL" | "FAILURE" | "CANCELLED" | "TIMEOUT" | "RUNNING";
  attempts: number;
  messages: AgentMessage[];
  terminalResult?: TaskResult;
  timedOut: boolean;
}

export interface AnswerRecord {
  messageId: MessageId;
  answer: string;
}

export interface RunInspection {
  runId: RunId;
  status: RunStatus;
  children: ChildInspection[];
  pendingQuestions: AgentQuestion[];
  answers: AnswerRecord[];
  agentInstanceIds: AgentInstanceId[];
  /**
   * Evidence the latest STALL_DETECTED / RUN_BLOCKED event asked for, verbatim
   * and in event order. Empty when the run never stalled or blocked; entries are
   * never derived from anything but those payloads.
   */
  requiredEvidence: readonly string[];
}

/**
 * Frozen `--summary-json` contract. Additive changes only: consumers pin
 * `type`/`runId`/`status`/`requiredEvidence`. New keys may be added; existing
 * keys keep meaning. Not a domain Event (no `id`; `type` is outside the Event
 * union). JSON mode stdout is exactly one object.
 */
export interface InspectSummaryJson {
  readonly type: "INSPECT_SUMMARY";
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly requiredEvidence: readonly string[];
}

/**
 * Projects a `RunInspection` onto the frozen summary shape. Pure: it copies
 * `requiredEvidence` verbatim and derives nothing the inspection did not
 * already collect from `STALL_DETECTED` / `RUN_BLOCKED`.
 */
export function buildInspectSummaryJson(inspection: RunInspection): InspectSummaryJson {
  return {
    type: "INSPECT_SUMMARY",
    runId: inspection.runId,
    status: inspection.status,
    requiredEvidence: [...inspection.requiredEvidence]
  };
}

interface ChildAccumulator {
  childRunId: RunId;
  taskId: TaskId;
  messages: AgentMessage[];
  attempts: number;
  timedOut: boolean;
  terminalResult?: TaskResult;
}

function outcomeOf(child: ChildAccumulator): ChildInspection["outcome"] {
  if (child.terminalResult !== undefined) {
    return child.terminalResult.outcome;
  }
  if (child.timedOut) return "TIMEOUT";
  return "RUNNING";
}

/** Reconstructs M1 parent-child state from a parent run's persisted events. */
export async function inspectRun(stateRoot: string, runId: RunId): Promise<RunInspection> {
  const store = new EventStore(stateRoot, runId);
  const read = await store.readAll();
  const events = read.events;
  const replayed = replayRun(events);

  const children = new Map<RunId, ChildAccumulator>();
  const pendingQuestions: AgentQuestion[] = [];
  const answers: AnswerRecord[] = [];
  const agentInstanceIds = new Set<AgentInstanceId>();
  const answeredQuestionIds = new Set<MessageId>();
  let requiredEvidence: readonly string[] = [];

  // First pass: collect answers so pending questions exclude answered ones.
  for (const event of events) {
    if (event.type === "USER_ANSWER") {
      answeredQuestionIds.add(event.payload.messageId);
      answers.push({ messageId: event.payload.messageId, answer: event.payload.answer });
    }
  }

  for (const event of events) {
    switch (event.type) {
      case "CHILD_RUN_CREATED": {
        const child = event.payload.childRun;
        children.set(child.id, {
          childRunId: child.id,
          taskId: child.rootTaskId,
          messages: [],
          attempts: 0,
          timedOut: false
        });
        break;
      }
      case "CHILD_MESSAGE": {
        const message = event.payload.message;
        const child = findChild(children, event.taskId, message);
        if (child === undefined) break;
        child.messages.push(message);
        if (isTerminalMessage(message)) {
          child.terminalResult = message;
        }
        if (message.type === "QUESTION" && !answeredQuestionIds.has(message.id)) {
          pendingQuestions.push(message);
        }
        break;
      }
      case "TASK_TIMEOUT": {
        const child = children.get(event.payload.childRunId);
        if (child !== undefined) {
          child.timedOut = true;
          child.attempts = Math.max(child.attempts, event.payload.attempt);
        }
        break;
      }
      case "TASK_RETRY": {
        const child = children.get(event.payload.childRunId);
        if (child !== undefined) {
          child.attempts = Math.max(child.attempts, event.payload.attempt);
        }
        break;
      }
      case "STALL_DETECTED":
      case "RUN_BLOCKED":
        // Last writer wins: a run can stall repeatedly, and only the newest
        // demand describes what it is still waiting for.
        requiredEvidence = [...event.payload.requiredEvidence];
        break;
      case "AGENT_STARTED":
        agentInstanceIds.add(event.payload.agentInstanceId);
        break;
      case "AGENT_FINISHED":
        agentInstanceIds.add(event.payload.agentInstanceId);
        break;
      default:
        break;
    }
  }

  return {
    runId,
    status: replayed.status,
    children: Array.from(children.values()).map((child) => ({
      childRunId: child.childRunId,
      taskId: child.taskId,
      outcome: outcomeOf(child),
      attempts: Math.max(1, child.attempts),
      messages: child.messages,
      ...(child.terminalResult !== undefined ? { terminalResult: child.terminalResult } : {}),
      timedOut: child.timedOut
    })),
    pendingQuestions,
    answers,
    agentInstanceIds: Array.from(agentInstanceIds),
    requiredEvidence
  };
}

function findChild(
  children: Map<RunId, ChildAccumulator>,
  eventTaskId: TaskId | undefined,
  message: AgentMessage
): ChildAccumulator | undefined {
  // Prefer matching by run id first (protocol envelopes carry the child run).
  const byRun = children.get(message.runId);
  if (byRun !== undefined) return byRun;
  // Fall back to the event's task id (TASK_REQUEST is addressed to the child).
  if (eventTaskId !== undefined) {
    for (const child of Array.from(children.values())) {
      if (child.taskId === eventTaskId) return child;
    }
  }
  return undefined;
}

/** Convenience re-export so callers do not need to import Event directly. */
export type { Event };
