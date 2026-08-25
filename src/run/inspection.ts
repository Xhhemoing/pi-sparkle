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
  type CriterionVerification,
  type TaskResult
} from "../protocol/v1.js";
import type { AnomalyCode, GateKind, PrescoreDimensionId } from "../tracking/types.js";
import { EventStore } from "./event-store.js";
import type { Event, GateTransitionPayload } from "./events.js";
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

/**
 * The reason a gate-blocked run is on the floor, which is not the reason its
 * `RUN_BLOCKED` row carries.
 *
 * On the gate path that payload's `reason` is the constant `ANALYSIS_QUEUED`
 * (`gate-apply.ts`): the queue the block was filed under, not the anomaly that
 * caused it. The anomaly is `GATE_TRANSITION.payload.reasonCode`; the
 * dimensions that failed are on the `TRACKING_ASSESSMENT` that transition
 * cites; the acceptance criterion a child reported unmet is on that child's own
 * terminal `CHILD_MESSAGE`. All three are durable and validated, and until now
 * no shipped verb rendered any of them, so an operator diagnosing the ordinary
 * block had to open `events.jsonl` by hand.
 *
 * This reads the persisted log and derives nothing else. In particular it never
 * consults `GateApplyResult` — that reconstruction is the gate's ledger entry
 * and not an authority anything outside `gate-apply.ts` may read.
 */
export interface GateBlockCause {
  /** `GATE_TRANSITION.payload.reasonCode`: the leading anomaly code. */
  readonly reasonCode: string;
  /** The transition's turn, which on the child path is the blocking task's id. */
  readonly turnId: string;
  /** The assessment the transition cites, when it is still on the log. */
  readonly gateKind?: GateKind;
  /** Every code the gate raised, leading one first. Empty when the assessment is gone. */
  readonly codes: readonly AnomalyCode[];
  readonly failedDimensions: readonly PrescoreDimensionId[];
  /** Criteria the child itself reported FAILED; UNOBSERVED and absent stay open. */
  readonly unmetCriteria: readonly CriterionVerification[];
}

/** The gate's constant `RUN_BLOCKED` reason. Owned by `gate-apply.ts`; matched, never written. */
const GATE_BLOCK_REASON = "ANALYSIS_QUEUED";

/**
 * The cause behind the newest `RUN_BLOCKED`, or `undefined` when that block did
 * not come from the tracking gate (the stall detector writes its own reason,
 * which already says what happened) or when no transition precedes it.
 *
 * The transition is taken from before the block rather than from the end of the
 * log: the gate writes the pair together, so the newest transition *preceding*
 * the newest block is the one that filed it, and a run that blocks twice does
 * not read the second block's cause onto the first.
 */
export function gateBlockCause(events: readonly Event[]): GateBlockCause | undefined {
  const blockedIndex = events.findLastIndex((event) => event.type === "RUN_BLOCKED");
  const blocked = blockedIndex < 0 ? undefined : events[blockedIndex];
  if (blocked?.type !== "RUN_BLOCKED" || blocked.payload.reason !== GATE_BLOCK_REASON) {
    return undefined;
  }
  let transition: GateTransitionPayload | undefined;
  for (let index = blockedIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "GATE_TRANSITION") {
      transition = event.payload;
      break;
    }
  }
  if (transition === undefined) return undefined;

  const cited = transition.assessmentHash;
  const assessment = events.findLast(
    (event): event is Extract<Event, { type: "TRACKING_ASSESSMENT" }> =>
      event.type === "TRACKING_ASSESSMENT" && event.payload.assessmentHash === cited
  )?.payload.assessment;

  // Last writer wins, as everywhere else in this file: a retried task can
  // report more than once and only its newest verdict describes the block.
  let reported: readonly CriterionVerification[] = [];
  for (const event of events) {
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT" || message.taskId !== transition.turnId) continue;
    reported = message.verification.criteria ?? [];
  }

  return {
    reasonCode: transition.reasonCode,
    turnId: transition.turnId,
    ...(assessment !== undefined ? { gateKind: assessment.gate.kind } : {}),
    codes: assessment?.gate.codes ?? [],
    failedDimensions: (assessment?.dimensions ?? [])
      .filter((dimension) => dimension.verdict === "FAIL")
      .map((dimension) => dimension.id),
    // The frozen rule `tracking/from-child.ts::unmetCriteriaOf` applies: only a
    // reported FAILED is the child saying it fell short. UNOBSERVED means the
    // verifier did not look and an absent array means it spoke only about the
    // task, and neither is a criterion this block can name.
    unmetCriteria: reported.filter((criterion) => criterion.kind === "FAILED")
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
