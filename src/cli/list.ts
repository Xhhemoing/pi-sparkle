/**
 * Wiring note for `src/cli/main.ts` (not edited here):
 *   import { listCommand } from "./list.js";
 *   case "list": return await listCommand(rest, io);
 * and one USAGE line:
 *   pi-sparkle list [--runs | --episodes] [--status <RunStatus>] [--sort <id|last-event>]
 *                   [--state-root <dir>] [--json]
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isRunStatus, RUN_STATUSES, type RunStatus } from "../domain/status.js";
import {
  listEpisodes,
  listRuns,
  type EpisodeInventoryRow,
  type InventoryError,
  type RunInventoryRow
} from "../run/inventory.js";
import { CLI_EXIT, cliFail } from "./errors.js";

export interface ListIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const LIST_USAGE = `Usage:
  pi-sparkle list [--runs] [--status <RunStatus>] [--sort <id|last-event>] [--state-root <dir>] [--json]
  pi-sparkle list --episodes [--sort <id|last-event>] [--state-root <dir>] [--json]

Lists the runs (default) or episodes recorded under a state root, ordered by id,
with the status replayed from each log. --status filters runs by that status, one
of ${RUN_STATUSES.join(", ")}. --sort last-event orders the rows most-recent-first
by their last event, tie-broken by id; rows with no timestamp sort last. Records
that cannot be read are counted on stderr and listed under "errors" in --json; the
other records are still listed and the exit code stays 0. A record whose log was
crash-truncated is listed with the status replayed from the shortened log, and the
dropped tail is disclosed on stderr and under "warnings" in --json. --json prints
exactly one object on stdout (developer preview). State root defaults to
~/.pi-sparkle.
`;

/**
 * Frozen `list --json` contract. Additive changes only: consumers pin `type`
 * and `preview`, and read `runs` / `episodes` / `errors`. Not a domain Event
 * (no `id`; `type` is outside the Event union), and `preview: true` says so.
 */
export interface ListJsonRunRow {
  readonly runId: string;
  readonly status: RunStatus;
  readonly lastEventAt: string;
  readonly episodeId: string | null;
}

export interface ListJsonEpisodeRow {
  readonly episodeId: string;
  readonly status: string;
  readonly lastEventAt: string | null;
}

export interface ListJsonError {
  readonly path: string;
  readonly message: string;
}

export interface ListJson {
  readonly type: "RUN_LIST" | "EPISODE_LIST";
  readonly preview: true;
  readonly runs?: readonly ListJsonRunRow[];
  readonly episodes?: readonly ListJsonEpisodeRow[];
  readonly errors: readonly ListJsonError[];
  /**
   * Records that were listed from a crash-truncated log. Always present, like
   * `errors`: a consumer must be able to tell "nothing was truncated" from "the
   * key predates this field".
   */
  readonly warnings: readonly ListJsonError[];
}

/** What the rows are ordered by. `id` is the inventory's own order. */
export type ListSort = "id" | "last-event";

const LIST_SORTS: readonly ListSort[] = ["id", "last-event"];

function isListSort(value: string): value is ListSort {
  return (LIST_SORTS as readonly string[]).includes(value);
}

/**
 * Newest first, by instant.
 *
 * An `IsoTimestamp` may carry a UTC offset rather than `Z`
 * (`domain/timestamp.ts`), and offset timestamps do not sort as text:
 * `2026-08-25T23:00:00+14:00` is 09:00Z, an hour *before*
 * `2026-08-25T10:00:00Z`, while string order puts it after. So the times are
 * parsed to instants before they are compared.
 *
 * A row with no timestamp sorts last, and an unparseable one ranks equal
 * rather than returning NaN from the comparator, which would corrupt the order
 * silently.
 */
function compareByInstantDesc(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) {
    if (left === right) return 0;
    return left === undefined ? 1 : -1;
  }
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) return 0;
  return rightMs - leftMs;
}

/**
 * The rows, most-recent-first by `lastEventAt`, ties broken by id ascending so
 * the order is total and stable across runs.
 *
 * A row with no timestamp sorts last rather than first: "when did this last
 * move" cannot be answered for it, and an unanswerable row must not head a
 * recency list. Exported because that branch is unreachable through the
 * episode store today (every snapshot that validates carries `startedAt`),
 * and an ordering rule no test can reach is an ordering rule nobody owns.
 */
export function sortByLastEvent<Row extends { readonly lastEventAt?: string | undefined }>(
  rows: readonly Row[],
  idOf: (row: Row) => string
): Row[] {
  return [...rows].sort((left, right) => {
    const byInstant = compareByInstantDesc(left.lastEventAt, right.lastEventAt);
    return byInstant !== 0 ? byInstant : idOf(left).localeCompare(idOf(right));
  });
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function jsonErrors(errors: readonly InventoryError[]): ListJsonError[] {
  return errors.map((error) => ({ path: error.path, message: error.message }));
}

/**
 * Every disclosure the inventory owes stderr, in the order an operator reads
 * them: the named truncated logs first, then the count of records that could
 * not be read at all.
 */
function warnNotices(io: ListIo, notices: InventoryNotices): void {
  for (const warning of notices.warnings) {
    io.stderr(`warning: ${warning.path}: ${warning.message}\n`);
  }
  if (notices.errors.length === 0) return;
  io.stderr(`warning: list incomplete: ${notices.errors.length} unreadable record(s)\n`);
}

interface InventoryNotices {
  readonly errors: readonly InventoryError[];
  readonly warnings: readonly InventoryError[];
}

function writeRuns(
  io: ListIo,
  runs: readonly RunInventoryRow[],
  json: boolean,
  notices: InventoryNotices
): void {
  if (json) {
    const payload: ListJson = {
      type: "RUN_LIST",
      preview: true,
      runs: runs.map((run) => ({
        runId: run.runId,
        status: run.status,
        lastEventAt: run.lastEventAt,
        episodeId: run.episodeId ?? null
      })),
      errors: jsonErrors(notices.errors),
      warnings: jsonErrors(notices.warnings)
    };
    io.stdout(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (runs.length === 0) {
    io.stdout("(no runs)\n");
    return;
  }
  for (const run of runs) {
    io.stdout(`${run.runId}\t${run.status}\t${run.lastEventAt}\t${run.episodeId ?? "-"}\n`);
  }
}

function writeEpisodes(
  io: ListIo,
  episodes: readonly EpisodeInventoryRow[],
  json: boolean,
  notices: InventoryNotices
): void {
  if (json) {
    const payload: ListJson = {
      type: "EPISODE_LIST",
      preview: true,
      episodes: episodes.map((episode) => ({
        episodeId: episode.episodeId,
        status: episode.status,
        lastEventAt: episode.lastEventAt ?? null
      })),
      errors: jsonErrors(notices.errors),
      warnings: jsonErrors(notices.warnings)
    };
    io.stdout(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (episodes.length === 0) {
    io.stdout("(no episodes)\n");
    return;
  }
  for (const episode of episodes) {
    io.stdout(`${episode.episodeId}\t${episode.status}\t${episode.lastEventAt ?? "-"}\n`);
  }
}

export async function listCommand(args: string[], io: ListIo): Promise<number> {
  const first = args[0];
  if (first === "help" || first === "--help" || first === "-h") {
    io.stdout(LIST_USAGE);
    return CLI_EXIT.ok;
  }

  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        runs: { type: "boolean", default: false },
        episodes: { type: "boolean", default: false },
        status: { type: "string" },
        sort: { type: "string" },
        json: { type: "boolean", default: false },
        "state-root": { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "list",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle list --help"
    });
  }

  if (values.help === true) {
    io.stdout(LIST_USAGE);
    return CLI_EXIT.ok;
  }
  if (values.runs === true && values.episodes === true) {
    return cliFail(io, {
      command: "list",
      stage: "parse-args",
      message: "list accepts --runs or --episodes, not both",
      next: "pass one of --runs or --episodes (runs is the default)"
    });
  }

  const episodesMode = values.episodes === true;
  const status = values.status;
  if (status !== undefined) {
    if (!isRunStatus(status)) {
      return cliFail(io, {
        command: "list",
        stage: "parse-args",
        message: `Unknown run status: ${status}`,
        next: `pass --status ${RUN_STATUSES.join("|")}`
      });
    }
    // Refused rather than ignored: an episode carries an EpisodeStatus, so
    // applying a RunStatus filter to it would silently list everything.
    if (episodesMode) {
      return cliFail(io, {
        command: "list",
        stage: "parse-args",
        message: "list --status filters runs and does not apply to --episodes",
        next: "drop --status, or list runs instead"
      });
    }
  }

  const sort = values.sort ?? "id";
  if (!isListSort(sort)) {
    return cliFail(io, {
      command: "list",
      stage: "parse-args",
      message: `Unknown list sort: ${sort}`,
      next: "pass --sort id or --sort last-event"
    });
  }

  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const json = values.json === true;

  if (episodesMode) {
    let inventory;
    try {
      inventory = await listEpisodes(stateRoot);
    } catch (error) {
      return cliFail(io, {
        command: "list",
        stage: "execute",
        message: error instanceof Error ? error.message : String(error),
        next: `check --state-root ${stateRoot} is readable`
      });
    }
    const episodes =
      sort === "last-event"
        ? sortByLastEvent(inventory.episodes, (episode) => episode.episodeId)
        : inventory.episodes;
    writeEpisodes(io, episodes, json, inventory);
    warnNotices(io, inventory);
    return CLI_EXIT.ok;
  }

  let inventory;
  try {
    inventory = await listRuns(stateRoot);
  } catch (error) {
    return cliFail(io, {
      command: "list",
      stage: "execute",
      message: error instanceof Error ? error.message : String(error),
      next: `check --state-root ${stateRoot} is readable`
    });
  }
  const selected =
    status === undefined ? inventory.runs : inventory.runs.filter((run) => run.status === status);
  const runs = sort === "last-event" ? sortByLastEvent(selected, (run) => run.runId) : selected;
  writeRuns(io, runs, json, inventory);
  warnNotices(io, inventory);
  return CLI_EXIT.ok;
}
