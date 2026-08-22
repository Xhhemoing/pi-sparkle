import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { validateEvent, type Event } from "./events.js";

const TERMINAL_EVENT_TYPES = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCEL_REQUESTED"]);

export interface EventLogRecovery {
  incompleteLine?: string;
  lineNumber?: number;
}

export interface EventLogRead {
  events: Event[];
  recovery: EventLogRecovery;
}

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
      (lineNumber) => new Error(`Corrupt event log line ${lineNumber}`)
    );
    return {
      events: values.map((value) => validateEvent(value)),
      recovery
    };
  }
}
