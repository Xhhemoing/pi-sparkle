/**
 * Wiring note for `src/cli/main.ts` (not edited here):
 *   import { listCommand } from "./list.js";
 *   case "list": return await listCommand(rest, io);
 * and one USAGE line:
 *   pi-sparkle list [--runs | --episodes] [--status <RunStatus>] [--state-root <dir>] [--json]
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
  pi-sparkle list [--runs] [--status <RunStatus>] [--state-root <dir>] [--json]
  pi-sparkle list --episodes [--state-root <dir>] [--json]

Lists the runs (default) or episodes recorded under a state root, ordered by id,
with the status replayed from each log. --status filters runs by that status, one
of ${RUN_STATUSES.join(", ")}. Records that cannot be read are counted on stderr
and listed under "errors" in --json; the other records are still listed and the
exit code stays 0. --json prints exactly one object on stdout (developer
preview). State root defaults to ~/.pi-sparkle.
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
}

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function jsonErrors(errors: readonly InventoryError[]): ListJsonError[] {
  return errors.map((error) => ({ path: error.path, message: error.message }));
}

function warnIncomplete(io: ListIo, errors: readonly InventoryError[]): void {
  if (errors.length === 0) return;
  io.stderr(`warning: list incomplete: ${errors.length} unreadable record(s)\n`);
}

function writeRuns(io: ListIo, runs: readonly RunInventoryRow[], json: boolean, errors: readonly InventoryError[]): void {
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
      errors: jsonErrors(errors)
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
  errors: readonly InventoryError[]
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
      errors: jsonErrors(errors)
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
    writeEpisodes(io, inventory.episodes, json, inventory.errors);
    warnIncomplete(io, inventory.errors);
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
  const runs =
    status === undefined ? inventory.runs : inventory.runs.filter((run) => run.status === status);
  writeRuns(io, runs, json, inventory.errors);
  warnIncomplete(io, inventory.errors);
  return CLI_EXIT.ok;
}
