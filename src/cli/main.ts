import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFile, readFile } from "node:fs/promises";
import { FakeExecutor } from "../testing/fake-executor.js";
import { PiAgentExecutor } from "../pi-adapter/pi-executor.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { DomainValidationError } from "../domain/errors.js";
import { isAgentRole } from "../domain/roles.js";
import { parseRunId, parseTaskId, isArtifactId, createEpisodeId, parseEpisodeId, parseMessageId, createEventId, type TaskId, type ArtifactId, type EvidenceId, type MessageId, type RunId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { AgentExecutor, AgentExecutionRequest, ExecutionEvent } from "../execution/contract.js";
import { startParentRun, startRun } from "../run/coordinator.js";
import type { ChildTaskInput } from "../run/child-coordinator.js";
import { EventStore } from "../run/event-store.js";
import type { Event } from "../run/events.js";
import { CheckpointStore } from "../run/checkpoint-store.js";
import {
  resumeFlowchartRun,
  startFlowchartRun,
  type FlowchartContinuation,
  type FlowchartRunOutcome
} from "../run/flowchart-run.js";
import { inspectRun } from "../run/inspection.js";
import {
  checkpointCarriesFlowchart,
  eventsLookLikeFlowchartRun,
  materializeCheckpoint,
  replayRun,
  validateCheckpoint,
  type RunCheckpoint
} from "../run/replay.js";
import { resumeSupervisedRun } from "../run/supervisor.js";
import { configurePreferencePersistence, correctPreference, deletePreference, inspectPreferences } from "../preferences/service.js";
import { exportAuthorizedPreferences } from "../preferences/export.js";
import { getMaterializedView } from "../preferences/materialize.js";
import type { PreferenceScope } from "../preferences/types.js";
import { createCliModelRouter } from "./model-catalog.js";
import {
  collectSelectedActionIds,
  parseChildNodeResultsFile,
  parseFlowchartFile
} from "./flowchart-io.js";
import type { RunStatus } from "../domain/status.js";
import { validateApprovalReplyAgainstPlan, type ApprovalReply } from "../domain/flowchart.js";

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

function createExecutor(
  kind: string,
  hooks?: { onInvocation?: (invocation: import("../telemetry/model-invocation.js").ModelInvocation) => void }
): AgentExecutor {
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
      thinkingLevel: requestedLevel as (typeof THINKING_LEVELS)[number],
      ...(hooks?.onInvocation !== undefined ? { onInvocation: hooks.onInvocation } : {})
    });
  }
  throw new DomainValidationError(`Unknown executor "${kind}": expected "fake" or "pi"`);
}

const USAGE = `pi-sparkle — project-development multi-agent runtime

Usage:
  pi-sparkle run --project <path> --objective <text> [--state-root <dir>] [--executor fake|pi] [--children <spec.json>]
  pi-sparkle run --project <path> --objective <text> --flowchart <flowchart.json> [--results <results.json>] [--state-root <dir>]
  pi-sparkle inspect --run <runId> [--state-root <dir>] [--json]
  pi-sparkle resume --run <runId> [--state-root <dir>] [--supervised] [--executor fake-children|pi]
  pi-sparkle resume --run <runId> [--results <results.json>] [--selected <id>] [--selected-ids <csv>] [--text <answer>] [--state-root <dir>]
  pi-sparkle answer --run <runId> --message <msgId> --text <answer> [--state-root <dir>]
  pi-sparkle answer --run <runId> --selected <id> [--selected-ids <csv>] [--text <answer>] [--results <results.json>] [--state-root <dir>]
  pi-sparkle pref list|correct|export|delete [--state-root <dir>] ...
  pi-sparkle help

State root defaults to ~/.pi-sparkle. The default executor is a deterministic
fake; pass --executor pi and set PI_PROVIDER/PI_MODEL/PI_API_KEY to run a real
Pi agent. --children runs the parent as a coordinator over the child tasks in
the spec file ({ "tasks": [{ "id", "role", "objective", ... }] }).
--flowchart starts a flowchart run (startFlowchartRun) from a JSON spec. It is
incompatible with --children and --executor. Optional --results maps nodeId to a fake
ChildNodeResult for the default fake proof path. Resume of a flowchart
checkpoint continues resumeFlowchartRun (optional --results and --selected /
--selected-ids). --supervised still uses M2 DAG resume and refuses flowchart
checkpoints. Answer on a flowchart waiting run requires --selected or
--selected-ids, correlates against the stored approval plan, and resumes;
plain-text --message/--text remains valid for non-flowchart runs.
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

function flowchartExitCode(status: RunStatus): number {
  return status === "COMPLETED" || status === "WAITING_FOR_USER" ? 0 : 1;
}

function printFlowchartOutcome(io: CliIo, outcome: FlowchartRunOutcome, stateRoot: string): void {
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  io.stdout(`  project: ${outcome.project.rootPath}\n`);
  io.stdout(`  events: ${outcome.events.length} -> ${join(stateRoot, "runs", outcome.runId, "events.jsonl")}\n`);
  io.stdout(`  checkpoint: ${join(stateRoot, "runs", outcome.runId, "checkpoint.json")}\n`);
  const nodes = Object.entries(outcome.snapshot.nodes)
    .map(([id, node]) => `${id}=${node.state}`)
    .join(" ");
  io.stdout(`  flowchart: ${outcome.snapshot.status}${nodes === "" ? "" : ` (${nodes})`}\n`);
  const pending = outcome.pendingApproval;
  if (pending !== undefined) {
    io.stdout(
      `  pending approval ${pending.plan.id}: ${pending.plan.items.map((item) => item.id).join(", ")}\n`
    );
  }
}

async function readValidatedCheckpoint(stateRoot: string, runId: RunId): Promise<RunCheckpoint | undefined> {
  const existing = await new CheckpointStore(stateRoot, runId).read();
  if (existing === undefined) return undefined;
  return validateCheckpoint(existing);
}

function refuseInventedFlowchartState(runId: RunId): never {
  throw new DomainValidationError(
    `Flowchart run ${runId} has no durable checkpoint; refusing to invent state`
  );
}

function requireDurableFlowchartCheckpoint(runId: RunId, events: readonly Event[], existing: unknown): void {
  if (eventsLookLikeFlowchartRun(events) && !checkpointCarriesFlowchart(existing)) {
    refuseInventedFlowchartState(runId);
  }
}

function approvalReplyFromCheckpoint(
  checkpoint: RunCheckpoint,
  selectedActionIds: readonly string[]
): ApprovalReply {
  const pending = checkpoint.flowchart?.snapshot.pendingApproval;
  if (pending === undefined) {
    throw new DomainValidationError("flowchart checkpoint has no pending approval to correlate");
  }
  return validateApprovalReplyAgainstPlan(pending.plan, {
    approvalPlanId: pending.plan.id,
    selectedActionIds
  });
}

function flowchartContinuation(opts: {
  selectedActionIds?: readonly string[];
  answer?: string;
  childResults?: FlowchartContinuation["childResults"];
  checkpoint?: RunCheckpoint;
}): FlowchartContinuation {
  let approvalReply: ApprovalReply | undefined;
  if (opts.selectedActionIds !== undefined) {
    if (opts.checkpoint === undefined) {
      throw new DomainValidationError("flowchart approval flags require a flowchart checkpoint");
    }
    approvalReply = approvalReplyFromCheckpoint(opts.checkpoint, opts.selectedActionIds);
  }
  return {
    ...(approvalReply !== undefined ? { approvalReply } : {}),
    ...(opts.answer !== undefined && opts.answer.trim() !== "" ? { answer: opts.answer } : {}),
    ...(opts.childResults !== undefined ? { childResults: opts.childResults } : {})
  };
}

async function runCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      project: { type: "string" },
      objective: { type: "string" },
      "state-root": { type: "string" },
      executor: { type: "string" },
      children: { type: "string" },
      flowchart: { type: "string" },
      results: { type: "string" }
    }
  });
  if (values.project === undefined || values.objective === undefined) {
    io.stderr("run requires --project <path> and --objective <text>\n");
    return 1;
  }
  if (values.flowchart !== undefined && values.children !== undefined) {
    io.stderr("run --flowchart is incompatible with --children\n");
    return 1;
  }
  if (values.flowchart !== undefined && values.executor !== undefined) {
    io.stderr("run --flowchart is incompatible with --executor\n");
    return 1;
  }
  if (values.results !== undefined && values.flowchart === undefined) {
    io.stderr("run --results requires --flowchart\n");
    return 1;
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  if (values.flowchart !== undefined) {
    const flowchart = await parseFlowchartFile(values.flowchart);
    const childResults =
      values.results !== undefined ? await parseChildNodeResultsFile(values.results) : undefined;
    const outcome = await startFlowchartRun(
      { stateRoot, router: createCliModelRouter() },
      {
        projectRoot: values.project,
        flowchart,
        objective: values.objective,
        ...(childResults !== undefined ? { childResults } : {})
      }
    );
    printFlowchartOutcome(io, outcome, stateRoot);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason =
        failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
      io.stderr(`  reason: ${reason}\n`);
    }
    return flowchartExitCode(outcome.status);
  }
  const executorKind =
    values.children !== undefined && (values.executor ?? "fake") === "fake"
      ? "fake-children"
      : (values.executor ?? "fake");
  const executor = createExecutor(executorKind, {
    onInvocation: (invocation) => {
      void appendFile(join(stateRoot, "invocations.jsonl"), `${JSON.stringify(invocation)}\n`);
    }
  });
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
  const checkpoint = await readValidatedCheckpoint(stateRoot, runId);
  if (checkpoint?.flowchart !== undefined) {
    const nodeSummary = Object.entries(checkpoint.flowchart.snapshot.nodes)
      .map(([id, node]) => `${id}=${node.state}`)
      .join(" ");
    io.stdout(
      `  flowchart: ${checkpoint.flowchart.snapshot.status}${nodeSummary === "" ? "" : ` (${nodeSummary})`}\n`
    );
    const pending = checkpoint.flowchart.snapshot.pendingApproval;
    if (pending !== undefined) {
      io.stdout(
        `  pending approval ${pending.plan.id}: ${pending.plan.items.map((item) => item.id).join(", ")}\n`
      );
    }
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
      executor: { type: "string" },
      results: { type: "string" },
      selected: { type: "string", multiple: true },
      "selected-ids": { type: "string" },
      text: { type: "string" }
    }
  });
  if (values.run === undefined) {
    io.stderr("resume requires --run <runId>\n");
    return 1;
  }
  const selectedActionIds = collectSelectedActionIds(values.selected, values["selected-ids"]);
  const wantsFlowchartFlags =
    values.results !== undefined || selectedActionIds !== undefined || values.text !== undefined;
  if (values.supervised === true && wantsFlowchartFlags) {
    io.stderr("resume --supervised does not accept --results, --selected, --selected-ids, or --text\n");
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
  const checkpointStore = new CheckpointStore(stateRoot, runId);
  const existing = await checkpointStore.read();
  requireDurableFlowchartCheckpoint(runId, read.events, existing);
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
  if (checkpointCarriesFlowchart(existing)) {
    const checkpoint = validateCheckpoint(existing);
    const pending = checkpoint.flowchart?.snapshot.pendingApproval;
    if (
      values.text !== undefined &&
      selectedActionIds === undefined &&
      (pending !== undefined || checkpoint.status === "WAITING_FOR_USER")
    ) {
      throw new DomainValidationError(
        "resume --text on a waiting flowchart requires --selected or --selected-ids"
      );
    }
    const childResults =
      values.results !== undefined ? await parseChildNodeResultsFile(values.results) : undefined;
    const outcome = await resumeFlowchartRun(
      { stateRoot, router: createCliModelRouter() },
      runId,
      flowchartContinuation({
        checkpoint,
        ...(selectedActionIds !== undefined ? { selectedActionIds } : {}),
        ...(values.text !== undefined ? { answer: values.text } : {}),
        ...(childResults !== undefined ? { childResults } : {})
      })
    );
    printFlowchartOutcome(io, outcome, stateRoot);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason =
        failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
      io.stderr(`  reason: ${reason}\n`);
    }
    return flowchartExitCode(outcome.status);
  }
  if (wantsFlowchartFlags) {
    throw new DomainValidationError("resume --results/--selected/--text require a flowchart checkpoint");
  }
  const state = replayRun(read.events);
  const checkpoint = validateCheckpoint(materializeCheckpoint(state, nowIso()));
  await checkpointStore.write(checkpoint);
  io.stdout(`Run ${runId}: checkpoint rebuilt (${state.status}, ${read.events.length} events)\n`);
  return 0;
}

const PREFERENCE_SCOPES = ["user", "project", "task-family", "role", "model"] as const;

function isPreferenceScope(value: string): value is PreferenceScope {
  return (PREFERENCE_SCOPES as readonly string[]).includes(value);
}

function parsePreferenceValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(num)) return num;
  return raw;
}

const PREF_USAGE = `pi-sparkle pref — preference inspection and correction

Usage:
  pi-sparkle pref list [--scope user|project|task-family|role|model] [--state-root <dir>]
  pi-sparkle pref correct --scope <scope> --scope-key <key> --key <name> --value <value> [--episode <epId>] [--state-root <dir>]
  pi-sparkle pref export [--scope <scope>] [--state-root <dir>]
  pi-sparkle pref delete --id <preferenceId> [--state-root <dir>]
`;

function bindPreferenceStore(stateRoot: string): void {
  configurePreferencePersistence(join(stateRoot, "preferences.json"));
}

async function answerCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      message: { type: "string" },
      text: { type: "string" },
      "state-root": { type: "string" },
      selected: { type: "string", multiple: true },
      "selected-ids": { type: "string" },
      results: { type: "string" }
    }
  });
  if (values.run === undefined) {
    io.stderr("answer requires --run <runId>\n");
    return 1;
  }
  const selectedActionIds = collectSelectedActionIds(values.selected, values["selected-ids"]);
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const store = new EventStore(stateRoot, runId);
  const read = await store.readAll();
  if (read.events.length === 0) {
    io.stderr(`Run ${runId} not found under ${stateRoot}\n`);
    return 1;
  }
  const checkpoint = await readValidatedCheckpoint(stateRoot, runId);
  requireDurableFlowchartCheckpoint(runId, read.events, checkpoint);
  if (checkpoint?.flowchart !== undefined) {
    const pending = checkpoint.flowchart.snapshot.pendingApproval;
    if (pending === undefined) {
      throw new DomainValidationError(
        "flowchart run has no pending approval; use resume to continue without an answer"
      );
    }
    if (selectedActionIds === undefined) {
      io.stderr(
        "answer on a flowchart waiting run requires --selected <id> (repeatable) or --selected-ids <csv>\n"
      );
      return 1;
    }
    if (values.message !== undefined) {
      const messageId = parseMessageId(values.message);
      if (messageId !== pending.question.id) {
        throw new DomainValidationError(
          `answer --message ${messageId} does not match pending flowchart question ${pending.question.id}`
        );
      }
    }
    const childResults =
      values.results !== undefined ? await parseChildNodeResultsFile(values.results) : undefined;
    const outcome = await resumeFlowchartRun(
      { stateRoot, router: createCliModelRouter() },
      runId,
      flowchartContinuation({
        checkpoint,
        selectedActionIds,
        ...(values.text !== undefined ? { answer: values.text } : {}),
        ...(childResults !== undefined ? { childResults } : {})
      })
    );
    io.stdout(`Recorded answer for ${pending.question.id} on ${runId}\n`);
    printFlowchartOutcome(io, outcome, stateRoot);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason =
        failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
      io.stderr(`  reason: ${reason}\n`);
    }
    return flowchartExitCode(outcome.status);
  }
  if (values.message === undefined || values.text === undefined) {
    io.stderr("answer requires --run <runId> --message <msgId> --text <answer>\n");
    return 1;
  }
  if (selectedActionIds !== undefined || values.results !== undefined) {
    throw new DomainValidationError("answer --selected/--results require a flowchart checkpoint");
  }
  const messageId = parseMessageId(values.message);
  await store.append({
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: nowIso(),
    runId,
    type: "USER_ANSWER",
    actor: "cli",
    payload: { messageId, answer: values.text }
  } as Event);
  io.stdout(`Recorded answer for ${messageId} on ${runId}\n`);
  return 0;
}

async function prefList(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { scope: { type: "string" }, "state-root": { type: "string" } }
  });
  bindPreferenceStore(values["state-root"] ?? defaultStateRoot());
  let scope: PreferenceScope | undefined;
  if (values.scope !== undefined) {
    if (!isPreferenceScope(values.scope)) {
      io.stderr(`Invalid preference scope: ${values.scope}\n`);
      return 1;
    }
    scope = values.scope;
  }
  const result = inspectPreferences(scope);
  io.stdout(`preferences: ${result.count} observation(s)\n`);
  for (const obs of result.observations) {
    io.stdout(
      `  ${obs.id} [${obs.scope}:${obs.scopeKey}] ${obs.key}=${String(obs.value)} explicit=${obs.explicit} recurrence=${obs.recurrenceCount} episode=${obs.evidenceEpisodeId}\n`
    );
  }
  const pairs = new Map<string, { scope: PreferenceScope; scopeKey: string }>();
  for (const obs of result.observations) {
    pairs.set(`${obs.scope}:${obs.scopeKey}`, { scope: obs.scope, scopeKey: obs.scopeKey });
  }
  for (const pair of Array.from(pairs.values())) {
    const materialized = getMaterializedView(pair.scope, pair.scopeKey);
    if (materialized === undefined) continue;
    io.stdout(
      `  effective [${pair.scope}:${pair.scopeKey}] confidence=${materialized.view.confidence} sources=${materialized.view.sourceCount}\n`
    );
    for (const [key, value] of Object.entries(materialized.effectiveKeys)) {
      io.stdout(`    ${key}=${String(value)}\n`);
    }
  }
  return 0;
}

async function prefCorrect(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      scope: { type: "string" },
      "scope-key": { type: "string" },
      key: { type: "string" },
      value: { type: "string" },
      episode: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  bindPreferenceStore(values["state-root"] ?? defaultStateRoot());
  const scope = values.scope;
  const scopeKey = values["scope-key"];
  const key = values.key;
  const value = values.value;
  if (scope === undefined || !isPreferenceScope(scope)) {
    io.stderr(`pref correct requires --scope to be one of ${PREFERENCE_SCOPES.join("|")}\n`);
    return 1;
  }
  if (!scopeKey || !key || value === undefined) {
    io.stderr("pref correct requires --scope-key, --key and --value\n");
    return 1;
  }
  const episodeId = values.episode !== undefined ? parseEpisodeId(values.episode) : createEpisodeId();
  const obs = correctPreference(scope, scopeKey, key, parsePreferenceValue(value), episodeId);
  io.stdout(`recorded explicit preference ${obs.id}\n`);
  return 0;
}

async function prefExport(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { scope: { type: "string" }, "state-root": { type: "string" } }
  });
  bindPreferenceStore(values["state-root"] ?? defaultStateRoot());
  let scopes: PreferenceScope[] | undefined;
  if (values.scope !== undefined) {
    if (!isPreferenceScope(values.scope)) {
      io.stderr(`Invalid preference scope: ${values.scope}\n`);
      return 1;
    }
    scopes = [values.scope];
  }
  const result = exportAuthorizedPreferences(scopes !== undefined ? { scopes } : {});
  io.stdout(`${result.data}\n`);
  return 0;
}

async function prefDelete(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { id: { type: "string" }, "state-root": { type: "string" } }
  });
  bindPreferenceStore(values["state-root"] ?? defaultStateRoot());
  if (values.id === undefined) {
    io.stderr("pref delete requires --id <preferenceId>\n");
    return 1;
  }
  const deleted = deletePreference(values.id);
  io.stdout(deleted ? `tombstoned preference ${values.id}\n` : `preference not found: ${values.id}\n`);
  return deleted ? 0 : 1;
}

async function prefCommand(args: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
      return await prefList(rest, io);
    case "correct":
      return await prefCorrect(rest, io);
    case "export":
      return await prefExport(rest, io);
    case "delete":
      return await prefDelete(rest, io);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      io.stdout(PREF_USAGE);
      return 0;
    default:
      io.stderr(`Unknown pref command: ${sub}\n`);
      io.stderr(PREF_USAGE);
      return 1;
  }
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
      case "answer":
        return await answerCommand(rest, io);
      case "pref":
        return await prefCommand(rest, io);
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
