import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FakeExecutor } from "../testing/fake-executor.js";
import { PiAgentExecutor } from "../pi-adapter/pi-executor.js";
import type { AgentExecutor } from "../execution/contract.js";
import { startRun } from "../run/coordinator.js";
import { EventStore } from "../run/event-store.js";
import { CheckpointStore } from "../run/checkpoint-store.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "../run/replay.js";
import { parseRunId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { DomainValidationError } from "../domain/errors.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function defaultStateRoot(): string {
  return join(homedir(), ".pi-sparkle");
}

function createExecutor(kind: string): AgentExecutor {
  if (kind === "fake") {
    return new FakeExecutor([
      { type: "TEXT_DELTA", text: "fake worker: objective received" },
      { type: "TOOL_STARTED", toolCallId: "fake-1", toolName: "read_file" },
      { type: "TOOL_FINISHED", toolCallId: "fake-1", isError: false, summary: "read project files" },
      { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }
    ]);
  }
  if (kind === "pi") {
    const providerId = process.env.PI_PROVIDER;
    const modelId = process.env.PI_MODEL;
    if (!providerId || !modelId) {
      throw new DomainValidationError(
        "--executor pi requires PI_PROVIDER and PI_MODEL environment variables (and PI_API_KEY for most providers)"
      );
    }
    const requestedLevel = process.env.PI_THINKING_LEVEL ?? "off";
    if (!(THINKING_LEVELS as readonly string[]).includes(requestedLevel)) {
      throw new DomainValidationError(`PI_THINKING_LEVEL must be one of ${THINKING_LEVELS.join(", ")}`);
    }
    return new PiAgentExecutor({
      providerId,
      modelId,
      ...(process.env.PI_API_KEY !== undefined ? { apiKey: process.env.PI_API_KEY } : {}),
      thinkingLevel: requestedLevel as (typeof THINKING_LEVELS)[number]
    });
  }
  throw new DomainValidationError(`Unknown executor "${kind}": expected "fake" or "pi"`);
}

const USAGE = `pi-sparkle — project-development multi-agent runtime

Usage:
  pi-sparkle run --project <path> --objective <text> [--state-root <dir>] [--executor fake|pi]
  pi-sparkle inspect --run <runId> [--state-root <dir>] [--json]
  pi-sparkle resume --run <runId> [--state-root <dir>]
  pi-sparkle help

State root defaults to ~/.pi-sparkle. The default executor is a deterministic
fake; pass --executor pi and set PI_PROVIDER/PI_MODEL/PI_API_KEY to run a real
Pi agent.
`;

async function runCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      objective: { type: "string" },
      "state-root": { type: "string" },
      executor: { type: "string", default: "fake" }
    }
  });
  if (values.project === undefined || values.objective === undefined) {
    io.stderr("run requires --project <path> and --objective <text>\n");
    return 1;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const executor = createExecutor(values.executor);
  const running = startRun(
    { stateRoot, executor },
    { projectRoot: values.project, objective: values.objective }
  );
  const outcome = await running.done;
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  io.stdout(`  project: ${outcome.project.rootPath}\n`);
  io.stdout(`  events: ${outcome.events.length} -> ${join(stateRoot, "runs", outcome.runId, "events.jsonl")}\n`);
  io.stdout(`  checkpoint: ${join(stateRoot, "runs", outcome.runId, "checkpoint.json")}\n`);
  if (outcome.status === "FAILED") {
    const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
    const reason = failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
    io.stderr(`  reason: ${reason}\n`);
    return 1;
  }
  return outcome.status === "COMPLETED" ? 0 : 1;
}

async function inspectCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      "state-root": { type: "string" },
      json: { type: "boolean", default: false }
    }
  });
  if (values.run === undefined) {
    io.stderr("inspect requires --run <runId>\n");
    return 1;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const store = new EventStore(stateRoot, runId);
  const read = await store.readAll();
  if (read.events.length === 0) {
    io.stderr(`Run ${runId} not found under ${stateRoot}\n`);
    return 1;
  }
  if (values.json) {
    for (const event of read.events) {
      io.stdout(`${JSON.stringify(event)}\n`);
    }
    return 0;
  }
  const state = replayRun(read.events);
  io.stdout(`Run ${runId}: ${state.status} (${read.events.length} events)\n`);
  if (state.run !== undefined) {
    io.stdout(`  project: ${state.run.projectId}\n`);
  }
  if (state.agentOutcomes.length > 0) {
    for (const record of state.agentOutcomes) {
      io.stdout(`  agent ${record.agentInstanceId}: ${record.outcome}\n`);
    }
  }
  if (state.anomalies.length > 0) {
    for (const anomaly of state.anomalies) {
      io.stderr(`  anomaly: ${anomaly}\n`);
    }
  }
  return 0;
}

async function resumeCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  if (values.run === undefined) {
    io.stderr("resume requires --run <runId>\n");
    return 1;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const eventStore = new EventStore(stateRoot, runId);
  const read = await eventStore.readAll();
  if (read.events.length === 0) {
    io.stderr(`Run ${runId} not found under ${stateRoot}\n`);
    return 1;
  }
  const state = replayRun(read.events);
  const checkpoint = validateCheckpoint(materializeCheckpoint(state, nowIso()));
  await new CheckpointStore(stateRoot, runId).write(checkpoint);
  io.stdout(`Run ${runId}: checkpoint rebuilt (${state.status}, ${read.events.length} events)\n`);
  return 0;
}

export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "run":
        return await runCommand(rest, io);
      case "inspect":
        return await inspectCommand(rest, io);
      case "resume":
        return await resumeCommand(rest, io);
      case "help":
      case "--help":
      case "-h":
        io.stdout(USAGE);
        return 0;
      case undefined:
        io.stdout(USAGE);
        return 0;
      default:
        io.stderr(`Unknown command: ${command}\n`);
        io.stderr(USAGE);
        return 1;
    }
  } catch (error) {
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

// Entry point when run as a script.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A closed downstream pipe (e.g. `pi-sparkle inspect --json | head`) should
  // end the process quietly instead of crashing with an unhandled EPIPE.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
