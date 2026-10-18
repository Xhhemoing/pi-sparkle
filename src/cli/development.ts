import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DomainValidationError } from "../domain/errors.js";
import { DevelopmentController } from "../development/controller.js";
import { WorkItemStore } from "../development/work-item-store.js";
import { createWorkQueue, type CreateWorkQueueInput } from "../development/work-items.js";
import { runtimeRoot } from "../persist/state-layout.js";
import { loadProvidersConfig } from "../config/providers-config.js";
import { parseModelRef } from "../config/model-ref.js";
import { createConfiguredPiExecutor } from "../pi-adapter/runtime.js";
import type { NativeWriteExecutorFactory, NativeWriteTool } from "../native/write-session.js";
import { createInvocationSink } from "../telemetry/invocation-log.js";
import { ProtocolChildExecutor } from "../testing/fake-executor.js";
import type { AgentExecutor } from "../execution/contract.js";
import { resolveCliPiExecutorOptions } from "./executor-factory.js";

export interface DevelopmentIo { stdout(text: string): void; stderr(text: string): void; }
export interface DevelopmentCommandDependencies {
  /** Host injection for offline integration tests; no CLI flag can supply code. */
  readonly createPiExecutor?: (input: Parameters<typeof createConfiguredPiExecutor>[0]) => Promise<AgentExecutor>;
}
export const DEVELOPMENT_USAGE = `pi-sparkle develop — explicit host work queue and candidate development

Usage:
  pi-sparkle develop init --file <host-definitions.json> --queue <id> [--state-root <dir>] [--json]
  pi-sparkle develop status|next|candidates --queue <id> --project <path> [--state-root <dir>] [--json]
  pi-sparkle develop run --queue <id> --project <path> --executor fake|pi [--model <provider/model>] [--max-attempts <1..5>] [--max-wall-time-ms <1..1800000>] [--state-root <dir>] [--json]
  pi-sparkle develop batch --queue <id> --project <path> --executor fake|pi --max-items <1..8> [--model <provider/model>] [--max-total-wall-time-ms <1..1800000>] [--max-attempts <1..5>] [--max-wall-time-ms <1..1800000>] [--state-root <dir>] [--json]
  pi-sparkle develop review --queue <id> --project <path> --action <id> [--state-root <dir>] [--json]
  pi-sparkle develop accept|release --queue <id> --project <path> --item <id> [--state-root <dir>] [--json]
  pi-sparkle develop reconcile --queue <id> --project <path> --action <id> [--state-root <dir>] [--json]

init accepts {id, authorityRef, items} host definitions (at most 1 MiB); id must match --queue. It never executes a checker.
run defaults to 3 attempts / 600000 ms. fake: no LLM and no writes; host checks can only confirm existing contents. pi uses configured credentials and scoped read/write tools.
batch runs serially with one fixed source revision; defaults are 3 attempts and 600000 ms per item and total. Its deadline is cooperative; cleanup can exceed it. It never accepts or applies candidates.
review reads bound historical evidence only: no checker/model execution, no current candidate re-verification and no source application.
accept is explicit host review, not source application. candidates lists recorded checkpoints, not a fresh verification.
reconcile completes only an already completed effect receipt; unknown/running effects need actual-state reconciliation and are never replayed.
release invalidates only the task claim. Stop its worker first; unknown effects remain unresolved and are never automatically reused.
`;
const COMMANDS = ["init", "status", "next", "candidates", "run", "batch", "review", "accept", "reconcile", "release"] as const;
const MAX_INPUT_BYTES = 1_048_576;
function fail(message: string): never { throw new DomainValidationError(`develop: ${message}`); }
function safeId(value: string | undefined, flag: string): string {
  if (value === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) fail(`${flag} must be a safe id of 1..64 letters, digits, underscores or hyphens`);
  return value;
}
function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === "" || value.includes("\0")) fail(`${flag} is required`);
  return value;
}
function boundedInteger(raw: string | undefined, fallback: number, maximum: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail(`${flag} must be an integer from 1 to ${maximum}`);
  return value;
}
async function readDefinitions(file: string): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_INPUT_BYTES) fail("host definitions must be a regular file of at most 1 MiB");
    const buffer = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    const after = await handle.stat();
    if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("host definitions changed while reading");
    return JSON.parse(buffer.subarray(0, used).toString("utf8")) as unknown;
  } finally { await handle.close(); }
}

/** Preserve the host-provided closures and schemas; never create broader tools. */
export function developmentPiTools(tools: readonly NativeWriteTool[]): NonNullable<Parameters<typeof createConfiguredPiExecutor>[0]["tools"]> {
  return ["sparkle_read_file", "sparkle_write_file", "sparkle_list_files", "sparkle_search_files", "sparkle_patch_file"].map((name) => {
    const tool = tools.find((entry) => entry.name === name);
    if (tool === undefined || !("parameters" in tool) || tool.parameters === null || typeof tool.parameters !== "object" ||
        !("label" in tool) || typeof tool.label !== "string" || !("description" in tool) || typeof tool.description !== "string") {
      fail(`native scoped tool descriptor unavailable: ${name}`);
    }
    return tool as NonNullable<Parameters<typeof createConfiguredPiExecutor>[0]["tools"]>[number];
  });
}

function record(value: string | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
function modeOf(owner: unknown): string {
  return typeof owner === "string" && owner.startsWith("cli:fake:") ? "fake"
    : typeof owner === "string" && owner.startsWith("cli:pi:") ? "pi" : "unknown";
}

export async function developmentCommand(args: string[], io: DevelopmentIo, dependencies: DevelopmentCommandDependencies = {}): Promise<number> {
  const [command, ...rest] = args;
  const executes = command === "run" || command === "batch";
  const json = args.includes("--json");
  const emit = (queueId: string | undefined, value: Record<string, unknown>): void => {
    const output = { type: command === "batch" ? "DEVELOPMENT_BATCH_RESULT" : "DEVELOPMENT_RESULT", command, ...(queueId === undefined ? {} : { queueId }), ...value };
    io.stdout(`${JSON.stringify(output, null, json ? undefined : 2)}\n`);
  };
  try {
    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
      if (rest.length > 0) fail("help takes no additional arguments");
      io.stdout(DEVELOPMENT_USAGE); return 0;
    }
    if (!COMMANDS.some((known) => known === command)) fail(`unknown command ${command}`);
    const { values, tokens } = parseArgs({ args: rest, strict: true, allowPositionals: false, tokens: true, options: {
      queue: { type: "string" }, project: { type: "string" }, "state-root": { type: "string" }, file: { type: "string" },
      executor: { type: "string" }, model: { type: "string" }, "max-attempts": { type: "string" }, "max-wall-time-ms": { type: "string" },
      "max-items": { type: "string" }, "max-total-wall-time-ms": { type: "string" },
      item: { type: "string" }, action: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" }
    } });
    const seen = new Set<string>();
    for (const token of tokens) if (token.kind === "option") {
      if (seen.has(token.name)) fail(`duplicate flag --${token.name}`);
      seen.add(token.name);
    }
    const allowed = new Set(["queue", "state-root", "json", "help", ...(command === "init" ? ["file"] : ["project"]),
      ...(executes ? ["executor", "model", "max-attempts", "max-wall-time-ms"] : []),
      ...(command === "batch" ? ["max-items", "max-total-wall-time-ms"] : []),
      ...(["accept", "release"].includes(command) ? ["item"] : []), ...(["reconcile", "review"].includes(command) ? ["action"] : [])]);
    for (const name of seen) if (!allowed.has(name)) fail(`--${name} is not supported by ${command}`);
    if (values.help) { io.stdout(DEVELOPMENT_USAGE); return 0; }
    const queueId = safeId(values.queue, "--queue");
    const stateRoot = resolve(values["state-root"] === undefined ? join(homedir(), ".pi-sparkle") : required(values["state-root"], "--state-root"));
    const queuePath = join(runtimeRoot(stateRoot), "development", queueId, "queue.json");
    if (command === "init") {
      const queue = createWorkQueue(await readDefinitions(required(values.file, "--file")) as CreateWorkQueueInput);
      if (queue.id !== queueId) fail("host definitions id must match --queue");
      await new WorkItemStore(queuePath).create(queue);
      emit(queueId, { status: "initialized", queuePath, queue }); return 0;
    }
    const sourceRepo = resolve(required(values.project, "--project"));
    const itemId = ["accept", "release"].includes(command) ? safeId(values.item, "--item") : undefined;
    const actionId = ["reconcile", "review"].includes(command) ? required(values.action, "--action") : undefined;
    if (actionId !== undefined && !/^action_v1_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(actionId)) fail("--action must be an action_v1 id");
    const mode = values.executor;
    const maxAttempts = boundedInteger(values["max-attempts"], 3, 5, "--max-attempts");
    const maxWallTimeMs = boundedInteger(values["max-wall-time-ms"], 600_000, 1_800_000, "--max-wall-time-ms");
    const maxItems = command === "batch" ? boundedInteger(required(values["max-items"], "--max-items"), 1, 8, "--max-items") : undefined;
    const maxTotalWallTimeMs = command === "batch" ? boundedInteger(values["max-total-wall-time-ms"], 600_000, 1_800_000, "--max-total-wall-time-ms") : undefined;
    let executorFactory: NativeWriteExecutorFactory | undefined;
    const pendingInvocations: Promise<void>[] = [];
    if (executes) {
      if (mode !== "fake" && mode !== "pi") fail(`${command} requires --executor fake or pi`);
      const model = values.model === undefined ? undefined : parseModelRef(values.model);
      if (mode === "fake") {
        if (model !== undefined) fail("--model requires --executor pi");
        executorFactory = () => new ProtocolChildExecutor();
      } else {
        const sink = createInvocationSink(stateRoot, { onDrop: (reason) => io.stderr(`warning: ${reason}\n`) });
        const options = resolveCliPiExecutorOptions({ stateRoot, config: await loadProvidersConfig(stateRoot), env: process.env,
          ...(model === undefined ? {} : { executorModelOverride: model }), hooks: { onInvocation: (invocation) => { pendingInvocations.push(sink(invocation)); } } });
        executorFactory = (context) => (dependencies.createPiExecutor ?? createConfiguredPiExecutor)({ ...options, tools: developmentPiTools(context.tools) });
      }
    }
    const controller = new DevelopmentController({ sourceRepo, queuePath, stateRoot, owner: `cli:${mode ?? "host"}:${process.pid}`,
      ...(executorFactory === undefined ? {} : { executorFactory }) });
    if (executes) {
      if (mode === "fake") io.stderr("mode=fake: no LLM and no writes; host checks verify existing candidate contents only.\n");
      else io.stderr("mode=pi: configured model execution with scoped candidate read/write tools.\n");
      const abort = new AbortController();
      const onSignal = () => abort.abort();
      process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
      try {
        if (command === "batch") {
          const { runDevelopmentBatch } = await import("../development/batch.js");
          const result = await runDevelopmentBatch(controller, { maxItems: maxItems!, maxWallTimeMs: maxTotalWallTimeMs!,
            maxAttempts, perItemWallTimeMs: maxWallTimeMs, signal: abort.signal });
          emit(queueId, { mode, ...result });
          return result.stopReason === "max-items" || result.stopReason === "no-ready-task" ? 0 : 1;
        }
        const result = await controller.runNext({ maxAttempts, maxWallTimeMs, signal: abort.signal });
        emit(queueId, { mode, limits: { maxAttempts, maxWallTimeMs }, ...result });
        return ["blocked", "needs-reconciliation"].includes(result.status) ? 1 : 0;
      } finally {
        process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
        await Promise.all(pendingInvocations);
      }
    }
    if (command === "status") { emit(queueId, { status: "snapshot", ...await controller.status() }); return 0; }
    if (command === "next") { emit(queueId, { status: "advisory", item: await controller.next() ?? null }); return 0; }
    if (command === "review") {
      const { reviewDevelopmentCandidate } = await import("../development/candidate-review.js");
      const report = await reviewDevelopmentCandidate({ sourceRepo, queuePath, stateRoot, actionId: actionId! });
      emit(queueId, { ...report }); return 0;
    }
    if (command === "candidates") {
      const { actions, queue } = await controller.status();
      const candidates = actions.filter((action) => action.kind === "candidate-write").flatMap((action) => {
        const saved = record(action.resultCanonicalJson), input = record(action.inputCanonicalJson);
        if (typeof saved.candidatePath !== "string") return [];
        const item = queue.items.find((entry) => entry.definition.id === saved.itemId);
        return [{ actionId: action.actionId, actionState: action.state, itemId: saved.itemId, candidatePath: saved.candidatePath,
          ...(typeof saved.runId === "string" ? { runId: saved.runId } : {}), mode: modeOf(input.owner ?? item?.claim?.owner),
          ...(item === undefined ? {} : { itemStatus: item.status }), checkpointOnly: true }];
      });
      emit(queueId, { status: "recorded-candidates", candidates }); return 0;
    }
    if (command === "accept") { await controller.accept(itemId!); emit(queueId, { status: "accepted", itemId, sourceApplied: false }); return 0; }
    if (command === "reconcile") {
      const result = await controller.reconcile(actionId!); emit(queueId, { ...result });
      return ["blocked", "needs-reconciliation"].includes(result.status) ? 1 : 0;
    }
    const queue = await controller.store.load();
    const item = queue.items.find((entry) => entry.definition.id === itemId);
    if (item?.claim === undefined) fail("item has no releasable claim");
    await controller.store.release(itemId!, item.claim.token);
    io.stderr("warning: task claim released only; stop its worker first. Unknown effects remain unresolved; no effect was replayed or automatically reused.\n");
    emit(queueId, { status: "released", itemId, actionsReconciled: false }); return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) emit(undefined, { status: "error", message });
    io.stderr(`develop: ${message}\n`); return 1;
  }
}
