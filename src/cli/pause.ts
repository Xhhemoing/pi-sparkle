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

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

export async function pauseCommand(args: string[], io: PauseIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      reason: { type: "string" },
      clear: { type: "boolean", default: false },
      "state-root": { type: "string" }
    }
  });
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
      next: `check --state-root and --run ${runId}`,
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
