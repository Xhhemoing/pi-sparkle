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

  /**
   * Appends one event, validating it *before* it can reach the log.
   *
   * `readAll` below fails closed on the first row it cannot decode, this log is
   * append-only, and rewriting append-only logs is out of contract — so a
   * single malformed row is not a bad row, it is the permanent end of the
   * episode's event history (`episode events` included). The static type is no
   * defence: it is erased at runtime and this class is an exported embedder
   * surface. So the write side runs the same decoder the read side does, and
   * the row that lands is the decoder's output — unknown keys never reach the
   * log. This mirrors `EventStore.append` (`validateEvent`) and
   * `EpisodeStore.append` (`validateEpisode`), the two appenders that already
   * work this way.
   *
   * Rejection is plain: no line number is attached, because at this point there
   * is no line — nothing has been written and nothing will be.
   */
  append(event: EpisodeEvent): Promise<void> {
    return this.enqueue(async () => {
      const validated = validateEpisodeEvent(event);
      await appendJsonlLine(this.path, JSON.stringify(validated), false);
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
