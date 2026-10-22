import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseModelRef } from "../src/config/model-ref.js";
import { loadProvidersConfig } from "../src/config/providers-config.js";
import { startDevelopmentTask, type StartDevelopmentTaskInput } from "../src/development/start-task.js";
import { DomainValidationError } from "../src/domain/errors.js";
import { createDevelopmentPiExecutorFactory, type DevelopmentPiExecutorOptions } from "../src/pi-adapter/development-executor.js";
import { createInvocationSink, type InvocationSink } from "../src/telemetry/invocation-log.js";

/** Experimental host example, not a stable SDK entry. All authority is host input. */
export interface DirectDevelopmentTaskInput extends Omit<StartDevelopmentTaskInput, "executorFactory" | "sandboxRoot"> {
  readonly sandboxRoot: string;
  readonly pi: Omit<DevelopmentPiExecutorOptions, "stateRoot">;
  readonly invocationSink?: InvocationSink;
}

export async function runDirectDevelopmentTask(input: DirectDevelopmentTaskInput) {
  // Keep the underlying entry's host-only descriptor checks ahead of the rest
  // spread: copying first would invoke a getter or erase an inherited field.
  const protectedProperties: PropertyDescriptorMap = {};
  for (const [field, label] of [["presentation", "task presentation"], ["taskContext", "task context"],
    ["hostEvaluator", "host evaluator"], ["checkFindingAnalysis", "check finding analysis"], ["staticRouting", "static routing"]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if ((descriptor === undefined && field in input) || (descriptor !== undefined && !("value" in descriptor))) {
      throw new DomainValidationError(`${label} must be an own data property`);
    }
    if (descriptor !== undefined) protectedProperties[field] = descriptor;
  }
  const { pi, invocationSink, ...task } = input;
  const sink = invocationSink ?? createInvocationSink(task.stateRoot);
  const pending: Promise<void>[] = [];
  const failures: unknown[] = [];
  const executorFactory = createDevelopmentPiExecutorFactory({ ...pi, stateRoot: task.stateRoot,
    onInvocation: (invocation) => {
      try {
        pending.push(Promise.resolve(sink(invocation)).catch((error: unknown) => { failures.push(error); }));
      } catch (error) { failures.push(error); }
      pi.onInvocation?.(invocation);
    }
  });
  let result;
  try {
    const taskInput = { ...task, executorFactory, maxWallTimeMs: task.maxWallTimeMs ?? 300_000 };
    // Restore even non-enumerable own data properties for native validation.
    Object.defineProperties(taskInput, protectedProperties);
    result = await startDevelopmentTask(taskInput);
  } finally {
    // Each write already owns its rejection. Wait for all of them, without
    // replacing an original task exception with a telemetry exception.
    await Promise.all(pending);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `invocation telemetry failed; candidate retained at ${result.candidatePath}; artifact ${result.artifact.path}`, { cause: result });
  }
  return result;
}

const USAGE = `Run an isolated candidate with a configured Pi model and a host-owned checker:
  pnpm exec tsx examples/direct-development-task.ts --source <clean-repo> --state-root <dir> --sandbox-root <existing-dir> --objective <text> --model <provider/model> --checker <executable> [--checker-arg=<arg>] [--max-wall-time-ms <1..1800000>]
State and sandbox directories must be outside the source repository. SIGINT/SIGTERM request cooperative cancellation. The result retains candidate and artifact paths; it never applies source edits.
`;

/** Executable entry is exported so the same argument and cancellation path is testable. */
export async function directDevelopmentMain(args: string[], io: { stdout(text: string): void } = { stdout: (text) => process.stdout.write(text) }): Promise<number> {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    source: { type: "string" }, "state-root": { type: "string" }, "sandbox-root": { type: "string" },
    objective: { type: "string" }, model: { type: "string" }, checker: { type: "string" },
    "checker-arg": { type: "string", multiple: true }, "max-wall-time-ms": { type: "string" }, help: { type: "boolean" }
  } });
  if (values.help) { io.stdout(USAGE); return 0; }
  const required = (value: string | undefined, flag: string): string => {
    if (value === undefined || value.trim() === "" || value.includes("\0")) throw new Error(`--${flag} is required`);
    return value;
  };
  const stateRoot = resolve(required(values["state-root"], "state-root"));
  const sourceRepo = resolve(required(values.source, "source"));
  const sandboxRoot = resolve(required(values["sandbox-root"], "sandbox-root"));
  const objective = required(values.objective, "objective");
  const model = parseModelRef(required(values.model, "model"));
  const command = required(values.checker, "checker");
  const maxWallTimeMs = values["max-wall-time-ms"] === undefined ? 300_000 : Number(values["max-wall-time-ms"]);
  if (!Number.isSafeInteger(maxWallTimeMs) || maxWallTimeMs < 1 || maxWallTimeMs > 1_800_000) throw new Error("--max-wall-time-ms must be an integer from 1 to 1800000");
  const config = await loadProvidersConfig(stateRoot);
  const abort = new AbortController();
  const onSignal = () => abort.abort();
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  try {
    const result = await runDirectDevelopmentTask({ stateRoot, sourceRepo, sandboxRoot, objective, maxWallTimeMs,
      signal: abort.signal, verification: { command, args: values["checker-arg"] ?? [] },
      pi: { ...model, customProviders: config.customProviders }
    });
    io.stdout(`${JSON.stringify(result)}\n`);
    return result.acceptance.accepted ? 0 : 1;
  } finally {
    process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  directDevelopmentMain(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
