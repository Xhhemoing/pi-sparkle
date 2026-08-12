import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId } from "../domain/ids.js";
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
    this.eventsPath = join(stateRoot, "runs", runId, "events.jsonl");
  }

  append(event: Event): Promise<void> {
    return this.enqueue(async () => {
      const validated = validateEvent(event);
      if (validated.runId !== this.runId) {
        throw new DomainValidationError(
          `Invalid Event: runId ${validated.runId} does not match store run ${this.runId}`
        );
      }
      const line = JSON.stringify(validated);
      await this.writeLine(line, TERMINAL_EVENT_TYPES.has(validated.type));
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeLine(line: string, fsync: boolean): Promise<void> {
    await mkdir(join(this.eventsPath, ".."), { recursive: true });
    await appendFile(this.eventsPath, `${line}\n`, "utf8");
    if (fsync) {
      const handle = await open(this.eventsPath, "a");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }

  async readAll(): Promise<EventLogRead> {
    const raw = await readFile(this.eventsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (raw === "") return { events: [], recovery: {} };
    const lines = raw.split("\n");
    const events: Event[] = [];
    const recovery: EventLogRecovery = {};
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line === undefined || line === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        if (index === lines.length - 1) {
          recovery.incompleteLine = line;
          recovery.lineNumber = index + 1;
          continue;
        }
        throw new Error(`Corrupt event log line ${index + 1}`);
      }
      events.push(validateEvent(parsed));
    }
    return { events, recovery };
  }
}
