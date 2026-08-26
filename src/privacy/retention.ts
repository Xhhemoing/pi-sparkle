import { readdir, rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { runtimeRoot } from "./state-layout.js";
import { deleteEpisodeRecords } from "./deletion.js";
import { DomainValidationError } from "../domain/errors.js";
import { isEpisodeId, type EpisodeId, type RunId } from "../domain/ids.js";
import { isIsoTimestamp } from "../domain/timestamp.js";
import { catalogObservedPath } from "../routing/catalog-observed.js";
import {
  invocationsLogPath,
  readInvocationRecords,
  withInvocationLogLock,
  writeInvocationRecords
} from "../telemetry/invocation-log.js";
import type { FileLockOptions } from "../persist/file-lock.js";

/**
 * The age bound for the two record classes whose growth was previously
 * unbounded: the shared `runtime/invocations.jsonl` and every episode under
 * `runtime/episodes/`.
 *
 * Until this module existed, both were retained until an operator deleted them
 * by hand (`delete --run` / `delete --episode`), which is not a retention
 * policy — it is the absence of one. `scripts/retention-probe.mjs` measured the
 * resulting growth and reported `unbounded: true` without failing, because
 * there was no bound to fail against. There is one now, and the probe checks
 * against it.
 *
 * 90 days is the default, not a law: `retain --max-age-days` overrides it per
 * invocation, and nothing in the runtime reads the constant except this module
 * and the CLI command that drives it. Enforcement is explicit — no run, no
 * append and no background timer prunes anything. An operator (or a scheduled
 * `pi-sparkle retain --apply`) decides when records go, which keeps deletion a
 * thing that happens because somebody asked for it.
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = { maxAgeDays: 90 };

export interface RetentionPolicy {
  /** Records older than this many days are expired. Must be positive and finite. */
  readonly maxAgeDays: number;
}

const MS_PER_DAY = 86_400_000;

export function validateRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  const { maxAgeDays } = policy;
  if (typeof maxAgeDays !== "number" || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    throw new DomainValidationError(
      `retention maxAgeDays must be a positive finite number of days, got: ${String(maxAgeDays)}`
    );
  }
  return { maxAgeDays };
}

/** The two record classes this bound covers. */
export type RetainedRecordKind = "invocation" | "episode";

export interface ExpiredRecord {
  readonly kind: RetainedRecordKind;
  /** Invocation id, or episode id. */
  readonly id: string;
  /** The file the record lives in. Shared for invocations, per-id for episodes. */
  readonly path: string;
  /** The timestamp the age was measured from. */
  readonly recordedAt: string;
  readonly ageDays: number;
}

/**
 * Why a record the prune walked past was left alone.
 *
 *  - `undated`: an invocation row with no readable `occurredAt`. Its age cannot
 *    be established, so it cannot be proven expired, so it stays. A row that is
 *    not a record we understand is never deleted on a guess.
 */
export type RetentionHoldReason = "undated";

export interface HeldRecord {
  readonly kind: RetainedRecordKind;
  readonly id: string;
  readonly path: string;
  readonly reason: RetentionHoldReason;
}

export interface RetentionPlan {
  readonly stateRoot: string;
  readonly policy: RetentionPolicy;
  /** Records dated before this instant are expired. */
  readonly cutoff: string;
  /** Expired records, oldest first. */
  readonly expired: readonly ExpiredRecord[];
  /** Records this prune deliberately does not touch, with the reason. */
  readonly held: readonly HeldRecord[];
  /** Dated records considered, expired ones included. */
  readonly consideredRecords: number;
  /** Age of the oldest dated record, or `undefined` when nothing is dated. */
  readonly oldestAgeDays: number | undefined;
}

/** True when no expired record is left on disk, i.e. the bound holds. */
export function isWithinRetentionBound(plan: RetentionPlan): boolean {
  return plan.expired.length === 0;
}

export interface RetentionOptions {
  readonly policy?: RetentionPolicy;
  /** Clock seam. Defaults to `Date.now`. */
  readonly now?: () => Date;
  /** Bounds every cooperative lock the prune takes. */
  readonly lock?: FileLockOptions;
}

export interface RetentionPruneResult {
  readonly plan: RetentionPlan;
  /** False for a dry run, in which case nothing below is non-empty. */
  readonly applied: boolean;
  /** One line per path the prune changed, in the shape `delete` reports. */
  readonly removedPaths: readonly string[];
  readonly droppedInvocations: number;
  readonly deletedEpisodes: readonly EpisodeId[];
  readonly cascadedFeedbackTombstones: readonly string[];
  /**
   * Runs whose append-only logs still hold a deleted episode's text. Reported,
   * never rewritten — same posture as `delete --episode`, which is the helper
   * this prune deletes episodes through.
   */
  readonly residualEpisodeTextRunIds: readonly RunId[];
}

/**
 * Decide what a prune would remove, without writing anything.
 *
 * Reads are lock-free and tolerant: a corrupt invocation row is reported as
 * held, not thrown, because a plan is a report and one damaged line must not
 * hide the other 10,000 rows' ages from the operator. The *prune* is the strict
 * half — it re-reads through `readInvocationRecords`, which fails closed on a
 * corrupt middle line.
 */
export async function planRetention(
  stateRoot: string,
  options: RetentionOptions = {}
): Promise<RetentionPlan> {
  const policy = validateRetentionPolicy(options.policy ?? DEFAULT_RETENTION_POLICY);
  const nowMs = (options.now?.() ?? new Date()).getTime();
  const cutoffMs = nowMs - policy.maxAgeDays * MS_PER_DAY;

  const expired: ExpiredRecord[] = [];
  const held: HeldRecord[] = [];
  let considered = 0;
  let oldestMs: number | undefined;

  const note = (recordedMs: number | undefined): void => {
    if (recordedMs === undefined) return;
    considered += 1;
    if (oldestMs === undefined || recordedMs < oldestMs) oldestMs = recordedMs;
  };

  for (const row of await readInvocationRows(stateRoot)) {
    note(row.recordedMs);
    if (row.recordedMs === undefined) {
      held.push({ kind: "invocation", id: row.id, path: row.path, reason: "undated" });
      continue;
    }
    if (row.recordedMs >= cutoffMs) continue;
    expired.push({
      kind: "invocation",
      id: row.id,
      path: row.path,
      recordedAt: new Date(row.recordedMs).toISOString(),
      ageDays: ageInDays(nowMs, row.recordedMs)
    });
  }

  for (const episode of await readEpisodeAges(stateRoot)) {
    note(episode.recordedMs);
    if (episode.recordedMs >= cutoffMs) continue;
    expired.push({
      kind: "episode",
      id: episode.id,
      path: episode.path,
      recordedAt: new Date(episode.recordedMs).toISOString(),
      ageDays: ageInDays(nowMs, episode.recordedMs)
    });
  }

  expired.sort((left, right) => right.ageDays - left.ageDays || left.id.localeCompare(right.id));
  return {
    stateRoot,
    policy,
    cutoff: new Date(cutoffMs).toISOString(),
    expired,
    held,
    consideredRecords: considered,
    oldestAgeDays: oldestMs === undefined ? undefined : ageInDays(nowMs, oldestMs)
  };
}

/**
 * Apply the age bound, or report what applying it would do.
 *
 * `apply: false` (the default at the CLI, matching `migrate-legacy`) plans and
 * returns; nothing on disk is touched. `apply: true` removes the expired
 * records through the same helpers `delete` uses, so a pruned episode gets the
 * *whole* deletion cascade and not a cheaper age-based imitation of it:
 *
 *  - Episodes go through {@link deleteEpisodeRecords}: both record shapes are
 *    unlinked under the episode's cooperative lock, every feedback record bound
 *    to the episode loses `body` and `summary` and is tombstoned, and runs whose
 *    append-only logs still carry the episode's text are reported rather than
 *    rewritten. A prune that unlinked the two files itself would leave that
 *    feedback text on disk under a bound that claims it is gone.
 *  - Invocation rows are filter-rewritten under the log's cooperative lock and
 *    the derived p50 snapshot (`runtime/routing/catalog-observed.json`) is
 *    invalidated with them, exactly as a run delete does. A percentile cannot
 *    have rows subtracted from it, and every reader treats the missing file as
 *    "no observations" rather than zeros.
 *
 * Order matches `deleteRunRecords`: the shared log is rewritten first, so a
 * prune that then fails on a locked episode has still completed the half that
 * removed data. The prune is idempotent — re-running it after a partial failure
 * finishes the job.
 *
 * The plan is computed once and the invocation rewrite re-derives expiry from
 * the same cutoff under the lock, so a row appended between the plan and the
 * rewrite is judged by its own timestamp instead of being caught by a stale id
 * list.
 *
 * Cost: `deleteEpisodeRecords` reads every run's event log once per episode, to
 * find residual copies of that episode's text. That is fine for an operator
 * command over a handful of expired episodes and is why nothing calls this on a
 * live path.
 */
export async function pruneRetention(
  stateRoot: string,
  options: RetentionOptions & { readonly apply?: boolean } = {}
): Promise<RetentionPruneResult> {
  const plan = await planRetention(stateRoot, options);
  const lock = options.lock ?? {};
  if (options.apply !== true) {
    return {
      plan,
      applied: false,
      removedPaths: [],
      droppedInvocations: 0,
      deletedEpisodes: [],
      cascadedFeedbackTombstones: [],
      residualEpisodeTextRunIds: []
    };
  }

  const removedPaths: string[] = [];
  const droppedInvocations = await dropExpiredInvocations(stateRoot, plan, lock);
  if (droppedInvocations > 0) {
    removedPaths.push(`${invocationsLogPath(stateRoot)} (${droppedInvocations} invocation row(s))`);
    const stale = await invalidateCatalogObserved(stateRoot);
    if (stale !== undefined) removedPaths.push(stale);
  }

  const deletedEpisodes: EpisodeId[] = [];
  const tombstones: string[] = [];
  const residual = new Set<RunId>();
  for (const record of plan.expired) {
    if (record.kind !== "episode" || !isEpisodeId(record.id)) continue;
    const result = await deleteEpisodeRecords(stateRoot, record.id, lock);
    deletedEpisodes.push(record.id);
    removedPaths.push(...result.removedPaths);
    tombstones.push(...result.cascadedFeedbackTombstones);
    for (const runId of result.residualEpisodeTextRunIds) residual.add(runId);
  }

  return {
    plan,
    applied: true,
    removedPaths,
    droppedInvocations,
    deletedEpisodes,
    cascadedFeedbackTombstones: tombstones.sort(),
    residualEpisodeTextRunIds: [...residual].sort()
  };
}

interface InvocationRow {
  readonly id: string;
  readonly path: string;
  /** `undefined` when the row carries no readable `occurredAt`. */
  readonly recordedMs: number | undefined;
}

/**
 * The shared log's rows with their ages, read tolerantly for planning.
 *
 * A corrupt middle line makes `readInvocationRecords` throw, which is right for
 * a rewrite and wrong for a report: the operator asking "what is over the
 * bound" would get an error naming one line instead of the answer. So the plan
 * reads the file directly and treats an unparseable line as one undated row.
 */
async function readInvocationRows(stateRoot: string): Promise<InvocationRow[]> {
  const path = invocationsLogPath(stateRoot);
  const raw = await readTextFile(path);
  const rows: InvocationRow[] = [];
  let lineNumber = 0;
  for (const line of raw.split("\n")) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      rows.push({ id: `line ${lineNumber}`, path, recordedMs: undefined });
      continue;
    }
    const row = parsed as { id?: unknown; occurredAt?: unknown };
    const id = typeof row.id === "string" && row.id !== "" ? row.id : `line ${lineNumber}`;
    rows.push({ id, path, recordedMs: isoMs(row.occurredAt) });
  }
  return rows;
}

interface EpisodeAge {
  readonly id: EpisodeId;
  readonly path: string;
  readonly recordedMs: number;
}

/**
 * Every episode under `runtime/episodes/` with the instant its records were
 * last known to be live.
 *
 * Both record shapes are read (`<id>.jsonl` and `<id>.events.jsonl`), and the
 * age is taken from the newest `closedAt ?? startedAt` across them: a closed
 * episode ages from its close, an open one from its start, and an episode
 * re-attached to a later run ages from that later snapshot rather than from the
 * first one on the log.
 *
 * An episode with no readable timestamp anywhere falls back to the file's
 * mtime. That is deliberately the conservative direction — mtime only moves
 * forward, so a record whose dates are unreadable is kept longer than the
 * policy asks, never deleted sooner.
 */
async function readEpisodeAges(stateRoot: string): Promise<EpisodeAge[]> {
  const episodesDir = join(runtimeRoot(stateRoot), "episodes");
  const entries = await readdir(episodesDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    }
  );

  const newest = new Map<EpisodeId, number>();
  const files = new Map<EpisodeId, string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.replace(/\.events\.jsonl$|\.jsonl$/, "");
    if (!isEpisodeId(id)) continue;
    const path = join(episodesDir, entry.name);
    files.set(id, join(episodesDir, `${id}.jsonl`));
    for (const recordedMs of await episodeTimestamps(path)) {
      const current = newest.get(id);
      if (current === undefined || recordedMs > current) newest.set(id, recordedMs);
    }
  }

  const ages: EpisodeAge[] = [];
  for (const [id, path] of files) {
    const dated = newest.get(id) ?? (await mtimeMs(join(episodesDir, `${id}.jsonl`))) ??
      (await mtimeMs(join(episodesDir, `${id}.events.jsonl`)));
    if (dated === undefined) continue;
    ages.push({ id, path, recordedMs: dated });
  }
  return ages.sort((left, right) => left.id.localeCompare(right.id));
}

/** Every `closedAt ?? startedAt` on one episode record file, in ms. */
async function episodeTimestamps(path: string): Promise<number[]> {
  const raw = await readTextFile(path);
  const out: number[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    // The project-episode log stores snapshots directly; the event log wraps
    // them in `{ type, episode }`.
    const wrapped = (parsed as { episode?: unknown }).episode;
    const shape = (typeof wrapped === "object" && wrapped !== null ? wrapped : parsed) as {
      startedAt?: unknown;
      closedAt?: unknown;
    };
    const recordedMs = isoMs(shape.closedAt) ?? isoMs(shape.startedAt);
    if (recordedMs !== undefined) out.push(recordedMs);
  }
  return out;
}

/**
 * Filter-rewrite the shared log, dropping every row older than the plan's
 * cutoff. Holds the log's cooperative lock across read, filter and write — the
 * same lock `appendInvocationRecord` takes — so a live append lands wholly
 * before or wholly after, never into the middle of the rewrite.
 *
 * `readInvocationRecords` fails closed on a corrupt middle line: if the ages of
 * the surrounding rows cannot be established, nothing is dropped. Rows that
 * parse but carry no readable `occurredAt` are kept, for the same reason the
 * plan holds them.
 */
async function dropExpiredInvocations(
  stateRoot: string,
  plan: RetentionPlan,
  lock: FileLockOptions
): Promise<number> {
  if (!plan.expired.some((record) => record.kind === "invocation")) return 0;
  const cutoffMs = Date.parse(plan.cutoff);
  return withInvocationLogLock(
    stateRoot,
    async () => {
      const { values } = await readInvocationRecords(
        stateRoot,
        "refusing to rewrite it for a retention prune"
      );
      const kept = values.filter((row) => !rowIsExpired(row, cutoffMs));
      const dropped = values.length - kept.length;
      if (dropped === 0) return 0;
      await writeInvocationRecords(stateRoot, kept);
      return dropped;
    },
    lock
  );
}

function rowIsExpired(row: unknown, cutoffMs: number): boolean {
  if (typeof row !== "object" || row === null) return false;
  const recordedMs = isoMs((row as { occurredAt?: unknown }).occurredAt);
  return recordedMs !== undefined && recordedMs < cutoffMs;
}

/**
 * The p50 snapshot aggregates over every invocation row, including the ones the
 * prune just dropped, so it is invalidated rather than recomputed — the same
 * call `deleteRunRecords` makes, for the same documented reason: the class's
 * recovery is "rebuild from invocations.jsonl", and a delete should never
 * manufacture a fresh derived artifact of its own.
 */
async function invalidateCatalogObserved(stateRoot: string): Promise<string | undefined> {
  const path = catalogObservedPath(stateRoot);
  const exists = await stat(path).catch(() => undefined);
  if (exists === undefined) return undefined;
  await rm(path, { force: true });
  return path;
}

function isoMs(value: unknown): number | undefined {
  if (!isIsoTimestamp(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function mtimeMs(path: string): Promise<number | undefined> {
  const details = await stat(path).catch(() => undefined);
  return details === undefined ? undefined : details.mtimeMs;
}

/** Age in whole-ish days, rounded down to two decimals so short runs stay visible. */
function ageInDays(nowMs: number, recordedMs: number): number {
  return Math.round(((nowMs - recordedMs) / MS_PER_DAY) * 100) / 100;
}

async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR") return "";
    throw error;
  });
}
