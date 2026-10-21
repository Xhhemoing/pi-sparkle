import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DomainValidationError } from "../../domain/errors.js";
import { parseRunId } from "../../domain/ids.js";
import { physicalDirectoryWithoutLinks } from "../../native/physical-directory.js";
import { EventStore } from "../../run/event-store.js";
import { replayRun } from "../../run/replay.js";
import { ManagedGenerationStore, type QualifiedManagedGeneration } from "./generation-store.js";

interface CommonRequest { readonly stateRoot: string }
export type ControlledManagedRequest =
  | (CommonRequest & { readonly kind: "run"; readonly projectRoot: string; readonly objective: string;
      readonly children?: string; readonly flowchart?: string; readonly track?: boolean; readonly assumeDefaults?: boolean })
  | (CommonRequest & { readonly kind: "resume"; readonly runId: string; readonly unpause?: boolean;
      readonly selectedActionIds?: readonly string[]; readonly supervised?: boolean });
export interface ControlledManagedRunOptions {
  readonly managerRoot: string;
  readonly request: ControlledManagedRequest;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly stopGraceMs?: number;
  readonly maxOutputBytes?: number;
}
export interface ManagedApplicationReceipt {
  readonly type: "settled";
  readonly generationId: string;
  readonly root: string;
  readonly entry: string;
  readonly versions: { readonly core: string; readonly ai: string };
  readonly code: number;
  readonly stopped: boolean;
}
export interface ControlledManagedRunResult {
  readonly status: "completed" | "cancelled" | "timed_out" | "output_limit" | "failed";
  readonly spawned: boolean;
  readonly settlement: "not-started" | "application-settled" | "unknown";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly receipt?: ManagedApplicationReceipt;
  readonly reason?: string;
}

function limit(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new DomainValidationError(`${name} must be 1..${maximum}`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384 || value.includes("\0")) throw new DomainValidationError(`invalid controlled managed ${label}`);
  return value;
}
function requestArgv(request: ControlledManagedRequest): string[] {
  const argv = [request.kind, "--state-root", path.resolve(text(request.stateRoot, "state root")), "--executor", "pi"];
  if (request.kind === "run") {
    argv.push("--project", path.resolve(text(request.projectRoot, "project root")), "--objective", text(request.objective, "objective"));
    if (request.children !== undefined) argv.push("--children", path.resolve(text(request.children, "children")));
    if (request.flowchart !== undefined) argv.push("--flowchart", path.resolve(text(request.flowchart, "flowchart")));
    if (request.track === true) argv.push("--track");
    if (request.assumeDefaults === true) argv.push("--assume-defaults");
  } else if (request.kind === "resume") {
    argv.push("--run", parseRunId(request.runId));
    if (request.unpause === true) argv.push("--unpause");
    if (request.supervised === true) argv.push("--supervised");
    for (const id of request.selectedActionIds ?? []) argv.push("--selected", text(id, "selected action"));
  } else throw new DomainValidationError("unknown controlled managed request");
  if (Buffer.byteLength(JSON.stringify(argv), "utf8") > 32 * 1024) throw new DomainValidationError("controlled managed request exceeds byte limit");
  return argv;
}
async function environment(managerRoot: string): Promise<{ cwd: string; env: NodeJS.ProcessEnv }> {
  const parent = path.join(managerRoot, "runtime", "driver");
  await mkdir(parent, { recursive: true });
  physicalDirectoryWithoutLinks(parent);
  const cwd = await mkdtemp(path.join(parent, "attempt-"));
  const home = path.join(cwd, "home"), state = path.join(cwd, "state"), temp = path.join(cwd, "tmp");
  for (const directory of [home, state, temp]) await mkdir(directory);
  return { cwd, env: { ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
    PATH: "", NODE_OPTIONS: "", NODE_PATH: "", NODE_V8_COVERAGE: "", LOGONSERVER: "", USERDOMAIN: "", USERNAME: "",
    HOMEDRIVE: path.parse(home).root, HOMEPATH: home.slice(path.parse(home).root.length - 1), HOME: home, USERPROFILE: home,
    APPDATA: state, LOCALAPPDATA: state, XDG_CONFIG_HOME: state, XDG_STATE_HOME: state, XDG_CACHE_HOME: state,
    TEMP: temp, TMP: temp, TMPDIR: temp } };
}
function notStarted(status: ControlledManagedRunResult["status"], reason?: string): ControlledManagedRunResult {
  return { status, spawned: false, settlement: "not-started", exitCode: null, signal: null, stdout: "", stderr: "",
    ...(reason === undefined ? {} : { reason }) };
}
function receipt(value: unknown, selected: QualifiedManagedGeneration, entry: string): ManagedApplicationReceipt | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Partial<ManagedApplicationReceipt>;
  if (!isDeepStrictEqual(Object.keys(raw).sort(), ["type", "generationId", "root", "entry", "versions", "code", "stopped"].sort()) ||
      raw.type !== "settled" || raw.generationId !== selected.generationId || raw.root !== selected.root || raw.entry !== entry ||
      !isDeepStrictEqual(raw.versions, selected.versions) || !Number.isInteger(raw.code) || raw.code! < 0 || raw.code! > 255 || typeof raw.stopped !== "boolean") return undefined;
  return structuredClone(raw) as ManagedApplicationReceipt;
}

/** Internal trusted-host composition, currently qualified only on controlled offline projects.
 * This launches exactly one whole application, never an arbitrary worker or executor. */
export async function startControlledManagedRun(options: ControlledManagedRunOptions): Promise<ControlledManagedRunResult> {
  const signal = options.signal;
  if (signal?.aborted) return notStarted("cancelled");
  // Capture all caller-owned data before selection awaits. No inherited Node preloads.
  const managerRoot = text(options.managerRoot, "manager root");
  const request = structuredClone(options.request);
  const argv = requestArgv(request);
  const timeoutMs = limit(options.timeoutMs ?? 60_000, "driver timeoutMs", 2_147_483_647);
  const graceMs = limit(options.stopGraceMs ?? 2_000, "driver stopGraceMs", 30_000);
  const maxOutput = limit(options.maxOutputBytes ?? 256 * 1024, "driver maxOutputBytes", 2 * 1024 * 1024);
  let stopped = false;
  const latch = (): void => { stopped = true; };
  signal?.addEventListener("abort", latch, { once: true });
  if (signal?.aborted) latch();
  try {
    const store = new ManagedGenerationStore(managerRoot);
    let selected: QualifiedManagedGeneration | undefined;
    if (request.kind === "run") selected = await store.readApproved();
    else {
      const read = await new EventStore(request.stateRoot, parseRunId(request.runId)).readAll();
      const binding = replayRun(read.events).run?.engineBinding;
      if (binding === undefined) throw new DomainValidationError("managed driver resume requires an event-bound managed run");
      selected = await store.getQualifiedGeneration(binding.generationId);
    }
    if (selected === undefined) throw new DomainValidationError("no approved managed generation");
    if (stopped) return notStarted("cancelled");
    const scratch = await environment(selected.qualification.managerRoot);
    if (stopped) return notStarted("cancelled");
    const entry = path.join(selected.appRoot, "dist/pi-adapter/managed/driver-entry.js");
    const fixed = selected;
    return await new Promise<ControlledManagedRunResult>((resolve) => {
      const child = spawn(process.execPath, [entry, fixed.qualification.managerRoot, fixed.root, fixed.generationId, fixed.versions.core, fixed.versions.ai, JSON.stringify(argv)], {
        cwd: scratch.cwd, env: scratch.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"]
      });
      let status: ControlledManagedRunResult["status"] = "completed";
      let application: ManagedApplicationReceipt | undefined;
      let reason: string | undefined;
      let unknown = false, finished = false, stopping = false;
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
      let stdoutBytes = 0, stderrBytes = 0;
      let exitCode: number | null = null, exitSignal: NodeJS.Signals | null = null;
      let forceTimer: NodeJS.Timeout | undefined, closeTimer: NodeJS.Timeout | undefined;
      const deadline = setTimeout(() => stop("timed_out", "managed application deadline exceeded"), timeoutMs);
      const finish = (): void => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (forceTimer !== undefined) clearTimeout(forceTimer);
        if (closeTimer !== undefined) clearTimeout(closeTimer);
        signal?.removeEventListener("abort", onAbort);
        const settled = !unknown && application !== undefined && application.code === exitCode && exitSignal === null;
        if (status === "completed" && (!settled || exitCode !== 0)) status = "failed";
        resolve({ status, spawned: child.pid !== undefined, settlement: settled ? "application-settled" : "unknown",
          exitCode, signal: exitSignal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"),
          ...(application === undefined ? {} : { receipt: application }), ...(reason === undefined ? {} : { reason }) });
      };
      const stop = (next: ControlledManagedRunResult["status"], why?: string): void => {
        if (finished || stopping) return;
        stopping = true;
        status = next;
        reason = why;
        clearTimeout(deadline);
        if (child.connected) child.send({ type: "stop" }, (error) => { if (error !== null) unknown = true; });
        else unknown = true;
        forceTimer = setTimeout(() => {
          unknown = true;
          reason ??= "managed application did not settle during stop grace; effects unknown";
          child.kill("SIGKILL");
          if (child.connected) child.disconnect();
          closeTimer = setTimeout(() => {
            child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); finish();
          }, 1_000);
        }, graceMs);
      };
      const onAbort = (): void => stop("cancelled");
      signal?.addEventListener("abort", onAbort, { once: true });
      if (stopped || signal?.aborted) onAbort();
      const consume = (chunk: Buffer, kind: "stdout" | "stderr"): void => {
        if (kind === "stdout") { stdoutBytes += chunk.length; stdout = Buffer.concat([stdout, chunk.subarray(0, Math.max(0, maxOutput - stdout.length))]); }
        else { stderrBytes += chunk.length; stderr = Buffer.concat([stderr, chunk.subarray(0, Math.max(0, maxOutput - stderr.length))]); }
        if (stdoutBytes > maxOutput || stderrBytes > maxOutput) { unknown = true; stop("output_limit", "managed output exceeds byte limit"); }
      };
      child.stdout?.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
      child.on("message", (value) => {
        const parsed = receipt(value, fixed, entry);
        if (parsed === undefined || application !== undefined) { unknown = true; stop("failed", "malformed managed settlement receipt"); }
        else application = parsed;
      });
      child.on("disconnect", () => { if (application === undefined) { unknown = true; stop("failed", "managed control channel lost before settlement"); } });
      child.on("error", (error) => { unknown = true; status = "failed"; reason = error.message; });
      child.on("exit", (code, signal) => { exitCode = code; exitSignal = signal; if (child.connected) child.disconnect(); });
      child.on("close", finish);
    });
  } finally { signal?.removeEventListener("abort", latch); }
}
