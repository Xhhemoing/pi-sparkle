import type { TaskId } from "../domain/ids.js";
import type { Event } from "./events.js";
import { replayRun } from "./replay.js";

/**
 * The one crash-terminal contract, shared by every plane that can die with an
 * error on its way out: the flowchart run, the supervised run, and a child run.
 * The three planes grew byte-identical copies of it (R3-5, R4-3, R4-4); this
 * module is the extraction, not a change. The contract itself is frozen:
 *
 * - **In flight only.** A log that already reads as paused, waiting, blocked,
 *   cancelled or finished has an honest status of its own. A crash on the way
 *   out must neither duplicate that terminal nor bury a state the operator can
 *   still resume, so only a log still reading as in flight gets a terminal.
 * - **Best effort.** Every failure in here is swallowed. This runs while the
 *   run is already unwinding, and the error on its way out is the one worth
 *   reporting — an append that cannot land must not mask it.
 * - **The caller always rethrows.** Recording a terminal is bookkeeping; it
 *   never converts a crash into a settled run for the caller.
 */

const CRASH_REASON_LIMIT = 500;

/** Reason prefix for a parent run's own crash terminal. */
export const RUN_CRASH_PREFIX = "run crashed";

/** Reason prefix for a child run's own crash terminal. */
export const CHILD_CRASH_PREFIX = "child run crashed";

/** The escaping error, as a bounded non-empty `RUN_FAILED` reason. */
export function crashReason(error: unknown, prefix: string = RUN_CRASH_PREFIX): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const detail = message === "" ? "unknown error" : message;
  const bounded = detail.length <= CRASH_REASON_LIMIT ? detail : `${detail.slice(0, CRASH_REASON_LIMIT)}…`;
  return `${prefix}: ${bounded}`;
}

/**
 * What a run-plane recorder needs from its embedder's loop context. Both the
 * flowchart and the supervised contexts satisfy it structurally, so migrating a
 * plane is deleting its private copy and importing this one — the call site
 * does not move.
 */
export interface CrashTerminalContext {
  readonly eventStore: { readAll(): Promise<{ events: Event[] }> };
  readonly append: (event: Event) => Promise<void>;
  readonly make: (type: Event["type"], payload: unknown, taskId?: TaskId) => Event;
}

/**
 * Records the terminal event for a run that died by an escaping error, so
 * replay sees a failure instead of a log that just stops. In-flight only and
 * best effort, per the module contract; the caller rethrows regardless.
 */
export async function recordCrashTerminal(
  ctx: CrashTerminalContext,
  error: unknown,
  reasonPrefix: string = RUN_CRASH_PREFIX
): Promise<void> {
  try {
    const read = await ctx.eventStore.readAll();
    const status = replayRun(read.events).status;
    if (status !== "PLANNING" && status !== "RUNNING") return;
    await ctx.append(ctx.make("RUN_FAILED", { reason: crashReason(error, reasonPrefix) }));
  } catch {
    // Best effort: an append that cannot land must not mask the original error.
  }
}

/** The child-run events that close a child's own log. */
const TERMINAL_CHILD_EVENT_TYPES: ReadonlySet<Event["type"]> = new Set([
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_CANCEL_REQUESTED"
]);

/**
 * Closes the log of a child whose run threw instead of settling. Same two
 * limits as the run plane, reached differently: a child log carries no pause or
 * waiting states — those go to the parent store — so "already settled" is a
 * direct terminal-type check on the child's own log rather than a replay.
 *
 * The check is not defensive. Within one child run it can never fire (the
 * terminal is the last act of a settling run, so any throw precedes it), but a
 * published `childRunId` lets two child runs share one event log, and this is
 * what keeps that log at exactly one terminal.
 */
export async function recordChildCrashTerminal(
  plane: {
    readEvents: () => Promise<readonly Event[]>;
    appendFailed: (reason: string) => Promise<void>;
  },
  error: unknown,
  reasonPrefix: string = CHILD_CRASH_PREFIX
): Promise<void> {
  try {
    const events = await plane.readEvents();
    if (events.some((event) => TERMINAL_CHILD_EVENT_TYPES.has(event.type))) return;
    await plane.appendFailed(crashReason(error, reasonPrefix));
  } catch {
    // Best effort: see the module contract.
  }
}
