import type { EpisodeEvent } from "./events.js";
import { reduceEpisodeEvents, type EpisodeState } from "./manager.js";

export interface EpisodeReplayOptions {
  readonly stopAtIncompleteLine?: boolean;
}

export interface EpisodeReplayResult {
  readonly state: EpisodeState;
  readonly recovered: boolean;
  readonly incompleteLine?: string | undefined;
}

export function replayEpisodeEvents(
  events: readonly EpisodeEvent[],
  _options: EpisodeReplayOptions = {}
): EpisodeReplayResult {
  const state = reduceEpisodeEvents(events);
  return {
    state,
    recovered: false,
  };
}

export function replayFromLog(
  rawLines: readonly string[]
): EpisodeReplayResult {
  const events: EpisodeEvent[] = [];
  let incompleteLine: string | undefined;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as EpisodeEvent);
    } catch {
      if (i === rawLines.length - 1) {
        incompleteLine = line;
        break;
      }
      throw new Error(`Invalid episode event JSON at line ${i + 1}`);
    }
  }
  const state = reduceEpisodeEvents(events);
  return {
    state,
    recovered: Boolean(incompleteLine),
    incompleteLine,
  };
}
