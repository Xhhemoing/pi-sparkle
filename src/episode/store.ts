import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import type { EpisodeId } from "../domain/ids.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import { validateEpisodeEvent, type EpisodeEvent } from "./events.js";

export interface EpisodeLogRecovery {
  readonly incompleteLine?: string;
  readonly lineNumber?: number;
}

export interface EpisodeLogRead {
  readonly events: readonly EpisodeEvent[];
  readonly recovery: EpisodeLogRecovery;
}

export class EpisodeEventStore {
  private readonly path: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly stateRoot: string, private readonly episodeId: EpisodeId) {
    this.path = join(runtimeRoot(stateRoot), "episodes", `${episodeId}.events.jsonl`);
  }

  append(event: EpisodeEvent): Promise<void> {
    return this.enqueue(async () => {
      await appendJsonlLine(this.path, JSON.stringify(event), false);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async readAll(): Promise<EpisodeLogRead> {
    const { values, recovery } = await readJsonlObjects(
      this.path,
      (lineNumber) => new DomainValidationError(`Invalid JSON at line ${lineNumber} in ${this.path}`)
    );
    return {
      events: values.map((value, index) => {
        try {
          return validateEpisodeEvent(value);
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new DomainValidationError(
            `Invalid episode event at line ${index + 1} in ${this.path}: ${reason}`
          );
        }
      }),
      recovery
    };
  }
}
