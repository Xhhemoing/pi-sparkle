import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseRunId } from "../domain/ids.js";
import { createCalibratedCliModelRouter } from "./model-catalog.js";
import { pauseFlowchartRun } from "../run/flowchart-run.js";
import { createFilePauseController } from "../run/pause-controller.js";
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
  const stateRoot = values["state-root"] ?? defaultStateRoot();
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
    await pause.clearPause(runId);
    io.stdout(`Cleared pause for ${runId}\n`);
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
