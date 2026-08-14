import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EpisodeId } from "../domain/ids.js";
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
    this.path = join(stateRoot, "episodes", `${episodeId}.events.jsonl`);
  }

  append(event: EpisodeEvent): Promise<void> {
    return this.enqueue(async () => {
      const line = JSON.stringify(event);
      await this.writeLine(line);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeLine(line: string): Promise<void> {
    await mkdir(join(this.path, ".."), { recursive: true });
    await appendFile(this.path, `${line}\n`, "utf8");
  }

  async readAll(): Promise<EpisodeLogRead> {
    const raw = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (raw === "") return { events: [], recovery: {} };
    const lines = raw.split("\n");
    const events: EpisodeEvent[] = [];
    let incompleteLine: string | undefined;
    let lineNumber: number | undefined;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as EpisodeEvent;
        events.push(parsed);
      } catch {
        if (index === lines.length - 1) {
          incompleteLine = line;
          lineNumber = index + 1;
          break;
        }
        throw new Error(`Invalid JSON at line ${index + 1} in ${this.path}`);
      }
    }
    const recovery: EpisodeLogRecovery = incompleteLine !== undefined
      ? { incompleteLine, lineNumber: lineNumber! }
      : {};
    return { events, recovery };
  }
}
