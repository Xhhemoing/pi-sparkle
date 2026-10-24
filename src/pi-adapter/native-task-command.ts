import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { types } from "node:util";
import type { Api, Model } from "@earendil-works/pi-ai";
import { parseDevelopmentTaskDocument } from "../development/task-spec-document.js";
import { DomainValidationError } from "../domain/errors.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import { prepareApprovedResources, type ApprovedResourcesProvider } from "./approved-resources.js";
import { captureNativeHostContext, type CapturedNativeHostContext, type NativeHostContextInput } from "./native-host-context.js";
import type { SparkleThinkingLevel } from "./pi-executor.js";
import type { SparkleThinkingBudgets } from "./thinking-budgets.js";
import type { TaskSpecSession } from "../development/task-session.js";

export interface NativeTaskCommandOptions {
  readonly stateRoot: string;
  readonly sandboxRoot?: string;
}
export interface NativeTaskCommandAdmission {
  readonly sourceRepo: string;
  readonly host: CapturedNativeHostContext;
}

/** Only the host-owned values and dispatch operation needed at admission. */
export interface NativeTaskHostContext {
  readonly cwd: string;
  readonly model: Pick<Model<Api>, "provider" | "id"> | undefined;
  readonly scopedModels: readonly { readonly model: Pick<Model<Api>, "provider" | "id"> }[];
  readonly modelRegistry: {
    getAvailable(): readonly Model<Api>[];
    readonly streamSimple: NativeHostContextInput["streamSimple"];
  };
  getSystemPrompt(): string;
}

export function snapshotNativeTaskCommandOptions(input: NativeTaskCommandOptions | undefined): NativeTaskCommandOptions | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object" || types.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).some((key) => key !== "stateRoot" && key !== "sandboxRoot")) throw new DomainValidationError("invalid host task paths");
  const own = (key: string): string | undefined => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined) return undefined;
    if (!("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.trim() === "" || descriptor.value.includes("\0")) {
      throw new DomainValidationError("host task paths must be ordinary nonempty strings");
    }
    return path.resolve(descriptor.value);
  };
  const stateRoot = own("stateRoot"), sandboxRoot = own("sandboxRoot");
  if (stateRoot === undefined) throw new DomainValidationError("host task stateRoot is required");
  return Object.freeze({ stateRoot, ...(sandboxRoot === undefined ? {} : { sandboxRoot }) });
}

/** Synchronous admission: a resource callback or later turn cannot reselect the task. */
export function captureNativeTaskCommand(ctx: NativeTaskHostContext, thinkingLevel: SparkleThinkingLevel,
  approvedResources?: ApprovedResourcesProvider, thinkingBudgets?: SparkleThinkingBudgets): NativeTaskCommandAdmission {
  const sourceRepo = ctx.cwd;
  const effectiveSystemPrompt = ctx.getSystemPrompt();
  const selected = ctx.model;
  if (selected === undefined) throw new DomainValidationError("TaskSpec requires the selected host model");
  const provider = selected.provider, id = selected.id;
  const registry = ctx.modelRegistry;
  const streamSimple = registry.streamSimple.bind(registry);
  const scoped = ctx.scopedModels;
  const eligible = registry.getAvailable().filter((model) => scoped.length === 0 || scoped.some((entry) =>
    entry.model.provider === model.provider && entry.model.id === model.id));
  const model = eligible.find((entry) => entry.provider === provider && entry.id === id);
  if (model === undefined) throw new DomainValidationError("selected host model is unavailable or outside the session scope");
  const captured = captureNativeHostContext({ effectiveSystemPrompt, thinkingLevel, defaultModel: model, models: [model], streamSimple,
    ...(thinkingBudgets === undefined ? {} : { thinkingBudgets }) });
  const approvedResourcePayload = prepareApprovedResources(approvedResources?.({ cwd: sourceRepo }));
  return Object.freeze({ sourceRepo, host: Object.freeze({ ...captured, approvedResourcePayload }) });
}

function taskPath(args: string, cwd: string): string {
  if (typeof args !== "string" || args.length > 4096 || /[\0\r\n\u2028\u2029]/u.test(args)) throw new DomainValidationError("expected one bounded TaskSpec path");
  const trimmed = args.trim();
  const quote = trimmed[0];
  const value = quote === '"' || quote === "'" ? trimmed.slice(1, -1) : trimmed;
  if (value.trim() === "" || ((quote === '"' || quote === "'")
    ? trimmed.at(-1) !== quote || value.includes(quote)
    : /[\s'"]/u.test(value))) throw new DomainValidationError("usage: /sparkle-task <task.json>; quote the entire path when it contains spaces");
  return path.resolve(cwd, value);
}
function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
/** Same bounded regular-file protocol as the TaskSpec CLI; no shell expansion. */
async function readTaskFile(file: string): Promise<string> {
  physicalDirectoryWithoutLinks(path.dirname(file));
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 65536) throw new DomainValidationError("TaskSpec must be a nonlinked regular file of at most 64 KiB");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) throw new DomainValidationError("TaskSpec changed while opening");
    const bytes = Buffer.alloc(opened.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const result = await handle.read(bytes, used, bytes.length - used, used);
      if (result.bytesRead === 0) break;
      used += result.bytesRead;
    }
    if (used !== opened.size || !sameFile(opened, await handle.stat()) || !sameFile(opened, await lstat(file))) {
      throw new DomainValidationError("TaskSpec changed while reading");
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used)); }
    catch { throw new DomainValidationError("TaskSpec must contain valid UTF-8"); }
  } finally { await handle.close(); }
}

export async function createNativeTaskSession(options?: NativeTaskCommandOptions): Promise<TaskSpecSession> {
  const selected = snapshotNativeTaskCommandOptions(options);
  const stateRoot = path.resolve(selected?.stateRoot ?? path.join(homedir(), ".pi-sparkle"));
  const { TaskSpecSession } = await import("../development/task-session.js");
  return new TaskSpecSession({ stateRoot, ...(selected?.sandboxRoot === undefined ? {} : { sandboxRoot: selected.sandboxRoot }) });
}

/** User-command authority only. A model tool must never forward its JSON here. */
export async function runNativeTaskCommand(input: { readonly args: string; readonly admission: NativeTaskCommandAdmission;
  readonly session: TaskSpecSession; readonly signal: AbortSignal }) {
  input.signal.throwIfAborted();
  const { sourceRepo, host } = input.admission;
  const file = taskPath(input.args, sourceRepo);
  const format = [".yaml", ".yml"].includes(path.extname(file).toLowerCase()) ? "yaml" : "json";
  const spec = parseDevelopmentTaskDocument(await readTaskFile(file), format);
  input.signal.throwIfAborted();
  const { createNativeWriteExecutorFactory } = await import("./native-write-executor.js");
  return input.session.run({ sourceRepo, spec, signal: input.signal, executorFactory: createNativeWriteExecutorFactory(host) });
}
