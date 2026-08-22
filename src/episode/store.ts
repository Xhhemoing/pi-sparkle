import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import type { EpisodeId } from "../domain/ids.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";
import type { EpisodeEvent } from "./events.js";

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
      (lineNumber) => new Error(`Invalid JSON at line ${lineNumber} in ${this.path}`)
    );
    return {
      events: values as EpisodeEvent[],
      recovery
    };
  }
}
