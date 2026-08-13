import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import type { EpisodeId } from "../domain/ids.js";
import { validateEpisode, type ProjectEpisode } from "../domain/episode.js";

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
      const line = JSON.stringify(validated);
      await this.writeLine(line, TERMINAL_EPISODE_STATUSES.has(validated.status));
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeLine(line: string, fsync: boolean): Promise<void> {
    await mkdir(join(this.episodesPath, ".."), { recursive: true });
    await appendFile(this.episodesPath, `${line}\n`, "utf8");
    if (fsync) {
      const handle = await open(this.episodesPath, "a");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }

  async readAll(): Promise<EpisodeLogRead> {
    const raw = await readFile(this.episodesPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (raw === "") return { episodes: [], recovery: {} };
    const lines = raw.split("\n");
    const episodes: ProjectEpisode[] = [];
    const recovery: EpisodeLogRecovery = {};
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
          break;
        }
        throw new DomainValidationError(`Invalid JSON at line ${index + 1} in ${this.episodesPath}`);
      }
      const validated = validateEpisode(parsed);
      episodes.push(validated);
    }
    return { episodes, recovery };
  }
}
