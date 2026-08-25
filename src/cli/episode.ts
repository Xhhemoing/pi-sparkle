import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { runtimeRoot } from "../privacy/state-layout.js";
import { isEpisodeId, parseEpisodeId } from "../domain/ids.js";
import { decideClosure } from "../episode/closure.js";
import { closeEpisode, waitForUser } from "../episode/manager.js";
import type { EpisodeEvent } from "../episode/events.js";
import { EpisodeEventStore } from "../episode/store.js";
import { EpisodeStore } from "../run/episode-store.js";
import { withExclusiveFileLock } from "../persist/file-lock.js";
import type { CliIo } from "./main.js";
import { CLI_EXIT, cliFail, warnTruncatedJsonl } from "./errors.js";

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
  const stateRoot = values["state-root"] ?? join(homedir(), ".pi-sparkle");
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
    const read = await new EpisodeEventStore(stateRoot, episodeId).readAll();
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
      const snapshotRead = await snapshots.readAll();
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
