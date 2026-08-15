import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseRunId } from "../domain/ids.js";
import { createCliModelRouter } from "./model-catalog.js";
import { pauseFlowchartRun } from "../run/flowchart-run.js";
import { createFilePauseController } from "../run/pause-controller.js";
import { EventStore } from "../run/event-store.js";

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
    io.stderr("pause requires --run <runId>\n");
    return 1;
  }
  if (values.clear === true && values.reason !== undefined) {
    io.stderr("pause --clear does not accept --reason\n");
    return 1;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const pause = createFilePauseController(stateRoot);
  const read = await new EventStore(stateRoot, runId).readAll();
  if (read.events.length === 0) {
    io.stderr(`Run ${runId} not found under ${stateRoot}\n`);
    return 1;
  }
  if (values.clear === true) {
    await pause.clearPause(runId);
    io.stdout(`Cleared pause for ${runId}\n`);
    return 0;
  }
  const outcome = await pauseFlowchartRun(
    { stateRoot, router: createCliModelRouter(), pause },
    runId,
    values.reason
  );
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  return 0;
}
