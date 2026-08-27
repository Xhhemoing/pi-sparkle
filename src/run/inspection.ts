import { performance } from "node:perf_hooks";
import { DomainValidationError } from "../domain/errors.js";
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
import { EventStore, type EventLogRecovery } from "./event-store.js";
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
 * which already says what happened) or when the row before it is not the
 * transition that filed it.
 *
 * The pairing is adjacency, not proximity. `gate-apply.ts` appends
 * `GATE_TRANSITION` and then `RUN_BLOCKED` inside one `applyTrackingGate` call
 * with nothing in between, so on any log the gate wrote, the transition that
 * filed a block is `events[blockedIndex - 1]` exactly. Scanning further back
 * would accept a transition separated from the block by other valid rows — a
 * `PAUSE_REQUESTED`, or an older block/unblock cycle whose own transition is
 * still on the log — and print that older turn's anomaly as this block's cause.
 * Each of those rows is individually valid, so only the pairing rules them out.
 *
 * The immediately preceding transition must also be one that could have filed a
 * block: `gate-apply.ts` writes `RUN_BLOCKED` only from the `queue_analysis`
 * directive, whose transition always carries `to: "BLOCKED"`. Anything else,
 * including no preceding event at all, reads as no cause rather than as
 * someone else's.
 */
export function gateBlockCause(events: readonly Event[]): GateBlockCause | undefined {
  const blockedIndex = events.findLastIndex((event) => event.type === "RUN_BLOCKED");
  const blocked = blockedIndex < 0 ? undefined : events[blockedIndex];
  if (blocked?.type !== "RUN_BLOCKED" || blocked.payload.reason !== GATE_BLOCK_REASON) {
    return undefined;
  }
  const preceding = blockedIndex === 0 ? undefined : events[blockedIndex - 1];
  if (preceding?.type !== "GATE_TRANSITION") return undefined;
  const transition: GateTransitionPayload = preceding.payload;
  if (transition.directive !== "queue_analysis" || transition.to !== "BLOCKED") {
    return undefined;
  }

  // Everything this cause cites has to have been on the log when the block was
  // filed. A row appended afterwards belongs to work that came later and cannot
  // be evidence for a decision already recorded.
  const atOrBeforeBlock = events.slice(0, blockedIndex);

  // Both keys are written in the same `applyTrackingGate` call, so the pair is
  // exact. The hash alone would match a re-assessment that hashed identically
  // under a later sequence number, which is a different turn of the gate.
  const cited = transition.assessmentHash;
  const citedSeq = transition.seq;
  const assessment = atOrBeforeBlock.findLast(
    (event): event is Extract<Event, { type: "TRACKING_ASSESSMENT" }> =>
      event.type === "TRACKING_ASSESSMENT" &&
      event.payload.assessmentHash === cited &&
      event.payload.seq === citedSeq
  )?.payload.assessment;

  // Last writer wins, as everywhere else in this file: a retried task can
  // report more than once and only its newest verdict describes the block.
  let reported: readonly CriterionVerification[] = [];
  for (const event of atOrBeforeBlock) {
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

/**
 * Where `inspect --follow` stops.
 *
 * Two different reasons, one list. `COMPLETED` / `FAILED` / `CANCELLED` are
 * terminal: the log is closed and nothing will ever be appended again.
 * `BLOCKED` / `WAITING_FOR_USER` / `PAUSED` are not terminal — the run can be
 * continued — but only by an operator running `unblock`, `answer` or
 * `resume --unpause` in another shell. A follower that kept polling through
 * those would sit there forever waiting for a human it is not talking to, so
 * it stops and says which state it stopped in. That is the whole difference
 * between this list and `isTerminalRunStatus`, and it is why follow's exit code
 * says "the log stopped", never "the run succeeded".
 */
export const FOLLOW_STOP_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
  "WAITING_FOR_USER",
  "PAUSED"
] as const satisfies readonly RunStatus[];

export function isFollowStopStatus(status: RunStatus): boolean {
  return (FOLLOW_STOP_STATUSES as readonly RunStatus[]).includes(status);
}

/** Poll gap between reads of `events.jsonl`. */
export const DEFAULT_FOLLOW_INTERVAL_MS = 250;

export interface FollowRunOptions {
  readonly intervalMs?: number;
  /** Injectable for tests; the default is a plain `setTimeout` sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly signal?: AbortSignal;
  /**
   * Opt-in idle deadline: give up after this many milliseconds in which the
   * log grew by nothing. Absent means no deadline, which is the behaviour
   * every caller had before this option existed.
   *
   * Idle, not total. A run that keeps appending is followed for as long as it
   * keeps appending, however long that is; what the deadline bounds is
   * *silence*, because silence is the only thing that distinguishes a log
   * nobody is writing to any more from one that is simply slow. Every append
   * starts the clock over.
   */
  readonly idleTimeoutMs?: number;
  /**
   * Injectable clock for the idle deadline, in milliseconds. The default is
   * `performance.now`, which is monotonic: a wall-clock step (NTP, a laptop
   * waking up) must not be able to spend a follower's deadline for it.
   */
  readonly now?: () => number;
}

export interface FollowRunResult {
  /** Replayed status at the last read; undefined when the log vanished. */
  readonly status?: RunStatus;
  /** How many events were handed to the callback in total. */
  readonly emitted: number;
  readonly stopReason: "status" | "log-vanished" | "aborted" | "idle-timeout";
  /** Tail state of the final read: set only if a line was still incomplete. */
  readonly recovery: EventLogRecovery;
  /**
   * How long the log had been silent when an `idle-timeout` stop gave up. Set
   * only for that stop reason: it is what the deadline actually measured, and
   * it is at least `idleTimeoutMs` but not exactly it, because the deadline is
   * only looked at once per poll.
   */
  readonly idleMs?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Read-only tail of one run's event log.
 *
 * This is a *reader*, and everything about it follows from that. It takes no
 * run lock, so it can never make an appender wait; it opens nothing for
 * writing and appends nothing, so a crash mid-follow leaves no trace; and it
 * starts no daemon or watcher, so the only thing it holds between polls is a
 * timer. Polling rather than `fs.watch` is deliberate: watch semantics differ
 * per platform and coalesce events, while re-reading an append-only file is
 * exact and costs one read per interval on a preview-sized log.
 *
 * Reads go through `EventStore.readAll`, so a torn final line — the normal
 * shape of a file being appended to right now — is skipped instead of being
 * printed or treated as corruption, and is picked up on the poll after the
 * writer finishes it. `emitted` therefore only ever advances over complete
 * events, which is what makes slicing by index safe.
 *
 * A log that *shrinks* is not something an append-only writer can do, so the
 * only ways to see it are `delete --run` and a truncation outside the runtime.
 * Following stops with `log-vanished` rather than pretending the run is still
 * there.
 *
 * `idleTimeoutMs` is the one bound on how long this can run, and it is opt-in
 * for a reason: a run that appends nothing for a minute is usually a run
 * inside a slow provider call, and a default deadline would report those as
 * dead. A caller that would rather bound the wait says so, and then a stop is
 * `idle-timeout` — never `status` — so the silence is never dressed up as a
 * run that finished.
 */
export async function followRunEvents(
  stateRoot: string,
  runId: RunId,
  onEvents: (events: readonly Event[]) => void,
  options: FollowRunOptions = {}
): Promise<FollowRunResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_FOLLOW_INTERVAL_MS;
  const idleTimeoutMs = validateIdleTimeoutMs(options.idleTimeoutMs);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? defaultNow;
  const store = new EventStore(stateRoot, runId);
  let emitted = 0;
  // The deadline runs from attach, not from the first append: a log that was
  // already silent before anyone attached to it is exactly the case this
  // exists for.
  let lastAppendAt = now();

  for (;;) {
    if (options.signal?.aborted === true) {
      return { emitted, stopReason: "aborted", recovery: {} };
    }
    const read = await store.readAll();
    // A run with no events at all is either deleted or never existed; either
    // way there is nothing to follow and no status to report.
    if (read.events.length < Math.max(emitted, 1)) {
      return { emitted, stopReason: "log-vanished", recovery: read.recovery };
    }
    if (read.events.length > emitted) {
      onEvents(read.events.slice(emitted));
      emitted = read.events.length;
      lastAppendAt = now();
    }
    const status = replayRun(read.events).status;
    // Checked before the deadline, so a log that reached a stopping state on
    // the same poll it ran out of patience is reported as the stop it is.
    if (isFollowStopStatus(status)) {
      return { status, emitted, stopReason: "status", recovery: read.recovery };
    }
    if (idleTimeoutMs !== undefined) {
      const idleMs = now() - lastAppendAt;
      if (idleMs >= idleTimeoutMs) {
        return { status, emitted, stopReason: "idle-timeout", recovery: read.recovery, idleMs };
      }
    }
    await sleep(intervalMs);
  }
}

function defaultNow(): number {
  return performance.now();
}

/**
 * A deadline of zero, a fraction of a millisecond or a negative number is a
 * caller mistake, not a shorthand: refusing it here keeps "no deadline" spelled
 * exactly one way (omit the option) instead of two that behave differently.
 */
function validateIdleTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainValidationError(
      `follow idleTimeoutMs must be a whole number of milliseconds greater than 0, got: ${value}`
    );
  }
  return value;
}

/** Convenience re-export so callers do not need to import Event directly. */
export type { Event };
