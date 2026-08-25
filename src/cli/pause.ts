import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isRunId, parseRunId } from "../domain/ids.js";
import { createCalibratedCliModelRouter } from "./model-catalog.js";
import { pauseFlowchartRun } from "../run/flowchart-run.js";
import { createFilePauseController, unlinkPauseToken } from "../run/pause-controller.js";
import { EventStore } from "../run/event-store.js";
import { CLI_EXIT, cliFail } from "./errors.js";

export interface PauseIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const PAUSE_USAGE = `pi-sparkle pause — write a pause token for a live run

Usage:
  pi-sparkle pause --run <runId> [--reason <text>] [--state-root <dir>]
  pi-sparkle pause --clear --run <runId> [--state-root <dir>]
`;

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

export async function pauseCommand(args: string[], io: PauseIo): Promise<number> {
  const first = args[0];
  if (first === "help" || first === "--help" || first === "-h") {
    io.stdout(PAUSE_USAGE);
    return CLI_EXIT.ok;
  }

  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        run: { type: "string" },
        reason: { type: "string" },
        clear: { type: "boolean", default: false },
        "state-root": { type: "string" },
        help: { type: "boolean", short: "h", default: false }
      }
    }));
  } catch (error) {
    return cliFail(io, {
      command: "pause",
      stage: "parse-args",
      message: error instanceof Error ? error.message : String(error),
      next: "run pi-sparkle pause --help"
    });
  }

  if (values.help === true) {
    io.stdout(PAUSE_USAGE);
    return CLI_EXIT.ok;
  }
  if (values.run === undefined) {
    return cliFail(io, {
      command: "pause",
      stage: "parse-args",
      message: "pause requires --run <runId>",
      next: "pass --run <runId>"
    });
  }
  if (values.clear === true && values.reason !== undefined) {
    return cliFail(io, {
      command: "pause",
      stage: "parse-args",
      message: "pause --clear does not accept --reason",
      next: "omit --reason when clearing a pause"
    });
  }
  // The controller already refuses a blank reason, but only after the run
  // lookup has read the event log — so a pure argv mistake was reported as a
  // validation failure with the doctor remedy. Same wording as
  // `pause-controller.ts` so the two cannot drift; checked here, before state.
  if (values.reason !== undefined && values.reason.trim() === "") {
    return cliFail(io, {
      command: "pause",
      stage: "parse-args",
      message: `invalid --reason "${values.reason}": pause reason must be a non-empty string`,
      next: "pass --reason <text> or omit it",
      runId: values.run
    });
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  // A pasted-wrong run id used to throw out of `parseRunId` into main's catch,
  // which calls it a validation failure and sends the operator to doctor
  // preflight — the one remedy that cannot fix an argv typo, and it never named
  // the flag. The domain's own predicate decides, so the shapes cannot diverge.
  if (!isRunId(values.run)) {
    return cliFail(io, {
      command: "pause",
      stage: "parse-args",
      message: `invalid --run "${values.run}": expected a run id of the form run_<suffix>`,
      next: `pass --run <runId> as printed by pnpm cli list --state-root ${stateRoot}`,
      runId: values.run
    });
  }
  const runId = parseRunId(values.run);
  const pause = createFilePauseController(stateRoot);
  const read = await new EventStore(stateRoot, runId).readAll();
  if (read.events.length === 0) {
    return cliFail(io, {
      command: "pause",
      stage: "lookup",
      message: `Run ${runId} not found under ${stateRoot}`,
      // The house run-not-found remedy, copied rather than imported: `main.ts`
      // imports this module, so reaching back for `missingRun` would be a cycle.
      next: `check --state-root, then pnpm cli list --state-root ${stateRoot} for the run ids that exist there`,
      runId
    });
  }
  if (values.clear === true) {
    // The unlink itself decides what the message may claim; reading the token
    // first would only describe a file the clear never saw.
    const { removed } = await unlinkPauseToken(stateRoot, runId);
    io.stdout(removed ? `Cleared pause for ${runId}\n` : `No pause token for ${runId}; nothing to clear\n`);
    return CLI_EXIT.ok;
  }
  const outcome = await pauseFlowchartRun(
    { stateRoot, router: await createCalibratedCliModelRouter(stateRoot), pause },
    runId,
    values.reason
  );
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  return 0;
}
