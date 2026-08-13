import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { FakeExecutor } from "../testing/fake-executor.js";
import { PiAgentExecutor } from "../pi-adapter/pi-executor.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { DomainValidationError } from "../domain/errors.js";
import { isAgentRole } from "../domain/roles.js";
import { parseRunId, parseTaskId, isArtifactId, type TaskId, type ArtifactId, type EvidenceId, type MessageId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { AgentExecutor, AgentExecutionRequest, ExecutionEvent } from "../execution/contract.js";
import { startParentRun, startRun } from "../run/coordinator.js";
import type { ChildTaskInput } from "../run/child-coordinator.js";
import { EventStore } from "../run/event-store.js";
import { CheckpointStore } from "../run/checkpoint-store.js";
import { inspectRun } from "../run/inspection.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "../run/replay.js";
import { resumeSupervisedRun } from "../run/supervisor.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Fake executor that speaks protocol v1: emits a terminal TASK_RESULT. */
class ChildFakeExecutor implements AgentExecutor {
  async *execute(
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_fake-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: "SUPERVISOR",
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "fake child completed the task",
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

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
  if (kind === "fake-children") {
    return new ChildFakeExecutor();
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
  pi-sparkle run --project <path> --objective <text> [--state-root <dir>] [--executor fake|pi] [--children <spec.json>]
  pi-sparkle inspect --run <runId> [--state-root <dir>] [--json]
  pi-sparkle resume --run <runId> [--state-root <dir>] [--supervised] [--executor fake-children|pi]
  pi-sparkle help

State root defaults to ~/.pi-sparkle. The default executor is a deterministic
fake; pass --executor pi and set PI_PROVIDER/PI_MODEL/PI_API_KEY to run a real
Pi agent. --children runs the parent as a coordinator over the child tasks in
the spec file ({ "tasks": [{ "id", "role", "objective", ... }] }).
`;

/** Parses a --children spec file into validated ChildTaskInput values. */
async function parseChildSpec(path: string): Promise<ChildTaskInput[]> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DomainValidationError(
      `Invalid child spec ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    throw new DomainValidationError("Child spec must be { \"tasks\": [...] }");
  }
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  const tasks = (parsed as { tasks: unknown[] }).tasks;
  const seen = new Set<TaskId>();
  return tasks.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new DomainValidationError(`Child task ${index} must be an object`);
    }
    const task = entry as Record<string, unknown>;
    const taskId = parseTaskId(task.id);
    if (seen.has(taskId)) throw new DomainValidationError(`Duplicate child task id: ${taskId}`);
    seen.add(taskId);
    if (typeof task.role !== "string" || !isAgentRole(task.role)) {
      throw new DomainValidationError(`Child task ${taskId}: role must be a known AgentRole`);
    }
    if (typeof task.objective !== "string" || task.objective.trim() === "") {
      throw new DomainValidationError(`Child task ${taskId}: objective must be a non-empty string`);
    }
    const acceptanceCriteria = Array.isArray(task.acceptanceCriteria)
      ? task.acceptanceCriteria.map((criterion) => {
          if (typeof criterion !== "object" || criterion === null) {
            throw new DomainValidationError(`Child task ${taskId}: acceptanceCriteria must be objects`);
          }
          const c = criterion as Record<string, unknown>;
          if (typeof c.id !== "string" || c.id === "" || typeof c.description !== "string" || c.description === "") {
            throw new DomainValidationError(`Child task ${taskId}: acceptanceCriteria need {id, description}`);
          }
          return { id: c.id, description: c.description };
        })
      : [];
    const inputArtifactIds = Array.isArray(task.inputArtifactIds)
      ? task.inputArtifactIds.map((id) => {
          if (!isArtifactId(id)) throw new DomainValidationError(`Child task ${taskId}: invalid inputArtifactId`);
          return id;
        })
      : [];
    const limits = task.limits as Record<string, unknown> | undefined;
    const profile = registry.resolve(task.role);
    return {
      taskId,
      role: task.role,
      objective: task.objective,
      profile,
      inputArtifactIds,
      acceptanceCriteria,
      limits: {
        maxAttempts: typeof limits?.maxAttempts === "number" ? limits.maxAttempts : 1,
        timeoutMs: typeof limits?.timeoutMs === "number" ? limits.timeoutMs : 60_000,
        maxWallTimeMs: typeof limits?.maxWallTimeMs === "number" ? limits.maxWallTimeMs : 3_600_000
      }
    };
  });
}

async function runCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      objective: { type: "string" },
      "state-root": { type: "string" },
      executor: { type: "string", default: "fake" },
      children: { type: "string" }
    }
  });
  if (values.project === undefined || values.objective === undefined) {
    io.stderr("run requires --project <path> and --objective <text>\n");
    return 1;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const executorKind = values.children !== undefined && values.executor === "fake" ? "fake-children" : values.executor;
  const executor = createExecutor(executorKind);
  const running =
    values.children !== undefined
      ? startParentRun(
          { stateRoot, executor },
          {
            projectRoot: values.project,
            objective: values.objective,
            children: await parseChildSpec(values.children)
          }
        )
      : startRun(
          { stateRoot, executor },
          { projectRoot: values.project, objective: values.objective }
        );
  const outcome = await running.done;
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  io.stdout(`  project: ${outcome.project.rootPath}\n`);
  io.stdout(`  events: ${outcome.events.length} -> ${join(stateRoot, "runs", outcome.runId, "events.jsonl")}\n`);
  io.stdout(`  checkpoint: ${join(stateRoot, "runs", outcome.runId, "checkpoint.json")}\n`);
  if (values.children !== undefined) {
    const inspection = await inspectRun(stateRoot, outcome.runId);
    io.stdout(`  children: ${inspection.children.length}\n`);
    for (const child of inspection.children) {
      io.stdout(`    ${child.childRunId} (${child.taskId}): ${child.outcome} (${child.attempts} attempt(s))\n`);
      const terminal = child.messages.find((message) => message.type === "TASK_RESULT");
      if (terminal !== undefined && terminal.type === "TASK_RESULT") {
        io.stdout(`      result: ${terminal.outcome} — ${terminal.summary}\n`);
        if (terminal.artifactIds.length > 0) {
          io.stdout(`      artifacts: ${terminal.artifactIds.join(", ")}\n`);
        }
        if (terminal.evidenceIds.length > 0) {
          io.stdout(`      evidence: ${terminal.evidenceIds.join(", ")}\n`);
        }
      }
    }
  }
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
  const inspection = await inspectRun(stateRoot, runId);
  if (inspection.children.length > 0) {
    io.stdout(`  children: ${inspection.children.length}\n`);
    for (const child of inspection.children) {
      io.stdout(
        `    ${child.childRunId} (${child.taskId}): ${child.outcome} (${child.attempts} attempt(s), ${child.messages.length} message(s))\n`
      );
      const terminal = child.messages.find((message) => message.type === "TASK_RESULT");
      if (terminal !== undefined && terminal.type === "TASK_RESULT") {
        io.stdout(`      result: ${terminal.outcome} — ${terminal.summary}\n`);
        if (terminal.artifactIds.length > 0) {
          io.stdout(`      artifacts: ${terminal.artifactIds.join(", ")}\n`);
        }
        if (terminal.evidenceIds.length > 0) {
          io.stdout(`      evidence: ${terminal.evidenceIds.join(", ")}\n`);
        }
      }
    }
  }
  for (const question of inspection.pendingQuestions) {
    io.stdout(`  question ${question.id}: ${question.question}\n`);
  }
  for (const answer of inspection.answers) {
    io.stdout(`  answer ${answer.messageId}: ${answer.answer}\n`);
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
      "state-root": { type: "string" },
      supervised: { type: "boolean", default: false },
      executor: { type: "string" }
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
  if (values.supervised === true) {
    const executorKind = values.executor ?? "fake-children";
    const running = resumeSupervisedRun(
      {
        stateRoot,
        executor: createExecutor(executorKind),
        registry: createAgentProfileRegistry(defaultAgentProfiles())
      },
      runId
    );
    const outcome = await running.done;
    io.stdout(`Run ${runId}: resumed (${outcome.status})\n`);
    io.stdout(`  events: ${outcome.events.length} -> ${join(stateRoot, "runs", runId, "events.jsonl")}\n`);
    io.stdout(`  checkpoint: ${join(stateRoot, "runs", runId, "checkpoint.json")}\n`);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason = failed !== undefined ? failed.payload.reason : "unknown";
      io.stderr(`  reason: ${reason}\n`);
      return 1;
    }
    return outcome.status === "COMPLETED" ? 0 : 1;
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
