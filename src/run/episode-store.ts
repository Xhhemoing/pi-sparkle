import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { EpisodeId } from "../domain/ids.js";
import { validateEpisode, type ProjectEpisode } from "../domain/episode.js";
import { appendJsonlLine, readJsonlObjects } from "../persist/jsonl.js";

const TERMINAL_EPISODE_STATUSES = new Set(["COMPLETED", "FAILED", "ABANDONED"]);

export interface EpisodeLogRecovery {
  incompleteLine?: string;
  lineNumber?: number;
}

export interface EpisodeLogRead {
  episodes: ProjectEpisode[];
  recovery: EpisodeLogRecovery;
}

export class EpisodeStore {
  private readonly episodesPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly stateRoot: string, private readonly episodeId: EpisodeId) {
    this.episodesPath = join(stateRoot, "episodes", `${episodeId}.jsonl`);
  }

  append(episode: ProjectEpisode): Promise<void> {
    return this.enqueue(async () => {
      const validated = validateEpisode(episode);
      if (validated.id !== this.episodeId) {
        throw new DomainValidationError(
          `Invalid Episode: id ${validated.id} does not match store episode ${this.episodeId}`
        );
      }
      await appendJsonlLine(
        this.episodesPath,
        JSON.stringify(validated),
        TERMINAL_EPISODE_STATUSES.has(validated.status)
      );
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async readAll(): Promise<EpisodeLogRead> {
    const { values, recovery } = await readJsonlObjects(
      this.episodesPath,
      (lineNumber) =>
        new DomainValidationError(`Invalid JSON at line ${lineNumber} in ${this.episodesPath}`)
    );
    return {
      episodes: values.map((value) => validateEpisode(value)),
      recovery
    };
  }
}
