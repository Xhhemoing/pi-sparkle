import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { validateEvent, type Event } from "./events.js";

const TERMINAL_EVENT_TYPES = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCEL_REQUESTED"]);

/**
 * The cooperative lock guarding one run's records under `runtime/runs/<runId>/`.
 *
 * It sits *beside* the run directory, never inside it: `delete --run` removes
 * the subtree while holding this lock, and a lock file inside the subtree
 * would be removed out from under its own holder. Every holder uses this exact
 * path — `requestPause`, the track loop's questions write, and
 * `deleteRunRecords` — because rebuilding the template anywhere else would put
 * the two sides on different files, the failure `episodeLockPath` exists to
 * prevent on the episode plane.
 *
 * The run plane's two per-step writers (`EventStore.append` below and
 * `CheckpointStore.write`) deliberately do *not* take it; each says why, with
 * the measurement, where it is not taken.
 *
 * Posture is identical to the episode lock: bounded wait, fail closed on
 * timeout, and locks are never stolen (see `withExclusiveFileLock`). A lock
 * left behind by a killed holder therefore blocks the writers that take it
 * until an operator removes it; `doctor` inventories run locks with their age
 * and recorded PID.
 */
export function runLockPath(stateRoot: string, runId: RunId): string {
  return join(runtimeRoot(stateRoot), "runs", `${runId}.lock`);
}

export interface EventLogRecovery {
  incompleteLine?: string;
  lineNumber?: number;
}

export interface EventLogRead {
  events: Event[];
  recovery: EventLogRecovery;
}

/**
 * ## Ordering here, exclusion elsewhere: why `append` takes no run lock
 *
 * Two different mechanisms could serialize an append, and this store uses only
 * the cheap one.
 *
 * `queue` is in-process FIFO ordering for this instance: it makes concurrent
 * `append` calls land in call order and never interleave, at the cost of one
 * promise link. It says nothing about other `EventStore` instances, other
 * processes, or `delete --run`.
 *
 * `runLockPath` is the cross-writer exclusion `requestPause`, the track-questions
 * write and `deleteRunRecords` take. Taking it here too — inside the queue, so
 * a store never has more than one acquisition outstanding — was implemented
 * and measured on this VM, and it is not affordable on this path: a locked
 * append costs ~0.21 ms against ~0.04 ms unlocked (+372%), which is +22.5% on
 * an end-to-end fake-executor flowchart run against a 5% bar (both arms in one
 * process, alternating order, medians of 9 reps; the same harness reports +1%
 * when neither arm is locked). So the acquisition was rolled back here, and on
 * the other per-step writer (`CheckpointStore.write`), and kept on the writers
 * that are not in the loop.
 *
 * What that leaves open, precisely. `appendJsonlLine` recreates a missing
 * directory (ENOENT → `mkdir` → retry), so an append landing inside a
 * concurrent `delete --run` can still put the run subtree back, and this store
 * will not wait for the delete. What it cannot do is make the delete *lie*:
 * the removal is verified under the lock and re-verified after it, so a
 * resurrected directory fails the delete with `RunRecordsSurvivedError`
 * instead of being reported as removed. Measured against an adversarial
 * tight-loop appender, 30 deletes: 0 returned success with records on disk and
 * 30 refused, where the same probe against the previous code returned success
 * over resurrected records 5 times. With the acquisition here as well, those
 * 30 completed cleanly instead — that is the whole difference it buys, and it
 * is convenience, not privacy.
 *
 * The cheap way to buy that convenience is one acquisition per *run* rather
 * than per append, taken by the run lifecycle (`coordinator.ts` /
 * `flowchart-run.ts`) and released at teardown. Those are other modules'
 * files, and it trades the hot-path cost for "a delete waits for a live run,
 * and a killed run leaves a lock an operator must clear" — a posture decision,
 * not a refactor.
 */
export class EventStore {
  private readonly eventsPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly stateRoot: string,
    private readonly runId: RunId
  ) {
    this.eventsPath = join(runtimeRoot(stateRoot), "runs", runId, "events.jsonl");
  }

  append(event: Event): Promise<void> {
    return this.enqueue(async () => {
      const validated = validateEvent(event);
      if (validated.runId !== this.runId) {
        throw new DomainValidationError(
          `Invalid Event: runId ${validated.runId} does not match store run ${this.runId}`
        );
      }
      await appendJsonlLine(
        this.eventsPath,
        JSON.stringify(validated),
        TERMINAL_EVENT_TYPES.has(validated.type)
      );
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async readAll(): Promise<EventLogRead> {
    const { values, recovery } = await readJsonlObjects(
      this.eventsPath,
      (lineNumber) => new DomainValidationError(`Corrupt event log line ${lineNumber}`)
    );
    return {
      events: values.map((value) => validateEvent(value)),
      recovery
    };
  }
}
