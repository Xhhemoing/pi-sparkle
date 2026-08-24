#!/usr/bin/env node
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runtimeRoot, adaptationRoot } from "../privacy/state-layout.js";
import { deleteRunRecords, deleteEpisodeRecords } from "../privacy/deletion.js";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { FakeExecutor } from "../testing/fake-executor.js";
import { createConfiguredPiExecutor } from "../pi-adapter/runtime.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../agents/registry.js";
import { DomainValidationError } from "../domain/errors.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import { parseModelRef, tryParseModelRef, formatModelRef } from "../config/model-ref.js";
import { isAgentRole } from "../domain/roles.js";
import { parseRunId, parseTaskId, isArtifactId, createEpisodeId, parseEpisodeId, parseMessageId, createEventId, type TaskId, type ArtifactId, type EvidenceId, type MessageId, type RunId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { AgentExecutor, AgentExecutionRequest, ExecutionEvent } from "../execution/contract.js";
import { startRun } from "../run/coordinator.js";
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
import { episodeIdFromEvents } from "../run/episode-bind.js";
import { EpisodeStore } from "../run/episode-store.js";
import { adaptCommand } from "./adapt.js";
import { episodeCommand } from "./episode.js";
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
import { createCalibratedCliModelRouter, buildLiveCatalogConfig } from "./model-catalog.js";
import { createModelRouter } from "../supervisor/model-router.js";
import { DEFAULT_FAST_MODEL_ID, DEFAULT_PRIMARY_MODEL_ID } from "../routing/primary-catalog.js";
import { calibrateCatalogFromState } from "../routing/cost-calibration.js";
import { createInvocationSink } from "../telemetry/invocation-log.js";
import { compileChildrenToFlowchart } from "../graph/compile-children.js";
import { assignTasks } from "../routing/assign.js";
import { liveCascadePlanFromAssignment } from "../routing/live-cascade.js";
import { type PublicPriorSnapshot } from "../routing/public-prior.js";
import { loadPublicPriorSnapshot } from "../routing/public-prior-store.js";
import { loadLearnedRouting, type LearnedRoutingPolicy } from "../learning/learned-routing.js";
import { runAutoAdaptLoop } from "../learning/auto-loop.js";
import { startTrackedRun } from "../track/loop.js";
import {
  collectSelectedActionIds,
  parseChildNodeResultsFile,
  parseFlowchartFile
} from "./flowchart-io.js";
import { commitsCommand } from "./commits.js";
import { pauseCommand } from "./pause.js";
import { injectCommand } from "./inject.js";
import { authCommand } from "./auth.js";
import { modelsCommand } from "./models.js";
import { doctorCommand } from "./doctor.js";
import { migrateLegacyCommand } from "./migrate-legacy.js";
import { piCompatCommand } from "./pi-compat.js";
import { CLI_EXIT, cliFail } from "./errors.js";
import { createFilePauseController } from "../run/pause-controller.js";
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

// Mirrors SparkleThinkingLevel on the adapter boundary (assignability is
// checked where the level is passed to createConfiguredPiExecutor). Google
// models silently clamp "xhigh"/"max" down; that is provider behaviour, not
// something this CLI rewrites.
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type CliThinkingLevel = (typeof THINKING_LEVELS)[number];

function isThinkingLevel(value: string): value is CliThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * Resolves the thinking level for one run: --thinking wins over
 * PI_THINKING_LEVEL, which wins over "off". Per-run only — Pi's TUI /thinking
 * selector is session-scoped and persisted there, and this flag never writes it.
 */
export function resolveThinkingLevel(
  flag: string | undefined,
  env: string | undefined = process.env.PI_THINKING_LEVEL
): CliThinkingLevel {
  const requested = flag ?? env ?? "off";
  if (!isThinkingLevel(requested)) {
    const source = flag !== undefined ? "--thinking" : "PI_THINKING_LEVEL";
    throw new DomainValidationError(`${source} must be one of ${THINKING_LEVELS.join(", ")}`);
  }
  return requested;
}

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

async function createExecutor(
  kind: string,
  stateRoot: string,
  hooks?: { onInvocation?: (invocation: import("../telemetry/model-invocation.js").ModelInvocation) => void },
  /** Explicit --primary-model wins over ambient env vars and providers.json. */
  modelOverride?: { readonly providerId: string; readonly modelId: string },
  /** Already-resolved --thinking level; falls back to PI_THINKING_LEVEL here. */
  thinkingLevel?: CliThinkingLevel
): Promise<AgentExecutor> {
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
    const config = await loadProvidersConfig(stateRoot);
    const envProvider = process.env.PI_PROVIDER;
    const envModel = process.env.PI_MODEL;
    const primary = config.primary !== undefined ? parseModelRef(config.primary) : undefined;
    // Precedence: explicit --primary-model flag > env vars > providers.json.
    const providerId = modelOverride?.providerId ?? envProvider ?? primary?.providerId;
    const modelId = modelOverride?.modelId ?? envModel ?? primary?.modelId;
    if (providerId === undefined || modelId === undefined) {
      throw new DomainValidationError(
        "--executor pi requires an enabled primary model (pi-sparkle models set-default) or PI_PROVIDER and PI_MODEL"
      );
    }
    const requestedLevel = thinkingLevel ?? resolveThinkingLevel(undefined);
    const fast = config.fast !== undefined ? parseModelRef(config.fast) : undefined;
    const envRef = envProvider !== undefined && envModel !== undefined
      ? { providerId: envProvider, modelId: envModel }
      : undefined;
    const effectiveRef = modelOverride ?? envRef;
    const premiumAlias = primary && modelOverride === undefined ? primary : (effectiveRef ?? primary);
    const cheapAlias = fast ?? premiumAlias;
    return await createConfiguredPiExecutor({
      stateRoot,
      providerId,
      modelId,
      thinkingLevel: requestedLevel,
      customProviders: config.customProviders,
      ...(process.env.PI_API_KEY !== undefined ? { apiKey: process.env.PI_API_KEY } : {}),
      ...(cheapAlias !== undefined || premiumAlias !== undefined
        ? {
            aliases: {
              ...(cheapAlias !== undefined ? { cheap: cheapAlias } : {}),
              ...(premiumAlias !== undefined ? { premium: premiumAlias } : {})
            }
          }
        : {}),
      ...(hooks?.onInvocation !== undefined ? { onInvocation: hooks.onInvocation } : {})
    });
  }
  throw new DomainValidationError(`Unknown executor "${kind}": expected "fake" or "pi"`);
}

/** Flowchart --executor fake must emit TASK_RESULT, same as --children. */
function flowchartExecutorKind(kind: string): string {
  return kind === "fake" ? "fake-children" : kind;
}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "../../package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
    throw new Error("package.json version is missing");
  }
  return parsed.version;
}

const USAGE = `pi-sparkle — project-development multi-agent runtime (developer preview)

Usage:
  pi-sparkle --version
  pi-sparkle doctor [--state-root <dir>] [--project <path>] [--agents-dir <dir>] [--json]
  pi-sparkle pi-compat [--json] [--offline]
  pi-sparkle pi-compat --online [--json]
  pi-sparkle run --project <path> --objective <text> [--state-root <dir>] [--executor fake|pi] [--thinking <level>] [--children <spec.json>] [--public-prior <file.json>] [--require-public-prior]
  pi-sparkle run --project <path> --objective <text> --track [--primary-model <id>] [--fast-model <id>] [--thinking <level>] [--public-prior <file.json>] [--require-public-prior] [--assume-defaults] [--answers <file.json>] [--executor fake|pi]
  pi-sparkle run --project <path> --objective <text> --flowchart <flowchart.json> [--results <results.json>] [--executor fake|pi] [--thinking <level>] [--state-root <dir>]
  pi-sparkle inspect --run <runId> [--state-root <dir>] [--json | --summary-json]
  pi-sparkle inspect --episode <epId> [--state-root <dir>] [--json]
  pi-sparkle episode events --episode <epId> [--state-root <dir>] [--json]
  pi-sparkle episode close --episode <epId> --status <COMPLETED|FAILED|ABANDONED> [--state-root <dir>]
  pi-sparkle resume --run <runId> [--state-root <dir>] [--supervised] [--executor fake-children|pi]
  pi-sparkle resume --run <runId> [--results <results.json>] [--selected <id>] [--selected-ids <csv>] [--text <answer>] [--unpause] [--state-root <dir>]
  pi-sparkle answer --run <runId> --message <msgId> --text <answer> [--state-root <dir>]
  pi-sparkle answer --run <runId> --selected <id> [--selected-ids <csv>] [--text <answer>] [--results <results.json>] [--state-root <dir>]
  pi-sparkle pause --run <runId> [--reason <text>] [--state-root]
  pi-sparkle pause --clear --run <runId> [--state-root]
  pi-sparkle inject --run <runId> --type fact|override|skip [--key] [--value] [--node] [--confidence] [--actor] [--state-root]
  pi-sparkle auth status|login|logout [--state-root <dir>] ...
  pi-sparkle models list|enable|disable|set-default [--state-root <dir>] ...
  pi-sparkle pref list|correct|export|delete [--state-root <dir>] ...
  pi-sparkle delete --run <runId> | --episode <epId> [--state-root <dir>]
  pi-sparkle migrate-legacy [--state-root <dir>] [--apply]
  pi-sparkle adapt status [--state-root <dir>]
  pi-sparkle adapt learn --run <runId> [--state-root <dir>]
  pi-sparkle adapt auto [--run <runId>] [--project <path>] [--state-root <dir>]
  pi-sparkle adapt promote --candidate <id> --expected <ver> --content-file <path> --review-file <path> --approve [--eval-file <path>]
  pi-sparkle commits preview --run <runId> [--state-root <dir>] [--json] [--nodes <id,id>]
  pi-sparkle commits apply --run <runId> [--state-root <dir>] [--repo <path>] [--file <edited.json>] [--sign] [--nodes <id,id>]
  pi-sparkle help

State root defaults to ~/.pi-sparkle. The default executor is a deterministic
fake. --children without --executor pi uses the child fake executor so the
README example completes locally. Pass --executor pi after pi-sparkle models
set-default (and/or PI_PROVIDER/PI_MODEL). doctor is a developer-preview
preflight (Node, pnpm, state-root, providers, Pi dispatch contract, legacy-layout).
--json prints the frozen DoctorJsonReport contract (stdout is one object; not a
production capability). Per-provider env keys (OPENAI_API_KEY, ...) and
pi-sparkle auth login replace a single PI_API_KEY; PI_API_KEY remains a
compatibility override for the default provider only. --thinking
<off|minimal|low|medium|high|xhigh|max> sets the reasoning effort for this run
only and wins over PI_THINKING_LEVEL (default off); it is the headless
counterpart of Pi's session-scoped /thinking TUI selector and never persists.
Google models silently clamp xhigh/max. --children runs the
parent as a coordinator over the child tasks in
the spec file ({ "tasks": [{ "id", "role", "objective", ... }] }).
--track clarifies the objective (using recorded habits), sends it through a
primary-owned split (planner on --primary-model, then scout → implement →
review → test), compiles that plan into the flowchart supervisor, grounds each
child with a bounded context packet and predecessor artifacts, assigns catalog
models, and executes a bounded cluster (peer mail, spawn depth ≤ 2 / 4 per parent).
predecessor artifacts, assigns other catalog models from --primary-model
(default premium / PI_MODEL) plus an optional cheaper --fast-model, executes
with peer mail, scores three-line tracking on child TASK_RESULT facts when
verification is PASSED or FAILED, then runs the automatic adaptation loop
(collect feedback, diagnose model/project issues, propose a routing-policy
candidate; never CAS-promotes. SPARKLE_AUTO_ADAPT=0 still collects). --public-prior loads a hashed frozen
snapshot for covered families; a missing file or hash failure prints one stderr
line and keeps today's no-prior path unless --require-public-prior.
--flowchart starts a flowchart run (startFlowchartRun) from a JSON spec. It is
incompatible with --children and --track. Optional --results maps nodeId to a fake
ChildNodeResult and wins over --executor for those nodes. Optional --executor
fake|pi runs remaining RUNNING nodes (--executor fake uses the protocol child
fake, same as --children). Without --results or --executor, leased nodes stall.
Resume of a flowchart checkpoint continues resumeFlowchartRun (optional --results,
--executor, and --selected / --selected-ids). --supervised still uses M2 DAG
resume and refuses flowchart checkpoints. Answer on a flowchart waiting run
requires --selected or --selected-ids, correlates against the stored approval
plan, and resumes; plain-text --message/--text remains valid for non-flowchart
runs.
commits preview reads a completed flowchart run's ledger and emits conventional
commit messages with evidence references; commits apply writes them with git
commit --allow-empty (optional --sign / --file for an edited JSON proposal).
pause writes a PauseController token and PAUSE_REQUESTED; resume --unpause clears it
and continues. inject records a typed fact/override/skip against DecisionPolicy
without executing user strings.
inspect --episode prints the latest bound episode snapshot (inspect --run also
prints the episode id when a run is attached). inspect --run --json stays a pure
event stream (one event per line); --summary-json prints one INSPECT_SUMMARY
object with the status and the evidence the latest stall/block asked for.
episode close/events provide the acceptance-gated closure and event views.
adapt collects user and subagent
feedback automatically after --track/--children; routing-policy candidates stay
proposed until adapt promote --approve. Other kinds stay proposal-first. CAS promotion and
rollback remain available on the CLI.
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
    const dependsOn = Array.isArray(task.dependsOn)
      ? task.dependsOn.map((id) => parseTaskId(id))
      : undefined;
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
      },
      ...(dependsOn !== undefined ? { dependsOn } : {})
    };
  });
}

async function smartChildPlan(
  children: ChildTaskInput[],
  primaryModelId: string,
  fastModelId: string,
  stateRoot: string,
  learned?: LearnedRoutingPolicy,
  prior?: PublicPriorSnapshot
): Promise<{ children: ChildTaskInput[]; assignments: ReturnType<typeof assignTasks> }> {
  const catalog = await calibrateCatalogFromState(
    await buildLiveCatalogConfig(stateRoot, { primaryModelId, fastModelId }),
    stateRoot
  );
  const assignable = children.flatMap((child) =>
    isAgentRole(child.role)
      ? [{ taskId: child.taskId, role: child.role, objective: child.objective }]
      : []
  );
  const assignments = assignTasks({
    tasks: assignable,
    catalog,
    ...(learned !== undefined ? { learned } : {}),
    ...(prior !== undefined ? { prior } : {})
  });
  const routed = children.map((child) => {
    const assignment = assignments.find((item) => item.taskId === child.taskId);
    if (assignment === undefined) return child;
    return {
      ...child,
      assignedModel: assignment.decision.model,
      cascade: liveCascadePlanFromAssignment(assignment, catalog)
    };
  });
  return { children: routed, assignments };
}

/** Hashed CLI load: fail-soft on DomainValidationError / missing file unless required. */
async function loadOptionalPublicPrior(
  path: string | undefined,
  require: boolean,
  io: CliIo
): Promise<{ snapshot: PublicPriorSnapshot; hash: string } | undefined> {
  if (path === undefined) return undefined;
  try {
    return await loadPublicPriorSnapshot(path);
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!(error instanceof DomainValidationError) && !missing) {
      throw error;
    }
    if (require) {
      if (error instanceof DomainValidationError) throw error;
      throw new DomainValidationError(`public prior file is unreadable: ${path}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`warning: public prior not applied: ${message}\n`);
    return undefined;
  }
}

function flowchartExitCode(status: RunStatus): number {
  return status === "COMPLETED" || status === "WAITING_FOR_USER" || status === "PAUSED" ? CLI_EXIT.ok : CLI_EXIT.error;
}

function reportFailedRun(
  io: CliIo,
  command: string,
  stage: string,
  runId: RunId,
  stateRoot: string,
  reason: string
): number {
  io.stderr(`  reason: ${reason}\n`);
  return cliFail(io, {
    command,
    stage,
    message: `run failed: ${reason}`,
    next: `pnpm cli inspect --run ${runId} --state-root ${stateRoot}`,
    runId
  });
}

function missingRun(io: CliIo, command: string, runId: RunId, stateRoot: string): number {
  return cliFail(io, {
    command,
    stage: "lookup",
    message: `Run ${runId} not found under ${stateRoot}`,
    next: `check --state-root and pnpm cli inspect --run ${runId}`,
    runId
  });
}

function printFlowchartOutcome(io: CliIo, outcome: FlowchartRunOutcome, stateRoot: string): void {
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  io.stdout(`  project: ${outcome.project.rootPath}\n`);
  io.stdout(`  events: ${outcome.events.length} -> ${join(runtimeRoot(stateRoot), "runs", outcome.runId, "events.jsonl")}\n`);
  io.stdout(`  checkpoint: ${join(runtimeRoot(stateRoot), "runs", outcome.runId, "checkpoint.json")}\n`);
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
  unpause?: boolean;
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
    ...(opts.childResults !== undefined ? { childResults: opts.childResults } : {}),
    ...(opts.unpause === true ? { unpause: true } : {})
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
      results: { type: "string" },
      track: { type: "boolean", default: false },
      "primary-model": { type: "string" },
      "fast-model": { type: "string" },
      "assume-defaults": { type: "boolean", default: false },
      answers: { type: "string" },
      "public-prior": { type: "string" },
      "require-public-prior": { type: "boolean", default: false },
      thinking: { type: "string" }
    }
  });
  const projectRoot = values.project;
  const objective = values.objective;
  if (typeof projectRoot !== "string" || typeof objective !== "string") {
    return cliFail(io, {
      command: "run",
      stage: "parse-args",
      message: "run requires --project <path> and --objective <text>",
      next: "pass both --project <path> and --objective <text>"
    });
  }
  if (values.flowchart !== undefined && values.children !== undefined) {
    return cliFail(io, {
      command: "run",
      stage: "parse-args",
      message: "run --flowchart is incompatible with --children",
      next: "use --flowchart or --children, not both"
    });
  }
  if (values.flowchart !== undefined && values.track === true) {
    return cliFail(io, {
      command: "run",
      stage: "parse-args",
      message: "run --flowchart is incompatible with --track",
      next: "use --flowchart or --track, not both"
    });
  }
  if (values.results !== undefined && values.flowchart === undefined) {
    return cliFail(io, {
      command: "run",
      stage: "parse-args",
      message: "run --results requires --flowchart",
      next: "pass --flowchart <file.json> with --results"
    });
  }
  if (values.thinking !== undefined && !isThinkingLevel(values.thinking)) {
    return cliFail(io, {
      command: "run",
      stage: "parse-args",
      message: `--thinking must be one of ${THINKING_LEVELS.join(", ")}`,
      next: `pass --thinking ${THINKING_LEVELS.join("|")}`
    });
  }
  const thinkingLevel = resolveThinkingLevel(values.thinking);
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  // One telemetry sink for every executor this command builds. It writes each
  // invocation through the log's exclusive lock, retries a lock timeout a few
  // times so a concurrent `delete --run` rewrite does not silently erase the
  // window, and never rejects: a lost row warns, it does not fail the run.
  const invocationSink = createInvocationSink(stateRoot, {
    onDrop: (reason) => {
      io.stderr(`warning: invocation telemetry dropped: ${reason}\n`);
    }
  });
  if (values.flowchart !== undefined) {
    const liveCatalog = await buildLiveCatalogConfig(stateRoot);
    const flowchart = await parseFlowchartFile(
      values.flowchart,
      liveCatalog.models.map((model) => model.id)
    );
    const childResults =
      values.results !== undefined ? await parseChildNodeResultsFile(values.results) : undefined;
    const executor =
      values.executor !== undefined
        ? await createExecutor(
            flowchartExecutorKind(values.executor),
            stateRoot,
            {
              onInvocation: (invocation) => {
                void invocationSink(invocation);
              }
            },
            undefined,
            thinkingLevel
          )
        : undefined;
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: await createCalibratedCliModelRouter(stateRoot),
        pause: createFilePauseController(stateRoot),
        ...(executor !== undefined ? { executor } : {})
      },
      {
        projectRoot,
        flowchart,
        objective,
        ...(childResults !== undefined ? { childResults } : {})
      }
    );
    printFlowchartOutcome(io, outcome, stateRoot);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason =
        failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
      return reportFailedRun(io, "run", "flowchart", outcome.runId, stateRoot, reason);
    }
    return flowchartExitCode(outcome.status);
  }
  const executorKind =
    values.children !== undefined && (values.executor ?? "fake") === "fake"
      ? "fake-children"
      : values.track === true && (values.executor ?? "fake") === "fake"
        ? "fake-children"
      : (values.executor ?? "fake");
  const providers = await loadProvidersConfig(stateRoot);
  // An explicit --primary-model that names a concrete provider/model pair
  // pins the executor to that channel. Alias values (premium/cheap) are not
  // touched here — they resolve downstream against the routing catalog.
  const flaggedPrimary =
    values["primary-model"] !== undefined ? tryParseModelRef(values["primary-model"]) : undefined;
  const executor = await createExecutor(
    executorKind,
    stateRoot,
    {
      onInvocation: (invocation) => {
        void invocationSink(invocation);
      }
    },
    flaggedPrimary,
    thinkingLevel
  );
  bindPreferenceStore(stateRoot);
  const envCatalogId =
    process.env.PI_PROVIDER !== undefined && process.env.PI_MODEL !== undefined
      ? formatModelRef(process.env.PI_PROVIDER, process.env.PI_MODEL)
      : undefined;
  const primaryModelId =
    values["primary-model"] ??
    providers.primary ??
    envCatalogId ??
    (executorKind === "pi" ? process.env.PI_MODEL : undefined) ??
    DEFAULT_PRIMARY_MODEL_ID;
  const fastModelId =
    values["fast-model"] ?? process.env.PI_FAST_MODEL ?? providers.fast ?? DEFAULT_FAST_MODEL_ID;
  const loadedPrior = await loadOptionalPublicPrior(
    values["public-prior"],
    values["require-public-prior"] === true,
    io
  );
  const publicPrior = loadedPrior?.snapshot;

  if (values.track === true) {
    if (values.children !== undefined) {
      return cliFail(io, {
        command: "run",
        stage: "parse-args",
        message: "run --track is incompatible with --children (track generates the cluster plan)",
        next: "omit --children when using --track"
      });
    }
    let answers: Record<string, string> | undefined;
    if (values.answers !== undefined) {
      const raw = JSON.parse(await readFile(values.answers, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new DomainValidationError("answers file must be a JSON object of question id to answer");
      }
      answers = Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, String(value)])
      );
    }
    const outcome = await startTrackedRun({
      projectRoot,
      objective,
      stateRoot,
      executor,
      primaryModelId,
      fastModelId,
      assumeDefaults: values["assume-defaults"] === true,
      ...(answers !== undefined ? { answers } : {}),
      ...(publicPrior !== undefined ? { prior: publicPrior } : {})
    });
    io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
    io.stdout(`  project: ${outcome.project.rootPath}\n`);
    if (outcome.questions.length > 0) {
      io.stdout("  clarifying questions:\n");
      for (const question of outcome.questions) {
        io.stdout(`    ${question.id}: ${question.question}\n`);
      }
      io.stdout("  re-run with --assume-defaults or --answers <file.json>\n");
    }
    if (outcome.assignments.length > 0) {
      io.stdout(`  routing (primary=${primaryModelId}, fast=${fastModelId}):\n`);
      if (loadedPrior !== undefined) {
        io.stdout(`  public prior: ${loadedPrior.snapshot.snapshotId} hash=${loadedPrior.hash}\n`);
      }
      for (const assignment of outcome.assignments) {
        io.stdout(
          `    ${assignment.taskId} (${assignment.role}, ${assignment.analysis.complexity}) -> ${assignment.decision.model}\n`
        );
      }
    }
    if (outcome.learn !== undefined) {
      io.stdout(`  learn: ${outcome.learn.reason}${outcome.learn.candidateId !== undefined ? ` (${outcome.learn.candidateId})` : ""}\n`);
    }
    io.stdout(`  events: ${outcome.events.length} -> ${join(runtimeRoot(stateRoot), "runs", outcome.runId, "events.jsonl")}\n`);
    return outcome.status === "COMPLETED" || outcome.status === "WAITING_FOR_USER" ? 0 : 1;
  }

  const childrenSpec = values.children;
  const learned = await loadLearnedRouting(stateRoot, projectRoot);
  if (childrenSpec !== undefined) {
    const planned = await smartChildPlan(
      await parseChildSpec(childrenSpec),
      primaryModelId,
      fastModelId,
      stateRoot,
      learned,
      publicPrior
    );
    if (planned.assignments.length > 0) {
      io.stdout(`  routing (primary=${primaryModelId}, fast=${fastModelId}):\n`);
      for (const assignment of planned.assignments) {
        io.stdout(
          `    ${assignment.taskId} (${assignment.role}, ${assignment.analysis.complexity}) -> ${assignment.decision.model}\n`
        );
      }
    }
    const catalog = await calibrateCatalogFromState(
      await buildLiveCatalogConfig(stateRoot, { primaryModelId, fastModelId }),
      stateRoot
    );
    const catalogIds = catalog.models.map((model) => model.id);
    const preferredFast = catalogIds.includes(fastModelId) ? fastModelId : catalogIds[0]!;
    const flowchart = compileChildrenToFlowchart(
      planned.children.flatMap((child) => {
        if (!isAgentRole(child.role)) return [];
        return [
          {
            taskId: child.taskId,
            role: child.role,
            objective: child.objective,
            ...(child.dependsOn !== undefined ? { dependsOn: child.dependsOn } : {}),
            allowedModels: catalogIds,
            ...(child.assignedModel !== undefined ? { preferredModel: child.assignedModel } : {})
          }
        ];
      }),
      { flowchartId: "children", allowedModels: catalogIds, preferredModel: preferredFast }
    );
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: createModelRouter(catalog),
        executor,
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        cluster: true,
        pause: createFilePauseController(stateRoot)
      },
      {
        projectRoot,
        flowchart,
        objective,
        childTasks: planned.children,
        assignments: planned.assignments
      }
    );
    printFlowchartOutcome(io, outcome, stateRoot);
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
    const episodeId = episodeIdFromEvents(outcome.events);
    try {
      const adapt = await runAutoAdaptLoop({
        stateRoot,
        projectRoot,
        projectId: outcome.project.id,
        primaryModelId,
        events: outcome.events,
        assignments: planned.assignments,
        ...(episodeId !== undefined ? { episodeId } : {})
      });
      io.stdout(
        `  adapt: ${adapt.reason}${adapt.promoted ? " (promoted)" : ""}${adapt.candidateId !== undefined ? ` (${adapt.candidateId})` : ""}\n`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      io.stderr(`  adapt skipped: ${message}\n`);
    }
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason =
        failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
      return reportFailedRun(io, "run", "children", outcome.runId, stateRoot, reason);
    }
    return flowchartExitCode(outcome.status);
  }
  const running = startRun({ stateRoot, executor }, { projectRoot, objective });
  const outcome = await running.done;
  io.stdout(`Run ${outcome.runId}: ${outcome.status}\n`);
  io.stdout(`  project: ${outcome.project.rootPath}\n`);
  io.stdout(`  events: ${outcome.events.length} -> ${join(runtimeRoot(stateRoot), "runs", outcome.runId, "events.jsonl")}\n`);
  io.stdout(`  checkpoint: ${join(runtimeRoot(stateRoot), "runs", outcome.runId, "checkpoint.json")}\n`);
  if (outcome.status === "FAILED") {
    const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
    const reason = failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
    return reportFailedRun(io, "run", "execute", outcome.runId, stateRoot, reason);
  }
  return outcome.status === "COMPLETED" ? CLI_EXIT.ok : CLI_EXIT.error;
}

function warnTruncatedJsonl(
  io: CliIo,
  recovery: { incompleteLine?: string; lineNumber?: number },
  label: string
): void {
  if (recovery.incompleteLine === undefined) return;
  const at = recovery.lineNumber !== undefined ? ` at line ${recovery.lineNumber}` : "";
  io.stderr(`warning: ignored truncated ${label}${at}\n`);
}

async function inspectEpisode(stateRoot: string, rawId: string, json: boolean, io: CliIo): Promise<number> {
  const episodeId = parseEpisodeId(rawId);
  const store = new EpisodeStore(stateRoot, episodeId);
  const read = await store.readAll();
  const snapshot = read.episodes.at(-1);
  if (snapshot === undefined) {
    return cliFail(io, {
      command: "inspect",
      stage: "lookup",
      message: `Episode ${episodeId} not found under ${stateRoot}`,
      next: "pass a bound --episode id from inspect --run"
    });
  }
  warnTruncatedJsonl(io, read.recovery, "episode log");
  if (json) {
    io.stdout(`${JSON.stringify(snapshot)}\n`);
    return 0;
  }
  io.stdout(`Episode ${snapshot.id}: ${snapshot.status}\n`);
  io.stdout(`  project: ${snapshot.projectId}\n`);
  io.stdout(`  objective: ${snapshot.objective}\n`);
  io.stdout(`  runs: ${snapshot.runIds.length === 0 ? "(none)" : snapshot.runIds.join(", ")}\n`);
  io.stdout(`  started: ${snapshot.startedAt}\n`);
  if (snapshot.closedAt !== undefined) {
    io.stdout(`  closed: ${snapshot.closedAt}\n`);
  }
  if (snapshot.acceptance.length > 0) {
    io.stdout(`  acceptance: ${snapshot.acceptance.map((item) => item.id).join(", ")}\n`);
  }
  if (snapshot.evidenceRefs.length > 0) {
    io.stdout(`  evidence: ${snapshot.evidenceRefs.join(", ")}\n`);
  }
  if (snapshot.outcomeId !== undefined) {
    io.stdout(`  outcome: ${snapshot.outcomeId}\n`);
  }
  return 0;
}

async function inspectCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      episode: { type: "string" },
      "state-root": { type: "string" },
      json: { type: "boolean", default: false },
      "summary-json": { type: "boolean", default: false }
    }
  });
  if (values.run !== undefined && values.episode !== undefined) {
    return cliFail(io, {
      command: "inspect",
      stage: "parse-args",
      message: "inspect accepts either --run or --episode, not both",
      next: "pass only --run or only --episode"
    });
  }
  const summaryJson = values["summary-json"] === true;
  if (summaryJson && values.json === true) {
    return cliFail(io, {
      command: "inspect",
      stage: "parse-args",
      message: "inspect accepts either --json or --summary-json, not both",
      next: "pass --json for the event stream or --summary-json for one summary object"
    });
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  if (values.episode !== undefined) {
    if (summaryJson) {
      return cliFail(io, {
        command: "inspect",
        stage: "parse-args",
        message: "inspect --summary-json is only available with --run",
        next: "pass --run <runId> --summary-json, or --episode --json for the snapshot"
      });
    }
    return inspectEpisode(stateRoot, values.episode, values.json === true, io);
  }
  if (values.run === undefined) {
    return cliFail(io, {
      command: "inspect",
      stage: "parse-args",
      message: "inspect requires --run <runId> or --episode <epId>",
      next: "pass --run <runId> or --episode <epId>"
    });
  }
  const runId = parseRunId(values.run);
  const store = new EventStore(stateRoot, runId);
  const read = await store.readAll();
  if (read.events.length === 0) {
    return missingRun(io, "inspect", runId, stateRoot);
  }
  warnTruncatedJsonl(io, read.recovery, "event log");
  if (values.json) {
    for (const event of read.events) {
      io.stdout(`${JSON.stringify(event)}\n`);
    }
    return 0;
  }
  if (summaryJson) {
    const summary = await inspectRun(stateRoot, runId);
    // One object, not a domain Event: --json stays a pure event NDJSON stream.
    io.stdout(
      `${JSON.stringify({
        type: "INSPECT_SUMMARY",
        runId,
        status: summary.status,
        requiredEvidence: summary.requiredEvidence
      })}\n`
    );
    return 0;
  }
  const state = replayRun(read.events);
  io.stdout(`Run ${runId}: ${state.status} (${read.events.length} events)\n`);
  if (state.run !== undefined) {
    io.stdout(`  project: ${state.run.projectId}\n`);
  }
  const boundEpisodeId = episodeIdFromEvents(read.events);
  if (boundEpisodeId !== undefined) {
    io.stdout(`  episode: ${boundEpisodeId}\n`);
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
  if (inspection.requiredEvidence.length > 0) {
    io.stdout(`  required evidence (${inspection.requiredEvidence.length}):\n`);
    for (const item of inspection.requiredEvidence) {
      io.stdout(`    - ${item}\n`);
    }
  }
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
      text: { type: "string" },
      unpause: { type: "boolean", default: false }
    }
  });
  if (values.run === undefined) {
    return cliFail(io, {
      command: "resume",
      stage: "parse-args",
      message: "resume requires --run <runId>",
      next: "pass --run <runId> from a prior run or inspect"
    });
  }
  const selectedActionIds = collectSelectedActionIds(values.selected, values["selected-ids"]);
  const wantsFlowchartFlags =
    values.results !== undefined || selectedActionIds !== undefined || values.text !== undefined;
  if (values.supervised === true && (wantsFlowchartFlags || values.unpause === true)) {
    return cliFail(io, {
      command: "resume",
      stage: "parse-args",
      message: "resume --supervised does not accept --results, --selected, --selected-ids, --text, or --unpause",
      next: "omit flowchart flags when using --supervised"
    });
  }
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  // Same telemetry sink `runCommand` builds: a resumed run makes real model
  // calls, so without this its invocations never reach `invocations.jsonl` and
  // cost calibration under-counts every run that was resumed rather than
  // completed in one go. Shared across both executors this command may build.
  const invocationSink = createInvocationSink(stateRoot, {
    onDrop: (reason) => {
      io.stderr(`warning: invocation telemetry dropped: ${reason}\n`);
    }
  });
  const runId = parseRunId(values.run);
  const eventStore = new EventStore(stateRoot, runId);
  const read = await eventStore.readAll();
  if (read.events.length === 0) {
    return missingRun(io, "resume", runId, stateRoot);
  }
  const checkpointStore = new CheckpointStore(stateRoot, runId);
  const existing = await checkpointStore.read();
  requireDurableFlowchartCheckpoint(runId, read.events, existing);
  if (values.supervised === true) {
    const executorKind = values.executor ?? "fake-children";
    const running = resumeSupervisedRun(
      {
        stateRoot,
        executor: await createExecutor(executorKind, stateRoot, {
          onInvocation: (invocation) => {
            void invocationSink(invocation);
          }
        }),
        registry: createAgentProfileRegistry(defaultAgentProfiles())
      },
      runId
    );
    const outcome = await running.done;
    io.stdout(`Run ${runId}: resumed (${outcome.status})\n`);
    io.stdout(`  events: ${outcome.events.length} -> ${join(runtimeRoot(stateRoot), "runs", runId, "events.jsonl")}\n`);
    io.stdout(`  checkpoint: ${join(runtimeRoot(stateRoot), "runs", runId, "checkpoint.json")}\n`);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason = failed !== undefined ? failed.payload.reason : "unknown";
      return reportFailedRun(io, "resume", "supervised", runId, stateRoot, String(reason));
    }
    return outcome.status === "COMPLETED" ? CLI_EXIT.ok : CLI_EXIT.error;
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
    const pause = createFilePauseController(stateRoot);
    const token = await pause.token(runId);
    if ((token.paused || replayRun(read.events).status === "PAUSED") && values.unpause !== true) {
      throw new DomainValidationError("run is paused; pass --unpause to continue");
    }
    const executor =
      values.executor !== undefined
        ? await createExecutor(flowchartExecutorKind(values.executor), stateRoot, {
            onInvocation: (invocation) => {
              void invocationSink(invocation);
            }
          })
        : undefined;
    const outcome = await resumeFlowchartRun(
      {
        stateRoot,
        router: await createCalibratedCliModelRouter(stateRoot),
        pause,
        ...(executor !== undefined ? { executor } : {})
      },
      runId,
      flowchartContinuation({
        checkpoint,
        ...(selectedActionIds !== undefined ? { selectedActionIds } : {}),
        ...(values.text !== undefined ? { answer: values.text } : {}),
        ...(childResults !== undefined ? { childResults } : {}),
        ...(values.unpause === true ? { unpause: true } : {})
      })
    );
    printFlowchartOutcome(io, outcome, stateRoot);
    if (outcome.status === "FAILED") {
      const failed = outcome.events.find((event) => event.type === "RUN_FAILED");
      const reason =
        failed !== undefined ? String((failed.payload as { reason?: string }).reason ?? "unknown") : "unknown";
      return reportFailedRun(io, "resume", "flowchart", outcome.runId, stateRoot, reason);
    }
    return flowchartExitCode(outcome.status);
  }
  if (wantsFlowchartFlags || values.unpause === true) {
    throw new DomainValidationError("resume --results/--selected/--text/--unpause require a flowchart checkpoint");
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
  configurePreferencePersistence(join(adaptationRoot(stateRoot), "preferences.json"));
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
    return cliFail(io, {
      command: "answer",
      stage: "parse-args",
      message: "answer requires --run <runId>",
      next: "pass --run <runId> for the waiting run"
    });
  }
  const selectedActionIds = collectSelectedActionIds(values.selected, values["selected-ids"]);
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const runId = parseRunId(values.run);
  const store = new EventStore(stateRoot, runId);
  const read = await store.readAll();
  if (read.events.length === 0) {
    return missingRun(io, "answer", runId, stateRoot);
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
      return cliFail(io, {
        command: "answer",
        stage: "parse-args",
        message: "answer on a flowchart waiting run requires --selected <id> (repeatable) or --selected-ids <csv>",
        next: "pass --selected <id> from the pending approval plan",
        runId
      });
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
    const pause = createFilePauseController(stateRoot);
    const token = await pause.token(runId);
    if (token.paused || replayRun(read.events).status === "PAUSED") {
      throw new DomainValidationError("run is paused; pass --unpause to continue");
    }
    const outcome = await resumeFlowchartRun(
      { stateRoot, router: await createCalibratedCliModelRouter(stateRoot), pause },
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
      return reportFailedRun(io, "answer", "flowchart", outcome.runId, stateRoot, reason);
    }
    return flowchartExitCode(outcome.status);
  }
  if (values.message === undefined || values.text === undefined) {
    return cliFail(io, {
      command: "answer",
      stage: "parse-args",
      message: "answer requires --run <runId> --message <msgId> --text <answer>",
      next: "pass --message <msgId> and --text <answer> for a non-flowchart question",
      runId
    });
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

const DELETE_USAGE = `Usage:
  pi-sparkle delete --run <runId> [--state-root <dir>]
  pi-sparkle delete --episode <epId> [--state-root <dir>]

Deletes the target's runtime records. Deleting an episode also cascades into
the adaptation plane: feedback bound to that episode is tombstoned and its
free-text body is stripped (see docs/data-dictionary.md). Exactly one of
--run / --episode must be given.
`;

export async function deleteCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      episode: { type: "string" },
      "state-root": { type: "string" }
    }
  });
  const stateRoot = values["state-root"] ?? defaultStateRoot();
  const targetCount = [values.run !== undefined, values.episode !== undefined].filter(Boolean).length;
  if (targetCount !== 1) {
    io.stderr("delete requires exactly one of --run <runId> or --episode <epId>\n");
    io.stderr(DELETE_USAGE);
    return 1;
  }
  const result =
    values.run !== undefined
      ? await deleteRunRecords(stateRoot, parseRunId(values.run))
      : await deleteEpisodeRecords(stateRoot, parseEpisodeId(values.episode as string));
  for (const runId of result.residualEpisodeTextRunIds) io.stdout(`residual episode text: run ${runId} still holds a copy (append-only log; delete --run ${runId} to remove it)\n`);
  if (result.removedPaths.length === 0 && result.cascadedFeedbackTombstones.length === 0) {
    io.stderr(`${result.target}: nothing found under ${stateRoot}; refusing to report success\n`);
    return 1;
  }
  for (const path of result.removedPaths) {
    io.stdout(`removed: ${path}\n`);
  }
  for (const id of result.cascadedFeedbackTombstones) {
    io.stdout(`tombstoned feedback: ${id}\n`);
  }
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
      case "answer":
        return await answerCommand(rest, io);
      case "auth":
        return await authCommand(rest, io);
      case "models":
        return await modelsCommand(rest, io);
      case "pref":
        return await prefCommand(rest, io);
      case "adapt":
        return await adaptCommand(rest, io);
      case "episode":
        return await episodeCommand(rest, io);
      case "delete":
        return await deleteCommand(rest, io);
      case "migrate-legacy":
        return await migrateLegacyCommand(rest, io);
      case "commits":
        return await commitsCommand(rest, io);
      case "pause":
        return await pauseCommand(rest, io);
      case "inject":
        return await injectCommand(rest, io);
      case "doctor":
        return await doctorCommand(rest, io);
      case "pi-compat":
        return await piCompatCommand(rest, io);
      case "version":
      case "--version":
      case "-V":
        io.stdout(`${packageVersion()}\n`);
        return 0;
      case "help":
      case "--help":
      case "-h":
        io.stdout(USAGE);
        return 0;
      case undefined:
        io.stdout(USAGE);
        return 0;
      default:
        io.stderr(USAGE);
        return cliFail(io, {
          command: "pi-sparkle",
          stage: "parse-args",
          message: `Unknown command: ${command}`,
          next: "run pi-sparkle help"
        });
    }
  } catch (error) {
    return cliFail(io, {
      command: command ?? "pi-sparkle",
      stage: error instanceof DomainValidationError ? "validation" : "execute",
      message: error instanceof Error ? error.message : String(error),
      next: "fix the reported error, then retry; use pi-sparkle doctor for preflight"
    });
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
