import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { EpisodeStatus } from "../domain/episode.js";
import { isEpisodeId, isRunId, type EpisodeId, type RunId } from "../domain/ids.js";
import type { RunStatus } from "../domain/status.js";
import { runtimeRoot } from "../privacy/state-layout.js";
import { episodeIdFromEvents } from "./episode-bind.js";
import { EpisodeStore } from "./episode-store.js";
import { EventStore } from "./event-store.js";
import { replayRun } from "./replay.js";

/**
 * One record the inventory could not read, named by the file it failed on.
 *
 * A record that fails to decode is reported, never skipped silently and never
 * fatal: an operator listing a state root is usually looking *for* the broken
 * run, and one corrupt log must not hide the eleven readable ones next to it.
 */
export interface InventoryError {
  readonly path: string;
  readonly message: string;
}

export interface RunInventoryRow {
  readonly runId: RunId;
  readonly status: RunStatus;
  /** `occurredAt` of the log's last event. Runs with no events are not listed. */
  readonly lastEventAt: string;
  /** The episode the log is attached to, or `undefined` when it is unattached. */
  readonly episodeId: EpisodeId | undefined;
}

export interface EpisodeInventoryRow {
  readonly episodeId: EpisodeId;
  readonly status: EpisodeStatus;
  /**
   * The newest timestamp the last snapshot carries — `closedAt` once the
   * episode settles, `startedAt` before that. Typed as optional because the
   * listing contract allows a row with no timestamp; every snapshot that
   * validates supplies one today.
   */
  readonly lastEventAt: string | undefined;
}

export interface RunInventory {
  readonly runs: RunInventoryRow[];
  readonly errors: InventoryError[];
  /**
   * Records that read but were shorter than what was written: the JSONL
   * readers recover a crash-truncated final line by dropping it, so the row
   * below is replayed from a log missing its tail. Reported separately from
   * `errors` because the record is listed, not lost.
   */
  readonly warnings: InventoryError[];
}

export interface EpisodeInventory {
  readonly episodes: EpisodeInventoryRow[];
  readonly errors: InventoryError[];
  /** Truncation disclosures, as on `RunInventory`. */
  readonly warnings: InventoryError[];
}

/**
 * The disclosure a crash-truncated log owes its reader, or `undefined` when
 * the log was whole. The line number is optional in the recovery shape, so a
 * recovery that cannot name one still discloses the dropped tail.
 */
function truncationMessage(
  recovery: { incompleteLine?: string; lineNumber?: number },
  label: string
): string | undefined {
  if (recovery.incompleteLine === undefined) return undefined;
  const at = recovery.lineNumber === undefined ? "" : ` at line ${recovery.lineNumber}`;
  return `ignored truncated ${label}${at}; status and lastEventAt are replayed from the shortened log`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingDirectory(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Every run under `<stateRoot>/runtime/runs/`, replayed for its status.
 *
 * A state root with no runs directory is an empty inventory, not a failure:
 * that is exactly what a fresh install looks like. Any other `readdir` failure
 * throws — the caller cannot tell a permission-denied scan from "no runs", and
 * reporting the second when the first happened would be a lie.
 */
export async function listRuns(stateRoot: string): Promise<RunInventory> {
  const runsDir = join(runtimeRoot(stateRoot), "runs");
  const errors: InventoryError[] = [];
  const warnings: InventoryError[] = [];
  let children;
  try {
    children = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return { runs: [], errors, warnings };
    throw error;
  }

  const runs: RunInventoryRow[] = [];
  for (const child of children) {
    if (!child.isDirectory() || !isRunId(child.name)) continue;
    const runId = child.name;
    const path = join(runsDir, runId, "events.jsonl");
    try {
      const read = await new EventStore(stateRoot, runId).readAll();
      const truncated = truncationMessage(read.recovery, "event log");
      if (truncated !== undefined) warnings.push({ path, message: truncated });
      const last = read.events.at(-1);
      if (last === undefined) continue;
      runs.push({
        runId,
        status: replayRun(read.events).status,
        lastEventAt: last.occurredAt,
        episodeId: episodeIdFromEvents(read.events)
      });
    } catch (error) {
      errors.push({ path, message: messageOf(error) });
    }
  }

  runs.sort((left, right) => left.runId.localeCompare(right.runId));
  errors.sort((left, right) => left.path.localeCompare(right.path));
  warnings.sort((left, right) => left.path.localeCompare(right.path));
  return { runs, errors, warnings };
}

/**
 * The episode id a snapshot log file names, or `undefined` when the file is
 * not one.
 *
 * The episodes directory holds three kinds of file per episode — the snapshot
 * log, the `.events.jsonl` event log beside it, and the `.lock` — and only the
 * first is an episode *record*. The event log is filtered by name rather than
 * by a failed id check because `<id>.events` is not an `EpisodeId` only by
 * accident of the dot; naming it here keeps the two logs from swapping places
 * if the id grammar ever widens.
 */
function episodeIdFromFileName(name: string): EpisodeId | undefined {
  if (!name.endsWith(".jsonl")) return undefined;
  const base = name.slice(0, -".jsonl".length);
  if (base.endsWith(".events")) return undefined;
  return isEpisodeId(base) ? base : undefined;
}

/** Every episode under `<stateRoot>/runtime/episodes/`, at its latest snapshot. */
export async function listEpisodes(stateRoot: string): Promise<EpisodeInventory> {
  const episodesDir = join(runtimeRoot(stateRoot), "episodes");
  const errors: InventoryError[] = [];
  const warnings: InventoryError[] = [];
  let children;
  try {
    children = await readdir(episodesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return { episodes: [], errors, warnings };
    throw error;
  }

  const episodes: EpisodeInventoryRow[] = [];
  for (const child of children) {
    if (!child.isFile()) continue;
    const episodeId = episodeIdFromFileName(child.name);
    if (episodeId === undefined) continue;
    const path = join(episodesDir, child.name);
    try {
      const read = await new EpisodeStore(stateRoot, episodeId).readAll();
      const truncated = truncationMessage(read.recovery, "episode log");
      if (truncated !== undefined) warnings.push({ path, message: truncated });
      const latest = read.episodes.at(-1);
      if (latest === undefined) continue;
      episodes.push({
        episodeId,
        status: latest.status,
        lastEventAt: latest.closedAt ?? latest.startedAt
      });
    } catch (error) {
      errors.push({ path, message: messageOf(error) });
    }
  }

  episodes.sort((left, right) => left.episodeId.localeCompare(right.episodeId));
  errors.sort((left, right) => left.path.localeCompare(right.path));
  warnings.sort((left, right) => left.path.localeCompare(right.path));
  return { episodes, errors, warnings };
}
