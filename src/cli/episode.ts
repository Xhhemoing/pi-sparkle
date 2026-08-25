import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { DomainValidationError } from "../domain/errors.js";
import { isEpisodeId, parseEpisodeId } from "../domain/ids.js";
import { decideClosure } from "../episode/closure.js";
import { closeEpisode, waitForUser } from "../episode/manager.js";
import type { EpisodeEvent } from "../episode/events.js";
import { EpisodeEventStore, type EpisodeLogRead as EpisodeEventLogRead } from "../episode/store.js";
import { EpisodeStore, type EpisodeLogRead as EpisodeSnapshotLogRead } from "../run/episode-store.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import type { CliIo } from "./main.js";
import { CLI_EXIT, cliFail, errorCodeOf, warnTruncatedJsonl } from "./errors.js";

export const EPISODE_USAGE = `Usage:
  pi-sparkle episode events --episode <epId> [--state-root <dir>] [--json]
  pi-sparkle episode close --episode <epId> --status <COMPLETED|FAILED|ABANDONED> [--outcome <id>] [--state-root <dir>]

A COMPLETED close refused for incomplete acceptance records WAITING_FOR_USER (one EPISODE_WAITING event) so the episode names the evidence it waits for; close FAILED/ABANDONED remains available.
`;

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "ABANDONED"] as const;
type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

function isTerminalStatus(value: string): value is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(value);
}

/**
 * An operator-authored detail rendered safe for a one-line-per-event surface.
 *
 * The event schema constrains timestamps, ids and statuses, but leaves the
 * objective, the waiting reason, each evidence entry and the outcome id free
 * text. A tab or a newline in any of them would forge a column or a whole row
 * in this output, so they are escaped rather than refused: the event is already
 * valid and persisted, and a reader that cannot print it is worse than one that
 * prints it unambiguously. Backslash goes first, or the escapes it introduces
 * would be indistinguishable from a backslash the operator typed.
 */
function humanField(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

/**
 * One tab-separated line per event, timestamp first: an operator polls this
 * command to learn what the episode is doing and since when, and a bare type
 * name answers neither. Every field printed here is already in the `--json`
 * twin of the same event, so this widens no disclosure.
 *
 * The switch is per type because the events carry no shared timestamp field —
 * each shape names its own moment (`occurredAt`/`attachedAt`/`closedAt`), and
 * inventing a common alias would put a field in the CLI that the schema does
 * not have.
 */
function episodeEventLine(event: EpisodeEvent): string {
  switch (event.type) {
    case "EPISODE_OPENED":
      return `${event.occurredAt}\tEPISODE_OPENED\t${humanField(event.episode.objective)}`;
    case "RUN_ATTACHED":
      return `${event.attachedAt}\tRUN_ATTACHED\t${humanField(event.runId)}`;
    case "EPISODE_WAITING":
      return `${event.occurredAt}\tEPISODE_WAITING\t${humanField(event.reason)}${
        event.requiredEvidence.length > 0
          ? `: ${event.requiredEvidence.map(humanField).join(", ")}`
          : ""
      }`;
    case "EPISODE_CLOSED":
      return `${event.closedAt}\tEPISODE_CLOSED\t${event.status}${
        event.outcomeId !== undefined ? ` outcome=${humanField(event.outcomeId)}` : ""
      }`;
  }
}

/**
 * A stored-log decode fault this verb has to answer for itself, told apart
 * from a failure that already has a working routed remedy.
 *
 * Both episode stores raise an uncoded `DomainValidationError` for the first
 * row they cannot decode, naming the file and the line. A *coded* one — the
 * `LOCK_TIMEOUT` family — is a different failure entirely, and `main.ts` turns
 * its code into a `locks[]` remedy that genuinely answers, so it must keep
 * crossing this boundary untouched.
 */
function isCorruptLogError(error: unknown): error is DomainValidationError {
  return error instanceof DomainValidationError && errorCodeOf(error) === undefined;
}

/**
 * What an operator whose episode log will not decode can actually do.
 *
 * `pi-sparkle doctor` — the generic remedy these faults reach today through
 * `main.ts` — inventories run logs and locks, not episode JSONL, so it names
 * neither file and the operator is sent to a surface that cannot see the
 * defect. The store already named the file and the line; what is missing is
 * that the log is append-only, so nothing in this CLI will repair it in place,
 * and (for `close`) which surface does still answer.
 */
const CORRUPT_EVENT_LOG_NEXT =
  "the episode event log is append-only and pi-sparkle never rewrites it: repair or move aside the file named above, then retry; pi-sparkle doctor does not inventory episode logs";

const CORRUPT_SNAPSHOT_LOG_NEXT =
  "the episode log is append-only and pi-sparkle never rewrites it: repair or move aside the file named above; pnpm cli list --episodes --json lists the readable episodes and names damaged records under errors[]";

export async function episodeCommand(args: string[], io: CliIo): Promise<number> {
  const [subcommand, ...rest] = args;
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        episode: { type: "string" },
        status: { type: "string" },
        outcome: { type: "string" },
        "state-root": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle episode --help"
    });
  }
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h" || subcommand === undefined) {
    io.stdout(EPISODE_USAGE);
    return subcommand === undefined ? CLI_EXIT.error : CLI_EXIT.ok;
  }
  if (values.help === true) {
    io.stdout(EPISODE_USAGE);
    return CLI_EXIT.ok;
  }
  // Which verb was asked for is settled before anything that verb's flags are
  // judged: an operator who typed a subcommand this CLI does not have has not
  // yet made an `--episode` mistake, and reporting the id first would name the
  // wrong defect and hide the one they can act on.
  if (subcommand !== "events" && subcommand !== "close") {
    io.stderr(EPISODE_USAGE);
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: `Unknown episode command: ${subcommand}`,
      next: "use episode events or episode close"
    });
  }
  if (values.episode === undefined) {
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: "episode command requires --episode <epId>",
      next: "pass --episode <epId>"
    });
  }
  // An explicitly blank `--state-root` — what `--state-root "$SR"` leaves
  // behind when the variable is unset — would otherwise resolve to a
  // cwd-relative tree and be answered about authoritatively. It is judged
  // after the help returns and the unknown-subcommand refusal, because neither
  // of those needs a state root and an operator who typed a verb this CLI does
  // not have has not yet made a target mistake. It is judged before the root is
  // resolved, so no later refusal can interpolate the blank into its `next`.
  const rawStateRoot = values["state-root"];
  if (rawStateRoot !== undefined && rawStateRoot.trim() === "") {
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: `invalid --state-root "${rawStateRoot}": state root must be a non-empty directory path`,
      next: "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle"
    });
  }
  const stateRoot = rawStateRoot ?? join(homedir(), ".pi-sparkle");
  // A pasted-wrong id is an argv mistake, not a validation failure of stored
  // state: refusing here keeps the operator off the doctor-preflight remedy and
  // hands them the same episodes inventory the not-found path points at.
  if (!isEpisodeId(values.episode)) {
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: `invalid --episode "${values.episode}": expected an episode id of the form ep_<suffix>`,
      next: `pass --episode <epId> as printed by pnpm cli list --state-root ${stateRoot} --episodes`
    });
  }
  const episodeId = parseEpisodeId(values.episode);

  if (subcommand === "events") {
    let read: EpisodeEventLogRead;
    try {
      read = await new EpisodeEventStore(stateRoot, episodeId).readAll();
    } catch (error: unknown) {
      if (!isCorruptLogError(error)) throw error;
      return cliFail(io, {
        command: "episode",
        stage: "validation",
        // The store's bytes, unchanged: it already names the file and the line,
        // and rewording them here would put a second spelling of the same fault
        // in front of the operator.
        message: error.message,
        next: CORRUPT_EVENT_LOG_NEXT
      });
    }
    warnTruncatedJsonl(io, read.recovery, "episode event log");
    if (read.events.length === 0) {
      return cliFail(io, {
        command: "episode",
        stage: "lookup",
        message: `Episode ${episodeId} has no events under ${stateRoot}`,
        // The house not-found remedy, retargeted at episodes: an operator who
        // has the wrong episode id usually has no run id either, so pointing
        // back at `inspect --run` asks for the thing they are missing. The
        // inventory of episode ids that do exist under this state root answers.
        next: `check --state-root, then pnpm cli list --state-root ${stateRoot} --episodes for the episode ids that exist there`
      });
    }
    if (values.json) {
      for (const event of read.events) io.stdout(`${JSON.stringify(event)}\n`);
    } else {
      for (const event of read.events) io.stdout(`${episodeEventLine(event)}\n`);
    }
    return CLI_EXIT.ok;
  }

  // `--json` is parsed for every subcommand but only `events` honours it.
  // Refusing beats silently printing the plain-text close line to a caller
  // that is about to `JSON.parse` it.
  if (values.json === true) {
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: "episode close prints no JSON; --json applies to episode events",
      next: "drop --json, or use episode events --json"
    });
  }
  const status = values.status;
  if (status === undefined || !isTerminalStatus(status)) {
    return cliFail(io, {
      command: "episode",
      stage: "parse-args",
      message: "episode close requires --status COMPLETED, FAILED, or ABANDONED",
      next: "pass --status COMPLETED, FAILED, or ABANDONED"
    });
  }

  return await withExclusiveFileLock(
    join(runtimeRoot(stateRoot), "episodes", `${episodeId}.lock`),
    async () => {
      const snapshots = new EpisodeStore(stateRoot, episodeId);
      let snapshotRead: EpisodeSnapshotLogRead;
      try {
        snapshotRead = await snapshots.readAll();
      } catch (error: unknown) {
        if (!isCorruptLogError(error)) throw error;
        return cliFail(io, {
          command: "episode",
          stage: "validation",
          message: error.message,
          next: CORRUPT_SNAPSHOT_LOG_NEXT
        });
      }
      warnTruncatedJsonl(io, snapshotRead.recovery, "episode log");
      const latest = snapshotRead.episodes.at(-1);
      if (latest === undefined) {
        return cliFail(io, {
          command: "episode",
          stage: "lookup",
          message: `Episode ${episodeId} not found under ${stateRoot}`,
          next: `check --state-root, then pnpm cli list --state-root ${stateRoot} --episodes for the episode ids that exist there`
        });
      }
      const events = new EpisodeEventStore(stateRoot, episodeId);
      if (status === "COMPLETED") {
        const decision = decideClosure(latest, latest.runIds);
        if (!decision.canClose) {
          if (decision.reason === "acceptance-incomplete" && latest.status !== "WAITING_FOR_USER") {
            const waiting = waitForUser(latest, decision.reason, decision.requiredEvidence);
            await snapshots.append(waiting.episode);
            await events.append(waiting.event);
            // Disclosed only once both appends returned: a refusal must never
            // claim a write that threw.
            io.stderr(
              `note: recorded WAITING_FOR_USER for ${episodeId} — this refused close changed the episode status; it now names its missing evidence\n`
            );
          } else if (decision.reason === "acceptance-incomplete") {
            io.stderr("note: episode is already WAITING_FOR_USER; no new snapshot recorded\n");
          }
          io.stderr(
            `${decision.reason}${decision.requiredEvidence.length > 0 ? `: ${decision.requiredEvidence.join(", ")}` : ""}\n`
          );
          return cliFail(io, {
            command: "episode",
            stage: "close",
            message: decision.reason,
            next: "satisfy required evidence or close as FAILED/ABANDONED"
          });
        }
      } else if (latest.status !== "OPEN" && latest.status !== "WAITING_FOR_USER") {
        return cliFail(io, {
          command: "episode",
          stage: "close",
          message: "already-closed",
          next: "inspect --episode to see the terminal status"
        });
      }

      const closed = closeEpisode(latest, status, values.outcome);
      await snapshots.append(closed.episode);
      await events.append(closed.event);
      io.stdout(`Episode ${episodeId}: ${closed.episode.status}\n`);
      return 0;
    }
  );
}
