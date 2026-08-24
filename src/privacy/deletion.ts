import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeRoot } from "./state-layout.js";
import type { EpisodeId, RunId } from "../domain/ids.js";
import { DomainValidationError } from "../domain/errors.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import { readJsonlObjects } from "../persist/jsonl.js";
import { catalogObservedPath } from "../routing/catalog-observed.js";
import { invocationsLogPath } from "../routing/cost-calibration.js";
import type { FeedbackRecord } from "../feedback/types.js";
import {
  feedbackTombstonesPath,
  readFeedbackRecordsRaw,
  readFeedbackTombstoneIds,
  writeFeedbackRecords
} from "../feedback/store.js";

export function tombstoneIds(ids: readonly string[]): ReadonlySet<string> {
  return new Set(ids);
}

export function materializeWithoutTombstones<T extends { id: string }>(
  items: readonly T[],
  tombstones: ReadonlySet<string>
): T[] {
  return items.filter((item) => !tombstones.has(item.id));
}

/**
 * P0 Q2 remediation (2026-08-22 privacy sign-off), extended 2026-08-24.
 *
 * Deleting a run removes its runtime subtree AND filter-rewrites the shared
 * `runtime/invocations.jsonl` so the run's rows stop backing derived routing
 * numbers. Deleting an episode removes its runtime records (including the
 * operational lock that sits next to them) and cascades into the adaptation
 * plane: every feedback record bound to that episode loses all of its
 * free-text fields and its id is persisted as a tombstone, so dataset exports
 * and materialized views can never resurrect it.
 */

/**
 * Feedback fields that can hold user text. `body` is the direct payload;
 * `summary` carries derived user text written by the auto-adapt loop
 * (`src/learning/signals.ts` truncates answers, peer bodies, and subagent
 * output into it). Both must go when an episode is deleted.
 */
export const FREE_TEXT_FEEDBACK_FIELDS = ["body", "summary"] as const;

export interface DeletionResult {
  readonly target: string;
  /**
   * One line per path this delete changed. A path that was unlinked is listed
   * bare; a shared log that was filter-rewritten in place is listed with the
   * number of rows dropped, so a caller never reads "removed" as "the whole
   * file is gone".
   */
  readonly removedPaths: readonly string[];
  /** Feedback ids tombstoned by the episode cascade (empty for run deletes). */
  readonly cascadedFeedbackTombstones: readonly string[];
  /** Rows dropped from the shared invocation log (always 0 for episode deletes). */
  readonly droppedInvocations: number;
}

export { feedbackTombstonesPath } from "../feedback/store.js";

async function statExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete one run's records: the runtime subtree (events, checkpoint, pause
 * state, track questions) under `runtime/runs/<runId>/`, plus that run's rows
 * in the shared `runtime/invocations.jsonl`. Deleting a run does not touch its
 * episode: episodes can outlive individual runs (multi-run attach), which is
 * why the `run-event` record class does not declare episode propagation.
 *
 * The invocation rewrite runs first and fails closed: if the log has a corrupt
 * middle line we cannot prove which rows belong to this run, so nothing is
 * deleted at all rather than reporting a partial delete as success.
 */
export async function deleteRunRecords(
  stateRoot: string,
  runId: RunId
): Promise<DeletionResult> {
  const invocations = await dropRunFromInvocationLog(stateRoot, runId);

  const runDir = join(runtimeRoot(stateRoot), "runs", runId);
  const removed: string[] = [];
  if (await statExists(runDir)) {
    await rm(runDir, { recursive: true, force: true });
    removed.push(runDir);
  }
  if (invocations.droppedRows > 0) {
    removed.push(`${invocations.path} (${invocations.droppedRows} invocation row(s))`);
    const staleAggregate = await invalidateCatalogObserved(stateRoot);
    if (staleAggregate !== undefined) removed.push(staleAggregate);
  }
  return {
    target: `run:${runId}`,
    removedPaths: removed,
    cascadedFeedbackTombstones: [],
    droppedInvocations: invocations.droppedRows
  };
}

/**
 * Delete one episode's runtime records and cascade into feedback. Idempotent:
 * deleting an already-deleted episode succeeds and re-asserts the tombstones.
 */
export async function deleteEpisodeRecords(
  stateRoot: string,
  episodeId: EpisodeId
): Promise<DeletionResult> {
  const episodesDir = join(runtimeRoot(stateRoot), "episodes");
  const removed: string[] = [];
  // Three episode-scoped files can sit under runtime/episodes/: the
  // project-episode log (`<id>.jsonl`), the episode event log
  // (`<id>.events.jsonl`), and the cooperative lock `episode close` takes
  // (`<id>.lock`). The lock holds no user text, but leaving it behind means a
  // deleted episode still has a footprint on disk — and any holder of it is
  // operating on records that no longer exist.
  for (const file of [
    join(episodesDir, `${episodeId}.jsonl`),
    join(episodesDir, `${episodeId}.events.jsonl`),
    join(episodesDir, `${episodeId}.lock`)
  ]) {
    if (await statExists(file)) {
      await rm(file, { force: true });
      removed.push(file);
    }
  }

  const cascaded = await cascadeFeedbackTombstones(stateRoot, episodeId);
  return {
    target: `episode:${episodeId}`,
    removedPaths: removed,
    cascadedFeedbackTombstones: cascaded,
    droppedInvocations: 0
  };
}

/**
 * Strip every free-text payload from feedback bound to the episode and persist
 * their ids as tombstones. The record shell (id, score, kind, timestamps) is
 * kept for audit; `body` and `summary` — the only user-text fields — are
 * removed from disk, not just hidden behind the tombstone filter.
 */
export async function cascadeFeedbackTombstones(
  stateRoot: string,
  episodeId: EpisodeId
): Promise<string[]> {
  const records = await readFeedbackRecordsRaw(stateRoot).catch(() => []);
  if (records.length === 0) return [];

  const tombstones = await readFeedbackTombstoneIds(stateRoot);
  const cascaded: string[] = [];
  const updated = records.map((record) => {
    if (record.episodeId !== episodeId) return record;
    cascaded.push(record.id);
    tombstones.add(record.id);
    return stripFreeText(record);
  });
  if (cascaded.length === 0) return [];

  await writeFeedbackRecords(stateRoot, updated);
  const tombstonePath = feedbackTombstonesPath(stateRoot);
  await mkdir(dirname(tombstonePath), { recursive: true });
  await writeFile(tombstonePath, `${JSON.stringify([...tombstones].sort(), null, 2)}\n`, "utf8");
  return cascaded.sort();
}

/**
 * `undefined` rather than `delete`: the record is readonly, and
 * `JSON.stringify` omits undefined properties, so the rewritten JSONL line
 * carries neither field.
 */
function stripFreeText(record: FeedbackRecord): FeedbackRecord {
  if (record.body === undefined && record.summary === undefined) return record;
  return { ...record, body: undefined, summary: undefined };
}

interface InvocationRewrite {
  readonly path: string;
  readonly droppedRows: number;
}

/**
 * Filter-rewrite the shared invocation log, dropping every row that names this
 * run. The log is one global append-only file, so a run-scoped delete cannot
 * unlink it; it has to be rewritten without the run's rows.
 *
 * Contract details:
 *  - A corrupt middle line throws (`readJsonlObjects` fails closed). Rewriting
 *    around an unparseable row would silently drop somebody's record and could
 *    equally silently keep one of this run's.
 *  - A crash-truncated final line is dropped by the rewrite. It is already
 *    unreadable to every reader, and it cannot be proven to belong to another
 *    run, so the privacy-safe direction is to let it go.
 *  - Rows that parse but are not valid invocations are kept unless they name
 *    this run: the runId match is deliberately structural, not
 *    `isInvocation`-gated, so a malformed row cannot smuggle the run through.
 *  - The rewrite takes the log's cooperative lock, which serializes concurrent
 *    deletes. It does not stop the live appender (`onInvocation` appends
 *    without the lock), so deleting a run while it is still executing can race.
 */
async function dropRunFromInvocationLog(
  stateRoot: string,
  runId: RunId
): Promise<InvocationRewrite> {
  const path = invocationsLogPath(stateRoot);
  // No log, nothing to rewrite — and no reason to create the runtime directory
  // just to take a lock over a file that does not exist.
  if (!(await statExists(path))) return { path, droppedRows: 0 };
  const droppedRows = await withExclusiveFileLock(`${path}.lock`, async () => {
    const { values } = await readJsonlObjects(
      path,
      (line) =>
        new DomainValidationError(
          `corrupt invocation jsonl at line ${line} of ${path}; refusing to rewrite it for a delete`
        )
    );
    const kept = values.filter((row) => !rowNamesRun(row, runId));
    const dropped = values.length - kept.length;
    if (dropped === 0) return 0;
    const body = kept.map((row) => JSON.stringify(row)).join("\n");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body === "" ? "" : `${body}\n`, "utf8");
    return dropped;
  });
  return { path, droppedRows };
}

function rowNamesRun(row: unknown, runId: RunId): boolean {
  if (typeof row !== "object" || row === null) return false;
  const candidate = (row as { runId?: unknown }).runId;
  return typeof candidate === "string" && candidate === runId;
}

/**
 * `runtime/routing/catalog-observed.json` holds p50 aggregates over every
 * invocation row, including the ones just dropped. A percentile cannot have one
 * run subtracted from it, so the stale snapshot is invalidated (unlinked)
 * rather than recomputed here: the class's declared recovery is "rebuild from
 * invocations.jsonl", and every reader already treats a missing file as "no
 * observations" instead of zeros. Rebuilding is left to the next writer so a
 * delete never manufactures a fresh derived artifact of its own.
 */
async function invalidateCatalogObserved(stateRoot: string): Promise<string | undefined> {
  const path = catalogObservedPath(stateRoot);
  if (!(await statExists(path))) return undefined;
  await rm(path, { force: true });
  return path;
}
