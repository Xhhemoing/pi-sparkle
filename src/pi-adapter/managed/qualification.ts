import { isDeepStrictEqual } from "node:util";
import { lstat, mkdir, mkdtemp, open } from "node:fs/promises";
import path from "node:path";
import { DomainValidationError } from "../../domain/errors.js";
import { runAuthorizedCommand, type AuthorizedCommandRunResult } from "../../execution/command-runner.js";
import { physicalDirectoryWithoutLinks } from "../../native/physical-directory.js";
import type { ManagedCandidate, ManagedCandidateVersions } from "./candidate.js";
import type { ExecutionObservation, ProviderUsageObservation, QualificationObservation, UsageObservation } from "./qualification-scenarios.js";

const WORKER = "pi-adapter/managed/qualification-worker.js";
const MAX_OUTPUT = 64 * 1024;
const MAX_TIMEOUT = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface ManagedQualificationOptions {
  readonly managerRoot: string;
  readonly candidate: ManagedCandidate;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface ManagedQualificationRecord {
  readonly managerRoot: string;
  readonly candidateRoot: string;
  readonly generationId: string;
  readonly versions: ManagedCandidateVersions;
  readonly observations: readonly QualificationObservation[];
}
export type ManagedQualificationResult =
  | { readonly status: "qualified"; readonly record: ManagedQualificationRecord }
  | { readonly status: "failed"; readonly reason: string; readonly command?: AuthorizedCommandRunResult };

// An in-memory issuance capability, never recreated from JSON or caller fields.
// Persisted manager state later remains cooperative local host state, not an
// authentication mechanism against hostile candidate code/local file writers.
const issued = new WeakMap<object, ManagedQualificationRecord>();
function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== "object") return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}
/** Only exact locally issued success objects qualify. Returned data is detached
 * and deeply frozen, so callers cannot mutate the private approval authority. */
export function lookupIssuedManagedQualification(result: unknown, managerRoot: string): ManagedQualificationRecord {
  const record = result !== null && typeof result === "object" ? issued.get(result) : undefined;
  if (record === undefined) throw new DomainValidationError("managed qualification result was not issued by this process");
  if (physicalDirectoryWithoutLinks(managerRoot) !== record.managerRoot) throw new DomainValidationError("managed qualification belongs to another manager");
  return frozenCopy(record);
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DomainValidationError("managed qualification expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  equal(Object.keys(value).sort(), [...expected].sort(), label);
}
function equal(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) throw new DomainValidationError(`managed qualification observation mismatch: ${label}`);
}
async function readBoundedObject(file: string): Promise<Record<string, unknown>> {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_OUTPUT) throw new DomainValidationError("managed candidate manifest must be a bounded regular file");
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_OUTPUT || stat.dev !== entry.dev || stat.ino !== entry.ino) throw new DomainValidationError("managed candidate manifest changed");
    const buffer = Buffer.alloc(MAX_OUTPUT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_OUTPUT) throw new DomainValidationError("managed candidate manifest too large");
    return object(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
  } finally { await handle.close(); }
}
async function candidateIdentity(options: ManagedQualificationOptions): Promise<{ managerRoot: string; candidateRoot: string; versions: ManagedCandidateVersions }> {
  const managerRoot = physicalDirectoryWithoutLinks(options.managerRoot);
  const generations = physicalDirectoryWithoutLinks(path.join(managerRoot, "generations"));
  const candidate = options.candidate;
  if (!UUID.test(candidate.generationId)) throw new DomainValidationError("invalid managed generation ID");
  const candidateRoot = physicalDirectoryWithoutLinks(path.join(generations, candidate.generationId));
  equal(physicalDirectoryWithoutLinks(candidate.root), candidateRoot, "candidate root");
  equal(physicalDirectoryWithoutLinks(candidate.appRoot), physicalDirectoryWithoutLinks(path.join(candidateRoot, "app")), "candidate app root");
  const versions = { core: candidate.versions.core, ai: candidate.versions.ai };
  for (const version of Object.values(versions)) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new DomainValidationError("managed versions must be literal");
  }
  const manifest = await readBoundedObject(path.join(candidateRoot, "candidate.json"));
  equal(manifest.generationId, candidate.generationId, "manifest generation");
  equal(manifest.versions, versions, "manifest versions");
  return { managerRoot, candidateRoot, versions };
}
function usageFromContext(value: unknown, output: string): UsageObservation {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384 || !value.endsWith("Call probe_tool, then finish.") && !value.includes("toolResult:probe_tool\ncomplete")) {
    throw new DomainValidationError("invalid fixed faux context observation");
  }
  return { inputTokens: Math.ceil(value.length / 4), outputTokens: Math.ceil(output.length / 4) };
}
function validateExecution(raw: unknown, scenario: ExecutionObservation["scenario"]): void {
  const value = object(raw);
  equal(value.scenario, scenario, "scenario");
  // Retain readable pre-SDK records, but correlate each format's complete trace.
  const sdk = Object.hasOwn(value, "providerUsage");
  keys(value, ["scenario", "streamEntries", "streamAborted", "providerDispatches", "dispatchAborted", "providerHandlers", "modelLookups", "retries", "sleeps", "pendingResponses", "toolStarts", "toolCompletions", "toolErrors", "contexts", "turns", "invocations", "invocation", "taskResults", "executionFinished", "costEvents", "eventTypes", ...(sdk ? ["providerUsage"] : []), ...(scenario === "blocked-tool-cancel" ? ["held", "released"] : [])], "scenario fields");
  const pre = scenario === "preabort", cancelled = scenario === "blocked-tool-cancel", unpriced = scenario === "unpriced-cap";
  const calls = pre ? 0 : unpriced ? 2 : 1;
  equal(value.streamEntries, cancelled && !sdk ? 2 : calls, "stream entries");
  equal(value.streamAborted, cancelled && !sdk ? [false, true] : Array(calls).fill(false), "stream abort flags");
  equal(value.providerDispatches, calls, "provider dispatches");
  equal(value.dispatchAborted, Array(calls).fill(false), "provider dispatch abort flags");
  equal(value.providerHandlers, calls, "actual provider handlers");
  equal(value.modelLookups, pre ? 0 : 1, "model lookups");
  equal(value.retries, 0, "retries"); equal(value.sleeps, 0, "retry sleeps");
  equal(value.pendingResponses, pre ? 2 : unpriced ? 0 : 1, "queued response consumption");
  equal(value.toolStarts, pre ? 0 : 1, "tool starts"); equal(value.toolCompletions, pre ? 0 : 1, "tool completions"); equal(value.toolErrors, 0, "tool errors");
  if (!Array.isArray(value.contexts)) throw new DomainValidationError("missing dispatched contexts");
  equal(value.contexts.length, calls, "context count");
  const turns: Array<UsageObservation | null> = pre ? [] : [usageFromContext(value.contexts[0], "probe_tool:{}")];
  if (unpriced) turns.push(usageFromContext(value.contexts[1], "second turn completed"));
  if (sdk) {
    const providerUsage: ProviderUsageObservation[] = [];
    for (let index = 0; index < turns.length; index++) {
      const turn = turns[index]!;
      if (turn === null) throw new DomainValidationError("missing fixed faux turn");
      const current = value.contexts[index] as string;
      const previous = index === 0 ? "" : value.contexts[index - 1] as string;
      let common = 0;
      while (common < Math.min(previous.length, current.length) && previous[common] === current[common]) common++;
      const cacheReadTokens = Math.ceil(common / 4);
      const inputTokens = Math.max(0, turn.inputTokens - cacheReadTokens);
      providerUsage.push({ inputTokens, outputTokens: turn.outputTokens, cacheReadTokens,
        cacheWriteTokens: Math.ceil((current.length - common) / 4) });
      turns[index] = { inputTokens, outputTokens: turn.outputTokens, ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}) };
    }
    equal(value.providerUsage, providerUsage, "raw provider cache usage");
  }
  if (cancelled && !sdk) turns.push(null);
  equal(value.turns, turns, "actual turn usage");
  equal(value.invocations, 1, "invocations");
  const successful = !pre && !cancelled;
  equal(value.invocation, { outcome: successful ? "ok" : "cancelled", tokensIn: successful ? turns.reduce((sum, turn) => sum + (turn?.inputTokens ?? 0), 0) : null, tokensOut: successful ? turns.reduce((sum, turn) => sum + (turn?.outputTokens ?? 0), 0) : null, cacheHit: successful ? sdk && unpriced : null }, "invocation usage trust");
  equal(value.taskResults, [successful ? "SUCCESS" : "CANCELLED"], "task terminal");
  equal(value.executionFinished, [successful ? "SUCCESS" : "CANCELLED"], "execution settlement");
  const first = turns[0];
  // The fixed faux model provides no cache price; only its input/output subtotal
  // is known. Do not mistake placeholder cache cost zero for complete pricing.
  const costs = scenario === "priced-stop" && first != null ? [{ kind: "stopped", maxCostUsd: 0.5, ledger: { turns: 1, turnsWithoutUsage: sdk ? 1 : 0, tokensIn: first.inputTokens, tokensOut: first.outputTokens, spentUsd: first.inputTokens + first.outputTokens } }]
    : unpriced ? [{ kind: "disarmed", maxCostUsd: 0.000001, reason: "unpriced-model" }] : [];
  equal(value.costEvents, costs, "cost cap observations");
  if (!Array.isArray(value.eventTypes) || !value.eventTypes.every((type) => typeof type === "string" && ["TEXT_DELTA", "TOOL_STARTED", "TOOL_FINISHED", "TURN_FINISHED", "MESSAGE", "EXECUTION_FINISHED"].includes(type))) throw new DomainValidationError("unexpected execution events");
  equal(value.eventTypes.filter((type) => type !== "TEXT_DELTA"), pre ? ["MESSAGE", "EXECUTION_FINISHED"] : ["TOOL_STARTED", "TOOL_FINISHED", "TURN_FINISHED", ...(unpriced || cancelled && !sdk ? ["TURN_FINISHED"] : []), "MESSAGE", "EXECUTION_FINISHED"], "execution event order");
  if (cancelled) {
    equal(value.held, { runSettled: false, toolStarts: 1, toolCompletions: 0, toolSignalAborted: true, providerDispatches: 1, taskResults: 0, executionFinished: 0, invocations: 0 }, "blocked tool held after abort");
    equal(value.released, { runSettled: true, toolSignalAborted: true }, "blocked tool release settlement");
  } else if (value.held !== undefined || value.released !== undefined) throw new DomainValidationError("unexpected held/released scenario");
}
function validatedObservations(raw: unknown): readonly QualificationObservation[] {
  if (!Array.isArray(raw) || raw.length !== 5) throw new DomainValidationError("managed qualification requires exactly five observations");
  const sdk = Object.hasOwn(object(raw[0]), "providerUsage");
  for (const [index, scenario] of (["priced-stop", "unpriced-cap", "preabort", "blocked-tool-cancel"] as const).entries()) {
    equal(Object.hasOwn(object(raw[index]), "providerUsage"), sdk, "execution observation format");
    validateExecution(raw[index], scenario);
  }
  const settled = object(raw[4]);
  equal(settled, { scenario: "deferred-agent-end", held: { promptSettled: false, agentIdleSettled: false, kernelIdleSettled: false, isStreaming: true, pendingTools: 0 }, released: { promptSettled: true, agentIdleSettled: true, kernelIdleSettled: true, isStreaming: false, pendingTools: 0, activeSignalAbsent: true }, agentEndCount: 1, providerHandlers: 1 }, "actual Agent awaited listener settlement");
  return raw as QualificationObservation[];
}
/** Validate cooperative persisted data only. This never issues a receipt or
 * proves filesystem identity; the store must check physical paths under lock. */
export function validateManagedQualificationRecord(raw: unknown): ManagedQualificationRecord {
  const value = object(raw);
  keys(value, ["managerRoot", "candidateRoot", "generationId", "versions", "observations"], "record fields");
  if (typeof value.generationId !== "string" || !UUID.test(value.generationId)) throw new DomainValidationError("invalid qualification generation ID");
  if (typeof value.managerRoot !== "string" || !path.isAbsolute(value.managerRoot) || path.resolve(value.managerRoot) !== value.managerRoot) throw new DomainValidationError("invalid qualification manager root");
  equal(value.candidateRoot, path.join(value.managerRoot, "generations", value.generationId), "record candidate root");
  const versions = object(value.versions);
  keys(versions, ["core", "ai"], "version fields");
  for (const version of Object.values(versions)) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new DomainValidationError("invalid qualification literal version");
  }
  validatedObservations(value.observations);
  return frozenCopy(value) as unknown as ManagedQualificationRecord;
}
async function scratchEnvironment(managerRoot: string): Promise<{ cwd: string; env: NodeJS.ProcessEnv }> {
  const parent = path.join(managerRoot, "runtime", "qualification");
  for (const directory of [path.dirname(parent), parent]) {
    await mkdir(directory, { recursive: true });
    physicalDirectoryWithoutLinks(directory);
  }
  const cwd = await mkdtemp(path.join(parent, "attempt-"));
  const home = path.join(cwd, "home"), state = path.join(cwd, "state"), temp = path.join(cwd, "tmp");
  for (const directory of [home, state, temp]) await mkdir(directory);
  return { cwd, env: { ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }), ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }), PATH: "", NODE_OPTIONS: "", NODE_PATH: "", NODE_V8_COVERAGE: "", LOGONSERVER: "", USERDOMAIN: "", USERNAME: "", HOMEDRIVE: path.parse(home).root, HOMEPATH: home.slice(path.parse(home).root.length - 1), HOME: home, USERPROFILE: home, APPDATA: state, LOCALAPPDATA: state, XDG_CONFIG_HOME: state, XDG_STATE_HOME: state, XDG_CACHE_HOME: state, TEMP: temp, TMP: temp, TMPDIR: temp } };
}
/** Launch only the fixed staged harness. This proves scoped cooperative behavior,
 * not candidate integrity, provider billing, or hostile-code/OS containment. */
export async function qualifyManagedCandidate(options: ManagedQualificationOptions): Promise<ManagedQualificationResult> {
  let command: AuthorizedCommandRunResult | undefined;
  try {
    // Snapshot every caller-owned value before the first asynchronous boundary.
    options = { managerRoot: options.managerRoot, candidate: { generationId: options.candidate.generationId, root: options.candidate.root, appRoot: options.candidate.appRoot, versions: { core: options.candidate.versions.core, ai: options.candidate.versions.ai } }, ...(options.signal === undefined ? {} : { signal: options.signal }), ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) };
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT) throw new DomainValidationError(`qualification timeout must be 1..${MAX_TIMEOUT}ms`);
    const identity = await candidateIdentity(options);
    const scratch = await scratchEnvironment(identity.managerRoot);
    command = await runAuthorizedCommand({ executable: process.execPath, args: [path.join(identity.candidateRoot, "app/dist/pi-adapter/managed/bootstrap.js"), identity.candidateRoot, WORKER, identity.versions.core, identity.versions.ai], cwd: scratch.cwd, env: scratch.env, timeoutMs, maxStdoutBytes: MAX_OUTPUT, maxStderrBytes: MAX_OUTPUT, ...(options.signal === undefined ? {} : { signal: options.signal }) });
    if (command.status !== "completed" || !command.spawned || !command.ok || command.exitCode !== 0 || command.signal !== null || command.cleanupUnsettled) throw new DomainValidationError(`managed qualification process failed: ${command.status}`);
    const observed = object(JSON.parse(command.stdoutText));
    keys(observed, ["generationId", "candidateRoot", "versions", "observations"], "worker fields");
    equal(observed.generationId, options.candidate.generationId, "worker generation");
    equal(observed.candidateRoot, identity.candidateRoot, "worker candidate root");
    equal(observed.versions, identity.versions, "worker versions");
    const observations = validatedObservations(observed.observations);
    const record = validateManagedQualificationRecord({ ...identity, generationId: options.candidate.generationId, observations });
    const result = Object.freeze({ status: "qualified" as const, record: frozenCopy(record) });
    issued.set(result, record);
    return result;
  } catch (error: unknown) {
    return Object.freeze({ status: "failed" as const, reason: error instanceof Error ? error.message : String(error), ...(command === undefined ? {} : { command }) });
  }
}
