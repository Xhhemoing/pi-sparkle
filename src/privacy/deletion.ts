import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeRoot } from "./state-layout.js";
import { isRunId, type EpisodeId, type RunId } from "../domain/ids.js";
import { catalogObservedPath } from "../routing/catalog-observed.js";
import {
  invocationsLogPath,
  readInvocationRecords,
  withInvocationLogLock,
  writeInvocationRecords
} from "../telemetry/invocation-log.js";
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
 *
 * What an episode delete deliberately does NOT do is edit an attached run's
 * append-only event log, which can hold its own copy of the objective. Those
 * copies are reported (`residualEpisodeTextRunIds`) so the operator can decide
 * to delete the runs too; see `findResidualEpisodeText`.
 */

/**
 * Feedback fields that can hold user text. `body` is the direct payload;
 * `summary` carries derived user text written by the auto-adapt loop
 * (`src/learning/signals.ts` truncates answers, peer bodies, and subagent
 * output into it). Both must go when an episode is deleted.
 */
export const FREE_TEXT_FEEDBACK_FIELDS = ["body", "summary"] as const;

/**
 * Why an attached run is reported as still holding the deleted episode's text.
 *
 *  - `episode-opened`: the run's event log carries an `EPISODE_OPENED` event
 *    for this episode, i.e. a full `ProjectEpisode` snapshot including the
 *    objective and every acceptance criterion.
 *  - `objective-copy`: the objective (or an acceptance description) appears in
 *    another record of a run that names this episode — a run event log without
 *    the open event, or the run's `track-questions.json`.
 *  - `unreadable-log`: the run names the episode but its event log has a line
 *    that does not parse, so residual text cannot be ruled out. Reported
 *    rather than assumed clean.
 */
export type ResidualTextReason = "episode-opened" | "objective-copy" | "unreadable-log";

export interface ResidualEpisodeText {
  readonly runId: RunId;
  readonly path: string;
  readonly reason: ResidualTextReason;
}

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
  /**
   * Runs whose records still hold this episode's text after the delete, sorted
   * and de-duplicated. Always empty for run deletes (a run delete removes the
   * run's own subtree). Nothing here was modified — see
   * `findResidualEpisodeText` for why the run logs are left intact.
   */
  readonly residualEpisodeTextRunIds: readonly RunId[];
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
    droppedInvocations: invocations.droppedRows,
    residualEpisodeTextRunIds: []
  };
}

/**
 * Delete one episode's runtime records and cascade into feedback. Idempotent:
 * deleting an already-deleted episode succeeds and re-asserts the tombstones.
 *
 * The episode's own text is read before the unlink so the residual scan can
 * recognise copies of it in attached runs; those runs are reported, never
 * rewritten (see `findResidualEpisodeText`).
 */
export async function deleteEpisodeRecords(
  stateRoot: string,
  episodeId: EpisodeId
): Promise<DeletionResult> {
  const episodesDir = join(runtimeRoot(stateRoot), "episodes");
  const episodeText = await readEpisodeText(episodesDir, episodeId);
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
  const residual = await findResidualEpisodeText(stateRoot, episodeId, episodeText);
  return {
    target: `episode:${episodeId}`,
    removedPaths: removed,
    cascadedFeedbackTombstones: cascaded,
    droppedInvocations: 0,
    residualEpisodeTextRunIds: [...new Set(residual.map((entry) => entry.runId))].sort()
  };
}

/**
 * Preference cascade on episode delete is a deliberate non-goal.
 *
 * A `PreferenceObservation` names the episode it was learned from
 * (`evidenceEpisodeId`), so tombstoning "every preference whose evidence was
 * this episode" looks like a one-liner. It is not, for three reasons, and none
 * of them is cheap to fix from here:
 *
 *  1. The preference store is a process-global singleton bound to one file by
 *     `configurePreferencePersistence`. A delete for state root A would have
 *     to rebind (and reload) whatever store the calling process already had
 *     open, so a privacy operation would corrupt unrelated live state. Doing
 *     it correctly needs a state-root-scoped preference API, not a call from
 *     here.
 *  2. `deleteObservation` physically drops the observation and rebuilds the
 *     materialized views, so the cascade would silently change *behaviour*
 *     (what the agent believes the user prefers), not just delete text. That
 *     is a product decision — the feedback cascade deliberately went the other
 *     way, keeping the audit shell and stripping only the free text.
 *  3. `deletionPropagatesTo` is a behavioural claim pinned by
 *     `record-classes.test.ts`. Implementing half a cascade without widening
 *     the dictionary (or widening it without the code) fails that test on
 *     purpose.
 *
 * What survives an episode delete today is therefore a preference row whose
 * `evidenceEpisodeId` dangles — the same shape as `artifact-ref`'s documented
 * "missing ids stay inspectable as dangling references". The dangling id is
 * not episode text; the objective and acceptance text never reach a
 * preference row. `deletion.test.ts` pins this: an episode delete must leave
 * `adaptation/preferences.json` byte-identical.
 */

/**
 * List the runs whose records still hold this episode's text.
 *
 * Run event logs are append-only history. Rewriting one to erase an episode
 * would break the very property the runtime depends on — an event log that
 * can be edited after the fact is no longer evidence, and every hash, replay,
 * and checkpoint over it becomes unverifiable. So `delete --episode`
 * deliberately leaves them alone and *discloses* the copies instead: an
 * operator who needs those bytes gone deletes the run (`delete --run`), which
 * removes the whole subtree.
 *
 * Scope: only runs that name the episode are considered. A run that happens to
 * contain the same sentence but never references the episode cannot be proven
 * related, and claiming it would send operators deleting unrelated runs.
 *
 * `seedText` is the episode's own objective/acceptance text, read before the
 * unlink. It is optional: on a repeat delete the episode records are already
 * gone, and the scan falls back to the text carried by the runs' own
 * `EPISODE_OPENED` events.
 *
 * Cost: this reads every run's event log once. That is acceptable for an
 * interactive delete and is why nothing else calls it per-run.
 */
export async function findResidualEpisodeText(
  stateRoot: string,
  episodeId: EpisodeId,
  seedText: readonly string[] = []
): Promise<ResidualEpisodeText[]> {
  const logs = (await readRunEventLogs(stateRoot)).filter((log) => log.raw.includes(episodeId));
  if (logs.length === 0) return [];

  const findings: ResidualEpisodeText[] = [];
  const text = new Set(seedText.map((entry) => entry.trim()).filter((entry) => entry !== ""));
  for (const log of logs) {
    const scan = scanRunLog(log.raw, episodeId);
    for (const entry of scan.episodeText) text.add(entry);
    if (scan.opensEpisode) {
      findings.push({ runId: log.runId, path: log.path, reason: "episode-opened" });
    } else if (scan.unreadable) {
      findings.push({ runId: log.runId, path: log.path, reason: "unreadable-log" });
    }
  }

  // Second pass: the text set is only complete once every open event has been
  // read, so copies that live outside one can only be matched now.
  for (const log of logs) {
    if (!findings.some((found) => found.path === log.path) && containsAny(log.raw, text)) {
      findings.push({ runId: log.runId, path: log.path, reason: "objective-copy" });
    }
    // The track loop writes the objective into its own run-scoped file, which
    // an episode delete does not reach either.
    const questions = join(dirname(log.path), "track-questions.json");
    if (containsAny(await readTextFile(questions), text)) {
      findings.push({ runId: log.runId, path: questions, reason: "objective-copy" });
    }
  }
  return findings.sort((a, b) => a.runId.localeCompare(b.runId) || a.path.localeCompare(b.path));
}

interface RunLog {
  readonly runId: RunId;
  readonly path: string;
  readonly raw: string;
}

async function readRunEventLogs(stateRoot: string): Promise<RunLog[]> {
  const runsDir = join(runtimeRoot(stateRoot), "runs");
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    }
  );
  const logs: RunLog[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRunId(entry.name)) continue;
    const path = join(runsDir, entry.name, "events.jsonl");
    const raw = await readTextFile(path);
    if (raw === "") continue;
    logs.push({ runId: entry.name, path, raw });
  }
  return logs;
}

interface RunLogScan {
  /** The log carries an `EPISODE_OPENED` event for this episode. */
  readonly opensEpisode: boolean;
  /** At least one line did not parse, so the log cannot be cleared. */
  readonly unreadable: boolean;
  /** Objective + acceptance text found in this episode's open events. */
  readonly episodeText: readonly string[];
}

/**
 * A corrupt line is recorded, not thrown: this is a report about copies that
 * are being left in place, so one unreadable line in an unrelated run must not
 * fail an otherwise complete delete.
 */
function scanRunLog(raw: string, episodeId: EpisodeId): RunLogScan {
  let opensEpisode = false;
  let unreadable = false;
  const episodeText: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      if (line.includes(episodeId)) unreadable = true;
      continue;
    }
    const episode = openedEpisodeOf(parsed);
    if (episode === undefined || episode.id !== episodeId) continue;
    opensEpisode = true;
    episodeText.push(...episodeTextOf(episode));
  }
  return { opensEpisode, unreadable, episodeText };
}

interface EpisodeTextShape {
  readonly id?: unknown;
  readonly objective?: unknown;
  readonly acceptance?: unknown;
}

/** The `ProjectEpisode` snapshot embedded in an `EPISODE_OPENED` run event. */
function openedEpisodeOf(value: unknown): (EpisodeTextShape & { id: string }) | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const event = value as { type?: unknown; payload?: unknown };
  if (event.type !== "EPISODE_OPENED") return undefined;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const episode = (payload as { episode?: unknown }).episode;
  if (typeof episode !== "object" || episode === null) return undefined;
  const shape = episode as EpisodeTextShape;
  return typeof shape.id === "string" ? { ...shape, id: shape.id } : undefined;
}

function episodeTextOf(episode: EpisodeTextShape): string[] {
  const out: string[] = [];
  if (typeof episode.objective === "string" && episode.objective.trim() !== "") {
    out.push(episode.objective.trim());
  }
  if (Array.isArray(episode.acceptance)) {
    for (const criterion of episode.acceptance) {
      if (typeof criterion !== "object" || criterion === null) continue;
      const description = (criterion as { description?: unknown }).description;
      if (typeof description === "string" && description.trim() !== "") out.push(description.trim());
    }
  }
  return out;
}

/**
 * The episode's own objective/acceptance text, read from the runtime episode
 * records before they are unlinked. Both durable shapes are tolerated: the
 * project-episode log stores `ProjectEpisode` rows directly, the event log
 * wraps them in `{ type, episode }`.
 */
async function readEpisodeText(episodesDir: string, episodeId: EpisodeId): Promise<string[]> {
  const out: string[] = [];
  for (const file of [`${episodeId}.jsonl`, `${episodeId}.events.jsonl`]) {
    const raw = await readTextFile(join(episodesDir, file));
    for (const line of raw.split("\n")) {
      if (line === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const wrapped = (parsed as { episode?: unknown }).episode;
      const shape = (typeof wrapped === "object" && wrapped !== null ? wrapped : parsed) as
        EpisodeTextShape;
      if (shape.id !== undefined && shape.id !== episodeId) continue;
      out.push(...episodeTextOf(shape));
    }
  }
  return out;
}

function containsAny(raw: string, needles: ReadonlySet<string>): boolean {
  for (const needle of needles) {
    if (raw.includes(needle)) return true;
  }
  return false;
}

async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR") return "";
    throw error;
  });
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
 *  - A corrupt middle line throws (`readInvocationRecords` fails closed).
 *    Rewriting around an unparseable row would silently drop somebody's record
 *    and could equally silently keep one of this run's.
 *  - A crash-truncated final line is dropped by the rewrite. It is already
 *    unreadable to every reader, and it cannot be proven to belong to another
 *    run, so the privacy-safe direction is to let it go.
 *  - Rows that parse but are not valid invocations are kept unless they name
 *    this run: the runId match is deliberately structural, not
 *    `isInvocation`-gated, so a malformed row cannot smuggle the run through.
 *  - Read, filter, and write all happen inside the log's cooperative lock
 *    (`withInvocationLogLock`), the same lock `appendInvocationRecord` takes.
 *    A live invocation append therefore lands either wholly before the read or
 *    wholly after the write, instead of into the window between them where the
 *    rewrite would clobber it.
 */
async function dropRunFromInvocationLog(
  stateRoot: string,
  runId: RunId
): Promise<InvocationRewrite> {
  const path = invocationsLogPath(stateRoot);
  // No log, nothing to rewrite — and no reason to create the runtime directory
  // just to take a lock over a file that does not exist.
  if (!(await statExists(path))) return { path, droppedRows: 0 };
  const droppedRows = await withInvocationLogLock(stateRoot, async () => {
    const { values } = await readInvocationRecords(
      stateRoot,
      "refusing to rewrite it for a delete"
    );
    const kept = values.filter((row) => !rowNamesRun(row, runId));
    const dropped = values.length - kept.length;
    if (dropped === 0) return 0;
    await writeInvocationRecords(stateRoot, kept);
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
