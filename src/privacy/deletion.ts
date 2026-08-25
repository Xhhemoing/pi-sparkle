import { readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeRoot } from "./state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import { isRunId, type EpisodeId, type RunId } from "../domain/ids.js";
import { catalogObservedPath } from "../routing/catalog-observed.js";
import { episodeLockPath } from "../run/episode-bind.js";
import { runLockPath } from "../run/event-store.js";
import {
  invocationsLogPath,
  readInvocationRecords,
  withInvocationLogLock,
  writeInvocationRecords
} from "../telemetry/invocation-log.js";
import type { FeedbackRecord } from "../feedback/types.js";
import {
  feedbackLogPath,
  readFeedbackRecordsRaw,
  readFeedbackTombstoneIds,
  withFeedbackLogLock,
  writeFeedbackRecords,
  writeFeedbackTombstones
} from "../feedback/store.js";
import { withExclusiveFileLock, type FileLockOptions } from "../persist/file-lock.js";

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
 * numbers. The subtree removal holds the run's cooperative lock
 * (`runLockPath`) and is verified under it and again after it, because a
 * deleted run directory comes straight back on the next write from a writer
 * that does not take that lock; a delete that cannot prove the records are
 * gone fails loudly instead of returning success.
 *
 * Deleting an episode removes its runtime records — under the episode's own
 * cooperative lock, so no live writer is operating on them while they go —
 * and cascades into the adaptation plane: every feedback record bound to that
 * episode loses all of its free-text fields and its id is persisted as a
 * tombstone, so dataset exports and materialized views can never resurrect
 * it.
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

export interface RunDeletionOptions extends FileLockOptions {
  /**
   * Disclosure seam for the half of a `delete --run` that completes before any
   * lock is taken.
   *
   * The invocation-log rewrite runs first and is not rolled back, so a delete
   * that then fails — a lock it could not have, or records it could not prove
   * gone — has already changed the telemetry plane while throwing away the
   * `DeletionResult` that would have said so. When that happens and rows were
   * actually dropped, this is called exactly once with a single line (no
   * trailing newline) naming what stayed dropped. It is never called when the
   * rewrite dropped nothing, and never on the success path, where the same
   * facts are already in `removedPaths`.
   */
  readonly disclosePartial?: (line: string) => void;
}

async function statExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export const RUN_RECORDS_SURVIVED_CODE = "RUN_RECORDS_SURVIVED" as const;

/**
 * A `delete --run` that cannot prove the run's records are gone.
 *
 * Thrown when `runtime/runs/<runId>/` is still on disk after the delete tried
 * to remove it — either because a live writer put it back or because the
 * removal itself failed (the failure is attached as `cause`). Discriminate on
 * `code`, never on the message.
 */
export class RunRecordsSurvivedError extends DomainValidationError {
  readonly code = RUN_RECORDS_SURVIVED_CODE;
  readonly runDir: string;
  /** What was found under `runDir`, sorted; empty for a bare directory. */
  readonly survivingEntries: readonly string[];

  constructor(
    message: string,
    runDir: string,
    survivingEntries: readonly string[],
    cause?: unknown
  ) {
    super(message);
    this.name = "RunRecordsSurvivedError";
    this.runDir = runDir;
    this.survivingEntries = survivingEntries;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Fail-closed post-condition for a run delete: throw unless
 * `runtime/runs/<runId>/` is absent.
 *
 * `deleteRunRecords` calls this inside the run's cooperative lock, where no
 * lock-taking writer can recreate the directory between the removal and the
 * check. Called on its own — as an operator re-assertion or an audit surface —
 * it takes no lock and is therefore a point-in-time check, not a guarantee
 * about the future.
 */
export async function verifyRunRecordsRemoved(stateRoot: string, runId: RunId): Promise<void> {
  const runDir = join(runtimeRoot(stateRoot), "runs", runId);
  const survivors = await survivingRunEntries(runDir);
  if (survivors === undefined) return;
  throw runRecordsSurvived(runId, runDir, runLockPath(stateRoot, runId), survivors, undefined);
}

/** Entries left under the run directory, or `undefined` when it is gone. */
async function survivingRunEntries(runDir: string): Promise<readonly string[] | undefined> {
  const entries = await readdir(runDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    // The path is there but is not a directory: still a survivor, just one
    // with nothing to list.
    if (error.code === "ENOTDIR") return [];
    throw error;
  });
  return entries === undefined ? undefined : [...entries].sort();
}

function runRecordsSurvived(
  runId: RunId,
  runDir: string,
  lockPath: string,
  survivors: readonly string[],
  cause: unknown
): RunRecordsSurvivedError {
  const listed = survivors.length === 0 ? "an empty directory" : survivors.join(", ");
  const what =
    cause === undefined
      ? `${runDir} was removed and is on disk again (${listed})`
      : `${runDir} could not be removed (${cause instanceof Error ? cause.message : String(cause)}) and is still on disk (${listed})`;
  return new RunRecordsSurvivedError(
    `run:${runId}: ${what}; refusing to report the delete as successful. A run delete removes the subtree while holding the run's cooperative lock (${lockPath}), and the CLI-reachable run lifecycles hold that same lock for as long as they run — so a delete aimed at a live run waits for it, and only times out. These records were therefore written by a writer that does not take the lock: the run's event appender or its checkpoint writer, driven either by an embedder that does not take the lifecycle lock or by a write that landed after the delete's final verification. Stop or cancel the run before deleting it again.`,
    runDir,
    survivors,
    cause
  );
}

/**
 * Remove the run subtree and prove it is gone. Runs inside the run's
 * cooperative lock (see `deleteRunRecords`).
 *
 * The verification stays even though the lock is held, because the lock is
 * cooperative: `rm` can still lose the race to a writer that does not take it,
 * two ways. A writer that recreates the directory mid-walk makes `rm` itself
 * fail (`ENOTEMPTY`), and one that recreates it just after the walk leaves a
 * fresh directory behind. Both end in the same operator-visible state — run
 * records on disk after a delete — so both raise the same typed error, with
 * the removal failure attached as `cause` when there was one. A removal error
 * that left nothing behind is rethrown unchanged: it is an I/O failure, not a
 * resurrection, and mislabelling it would send the operator hunting a live
 * writer that does not exist.
 */
async function removeRunSubtree(stateRoot: string, runId: RunId, runDir: string): Promise<void> {
  try {
    await rm(runDir, { recursive: true, force: true });
  } catch (error) {
    const survivors = await survivingRunEntries(runDir);
    if (survivors !== undefined) {
      throw runRecordsSurvived(runId, runDir, runLockPath(stateRoot, runId), survivors, error);
    }
    throw error;
  }
  await verifyRunRecordsRemoved(stateRoot, runId);
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
 *
 * ## The subtree removal happens under the run's lock, and is verified twice
 *
 * `runtime/runs/<runId>.lock` (`runLockPath`) is the run plane's cooperative
 * lock, and this delete holds it across the removal *and* the verification, so
 * a writer that takes it lands wholly before the removal or wholly after the
 * verification instead of into the window between them. Writing under
 * `runtime/runs/<runId>/` recreates the directory — the writers `mkdir` it and
 * `appendJsonlLine` retries ENOENT through `mkdir` — which is how a delete
 * used to report success over records that were already back.
 *
 * `options` bounds that acquisition — and the invocation log's, so one
 * `--lock-wait-ms` means the same thing at both locks this delete takes — and
 * it fails closed: a live writer that holds the run lock for longer than the
 * timeout means the delete throws without removing any of the run's records,
 * rather than deleting around it. What it does *not* mean is that the delete
 * changed nothing: the invocation rewrite above already ran, and stays run.
 * `options.disclosePartial` is how that reaches the operator on the failure
 * path, where the `DeletionResult` that would have reported it is thrown away.
 * Locks are never stolen here either, so a lock left by a killed writer makes
 * the delete fail until an operator removes it — identical to
 * `delete --episode`, and diagnosable with `doctor`.
 *
 * Which writers take the lock is a measured decision, not a full set: the two
 * per-step writers (`EventStore.append`, `CheckpointStore.write`) do not,
 * because acquiring per append or per checkpoint costs +22.5% / +17.5% on an
 * end-to-end run. `requestPause` does, and so do the run lifecycles themselves
 * (`withRunLifecycleLock`, one acquisition held for a whole run — including the
 * track loop's clarification run, whose questions write is covered by it rather
 * than by an acquisition of its own). Each exclusion is argued where it is made.
 *
 * The verification stays as belt-and-braces (`verifyRunRecordsRemoved`), and
 * it runs twice: once inside the lock, and once after it is released. The lock
 * is cooperative and one run-plane writer deliberately does not take it
 * (`EventStore.append` — see there for the measured reason), so a resurrection
 * is still possible; and releasing a lock is itself two I/O turns, which such
 * a writer can use. Verifying again on the way out is what makes the returned
 * `DeletionResult` a statement about the moment the call returns rather than
 * about the moment it let go of the lock. The invocation rows dropped before
 * any of this stay dropped (with the derived p50 snapshot invalidated with
 * them), which is the privacy-safe half to have completed, and a re-delete is
 * idempotent about the rest.
 *
 * Measured on this VM against a tight-loop writer running for the whole
 * delete, 30 attempts per writer (event appends, checkpoint writes, both, and
 * a raw `mkdir` + append): every one of the 120 deletes failed closed, and
 * none reported success with records on disk. The same probes against the
 * previous code reported success over records that were already back 5, 2, 0
 * and 5 times out of 30.
 *
 * Those probes drive the run's writers directly, with nothing holding the
 * lifecycle lock — which is what a live run *does* hold. Against a real live
 * run the delete no longer reaches the removal at all: it waits, and then
 * either removes cleanly (the run ended inside the bounded wait) or fails with
 * `LOCK_TIMEOUT` having touched none of the run's records — its invocation
 * rows are already gone by then, disclosed rather than undone. The refusal it
 * replaces happened
 * *after* `rm` had already run, so a delete racing a live run used to destroy
 * part of that run's records on its way to failing closed.
 *
 * The one limit that cannot be closed from here: a write that lands after the
 * final verification is a new fact, not a resurrection — the same posture the
 * shared invocation log documents. The operator's remedy is unchanged: stop
 * the run, then delete again.
 */
export async function deleteRunRecords(
  stateRoot: string,
  runId: RunId,
  options: RunDeletionOptions = {}
): Promise<DeletionResult> {
  const invocations = await dropRunFromInvocationLog(stateRoot, runId, options);

  const runDir = join(runtimeRoot(stateRoot), "runs", runId);
  try {
    const removed = await removeRunSubtreeLocked(stateRoot, runId, runDir, options);
    // Re-assert outside the lock, so the claim this call returns with is about
    // the moment it returns and not about the moment it let go: releasing a
    // lock is itself two I/O turns, and a writer that does not take the lock
    // can use them. One `readdir` on an absent directory, once per delete.
    if (removed.length > 0) await verifyRunRecordsRemoved(stateRoot, runId);
    if (invocations.droppedRows > 0) {
      removed.push(`${invocations.path} (${invocations.droppedRows} invocation row(s))`);
      if (invocations.staleAggregate !== undefined) removed.push(invocations.staleAggregate);
    }
    return {
      target: `run:${runId}`,
      removedPaths: removed,
      cascadedFeedbackTombstones: [],
      droppedInvocations: invocations.droppedRows,
      residualEpisodeTextRunIds: []
    };
  } catch (error) {
    disclosePartialRunDelete(runId, invocations, options.disclosePartial);
    throw error;
  }
}

/**
 * Tell the caller what the failed delete already did, without letting the
 * telling replace the failure: a reporter that throws would hide a
 * `LOCK_TIMEOUT` behind a broken disclosure hook, which is the one outcome
 * worse than no disclosure at all.
 */
function disclosePartialRunDelete(
  runId: RunId,
  invocations: InvocationRewrite,
  disclose: ((line: string) => void) | undefined
): void {
  if (disclose === undefined || invocations.droppedRows === 0) return;
  const invalidated =
    invocations.staleAggregate === undefined
      ? ""
      : `, and the derived ${invocations.staleAggregate} snapshot was invalidated with them`;
  try {
    disclose(
      `run:${runId}: the delete failed, but its telemetry half had already completed and is not rolled back: ${invocations.droppedRows} invocation row(s) were dropped from ${invocations.path}${invalidated}. Whether the run's own records under runtime/runs/ survived is what the reported error says. Re-run the same delete once that is resolved; it is idempotent and removes the rest.`
    );
  } catch {
    // nothing left to report it to
  }
}

/**
 * Take the run's cooperative lock and remove the subtree under it.
 *
 * Nothing on disk for this run — no records and no lock — is a genuine no-op:
 * no lock is taken and `runtime/runs/` is not created just to delete from it,
 * exactly as `unlinkEpisodeFiles` treats an absent episode. A lock with no
 * records still means a live writer, so it is waited on and whatever that
 * writer leaves behind is then removed.
 *
 * The presence check is re-done inside the lock: what the pre-check saw is
 * stale by the time the lock is held, in both directions.
 */
async function removeRunSubtreeLocked(
  stateRoot: string,
  runId: RunId,
  runDir: string,
  options: FileLockOptions
): Promise<string[]> {
  const lockPath = runLockPath(stateRoot, runId);
  const onDisk = await Promise.all([runDir, lockPath].map(statExists));
  if (!onDisk.includes(true)) return [];

  return withExclusiveFileLock(
    lockPath,
    async () => {
      if (!(await statExists(runDir))) return [];
      await removeRunSubtree(stateRoot, runId, runDir);
      return [runDir];
    },
    options
  );
}

/**
 * Delete one episode's runtime records and cascade into feedback. Idempotent:
 * deleting an already-deleted episode succeeds and re-asserts the tombstones.
 *
 * `options` bounds every cooperative lock this delete takes (the feedback log
 * and the episode); the defaults are `withExclusiveFileLock`'s.
 *
 * The feedback cascade runs first and fails closed, for the same reason the
 * invocation rewrite does in `deleteRunRecords`: if the free text bound to
 * this episode cannot be stripped, the operator must see a failed delete with
 * the records still in place, not a successful one that removed the episode's
 * own files and left its feedback text on disk.
 *
 * The two locks are taken one after the other, never nested. The cascade
 * rewrites the feedback log and touches nothing under `runtime/episodes/`, so
 * holding the episode lock across it would only make `episode close` wait on
 * an unrelated file — and would fix a lock order that no other writer is
 * bound by. The cost is disclosed: a delete that strips the feedback text and
 * then cannot take the episode lock leaves the episode's own files in place.
 * That is the privacy-safe half to have completed, and the re-delete is
 * idempotent.
 */
export async function deleteEpisodeRecords(
  stateRoot: string,
  episodeId: EpisodeId,
  options: FileLockOptions = {}
): Promise<DeletionResult> {
  const cascaded = await cascadeFeedbackTombstones(stateRoot, episodeId, options);
  const unlinked = await unlinkEpisodeFiles(stateRoot, episodeId, options);

  const residual = await findResidualEpisodeText(stateRoot, episodeId, unlinked.episodeText);
  return {
    target: `episode:${episodeId}`,
    removedPaths: unlinked.removed,
    cascadedFeedbackTombstones: cascaded,
    droppedInvocations: 0,
    residualEpisodeTextRunIds: [...new Set(residual.map((entry) => entry.runId))].sort()
  };
}

interface EpisodeUnlink {
  /** Episode-scoped record files this delete unlinked, in listing order. */
  readonly removed: readonly string[];
  /** The episode's own text, read under the lock that guards the unlink. */
  readonly episodeText: readonly string[];
}

/**
 * Unlink the episode's runtime records while holding its cooperative lock.
 *
 * Two record files can sit under `runtime/episodes/`: the project-episode log
 * (`<id>.jsonl`) and the episode event log (`<id>.events.jsonl`). Both are
 * written by `episode close` and by the run-side settle, and both writers
 * serialize on `<id>.lock` (`episodeLockPath`). Deleting the records from
 * outside that lock — which is what this used to do, lock file included —
 * lets a settle that is mid read-decide-append write its snapshot back after
 * the delete, resurrecting the episode; unlinking the lock itself while a
 * holder was alive additionally let a second writer acquire it and reopen the
 * interleaving the lock exists to prevent.
 *
 * Contract details:
 *  - Acquisition is bounded and fails closed: `withExclusiveFileLock` throws
 *    `DomainValidationError` on timeout and nothing is unlinked. Locks are
 *    never stolen here either, so a lock left behind by a killed holder makes
 *    the delete fail until an operator removes it — the same posture (and the
 *    same manual recovery) every other holder of this lock has. Failing is
 *    the honest outcome: from the outside a stale lock is indistinguishable
 *    from a live writer that is about to write the records back.
 *  - The lock file is not unlinked by this function. Releasing the lock
 *    removes it, so a completed delete still leaves no `<id>.lock` behind,
 *    but it is a file this delete created rather than an episode record it
 *    found, so it is not reported in `removedPaths`.
 *  - Nothing on disk for this id — no records and no lock — is a genuine
 *    no-op: no lock is taken and `runtime/episodes/` is not created just to
 *    delete from it. A lock with no records still means a live writer, so it
 *    is waited on: whatever it writes is then found and removed.
 *  - The episode's own text is read inside the lock and before the unlink, so
 *    the residual scan sees exactly the text that is being deleted.
 */
async function unlinkEpisodeFiles(
  stateRoot: string,
  episodeId: EpisodeId,
  options: FileLockOptions
): Promise<EpisodeUnlink> {
  const episodesDir = join(runtimeRoot(stateRoot), "episodes");
  const records = [
    join(episodesDir, `${episodeId}.jsonl`),
    join(episodesDir, `${episodeId}.events.jsonl`)
  ];
  const lockPath = episodeLockPath(stateRoot, episodeId);
  const onDisk = await Promise.all([...records, lockPath].map(statExists));
  if (!onDisk.includes(true)) return { removed: [], episodeText: [] };

  return withExclusiveFileLock(
    lockPath,
    async () => {
      const episodeText = await readEpisodeText(episodesDir, episodeId);
      const removed: string[] = [];
      for (const file of records) {
        if (await statExists(file)) {
          await rm(file, { force: true });
          removed.push(file);
        }
      }
      return { removed, episodeText };
    },
    options
  );
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
 *
 * Contract details:
 *  - Read, filter, rewrite, and tombstone-write all happen inside the feedback
 *    log's cooperative lock (`withFeedbackLogLock`), the same lock
 *    `appendFeedback` takes. A live auto-adapt append therefore lands either
 *    wholly before the read or wholly after the write, instead of into the
 *    window between them where the rewrite would clobber it — or after it,
 *    putting text back on disk under an id that was just tombstoned.
 *  - A corrupt line throws. Reading it as "no records" is how this cascade
 *    used to report a successful delete while the episode's feedback text sat
 *    on disk untouched; a log we cannot parse is a log whose rows we cannot
 *    prove we stripped, so the delete fails closed instead.
 *  - No log at all is a genuine no-op: nothing is read, no lock is taken, and
 *    the adaptation plane is not created just to delete from it.
 *  - The text is stripped before the tombstones are persisted. A crash between
 *    the two leaves stripped shells that are not yet tombstoned, which is the
 *    privacy-safe direction: the text is already gone. Both writes are
 *    crash-atomic in themselves (`writeFeedbackRecords`,
 *    `writeFeedbackTombstones`), so neither can leave a torn file that the
 *    next read cannot parse.
 */
export async function cascadeFeedbackTombstones(
  stateRoot: string,
  episodeId: EpisodeId,
  options: FileLockOptions = {}
): Promise<string[]> {
  if (!(await statExists(feedbackLogPath(stateRoot)))) return [];
  return withFeedbackLogLock(
    stateRoot,
    async () => {
      const records = await readFeedbackRecordsRaw(
        stateRoot,
        "refusing to cascade an episode delete through it"
      );
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
      await writeFeedbackTombstones(stateRoot, tombstones);
      return cascaded.sort();
    },
    options
  );
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
  /** The stale p50 snapshot this rewrite invalidated, when there was one. */
  readonly staleAggregate: string | undefined;
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
 *    rewrite would clobber it. `options` bounds that acquisition too: this is
 *    one of the two locks a `delete --run` takes, so `--lock-wait-ms 0` must
 *    refuse here as immediately as it does at the run lock, and a long wait
 *    the operator chose must not be cut short by a 5 s default they did not.
 *    The live append path keeps its own defaults; nothing here changes them.
 *  - The derived p50 snapshot is invalidated here, with the rows, rather than
 *    at the end of the delete: the subtree removal that follows can fail
 *    closed (`RunRecordsSurvivedError`), and a failed delete must not leave an
 *    aggregate that still averages rows this rewrite already dropped.
 */
async function dropRunFromInvocationLog(
  stateRoot: string,
  runId: RunId,
  options: FileLockOptions = {}
): Promise<InvocationRewrite> {
  const path = invocationsLogPath(stateRoot);
  // No log, nothing to rewrite — and no reason to create the runtime directory
  // just to take a lock over a file that does not exist.
  if (!(await statExists(path))) return { path, droppedRows: 0, staleAggregate: undefined };
  const droppedRows = await withInvocationLogLock(
    stateRoot,
    async () => {
      const { values } = await readInvocationRecords(
        stateRoot,
        "refusing to rewrite it for a delete"
      );
      const kept = values.filter((row) => !rowNamesRun(row, runId));
      const dropped = values.length - kept.length;
      if (dropped === 0) return 0;
      await writeInvocationRecords(stateRoot, kept);
      return dropped;
    },
    options
  );
  const staleAggregate =
    droppedRows > 0 ? await invalidateCatalogObserved(stateRoot) : undefined;
  return { path, droppedRows, staleAggregate };
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
