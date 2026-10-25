import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { loadProvidersConfig } from "../config/providers-config.js";
import { TaskSpecSession, type TaskExecutionProjection } from "../development/task-session.js";
import { DomainValidationError } from "../domain/errors.js";
import { developmentPiTools } from "../pi-adapter/development-tools.js";
import { createConfiguredPiExecutor } from "../pi-adapter/runtime.js";
import { createInvocationSink } from "../telemetry/invocation-log.js";
import { CLI_EXIT, cliFail } from "./errors.js";
import { resolveCliPiExecutorOptions } from "./executor-factory.js";
import { readTaskSpecFile } from "./task-spec.js";

interface Io { stdout(text: string): void; stderr(text: string): void; }
const USAGE = `Usage: pi-sparkle task run <task.json|yaml> --project <repo> --executor pi [--state-root <dir>] [--review] [--json]

Run a reviewed TaskSpec with the configured CLI model, credentials and thinking
level. The worker receives fresh task context and candidate-scoped tools. CLI
configuration does not reproduce a parent Pi session's prompt, skills or hooks.
Provider calls may incur charges. budget.usd limits observed reference usage;
it is not a provider bill ceiling. State defaults to ~/.pi-sparkle, outside source.

Candidates are retained by default. --review reads one explicit apply, discard
or retain decision from stdin in this same process; EOF retains. Apply requires
independent acceptance and fresh verification. JSON mode prints safe JSON lines,
including a later action if selected. Private checker output stays in artifacts.
Cancellation waits for owned execution settlement; unknown effects are retained.

TaskSpec execution cannot resume across processes: the live verifier and remaining
budget pools cannot be recovered from JSON. Existing top-level resume continues
supervised/flowchart runs; ordinary runs only rebuild their checkpoint.
`;
function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "" || value.includes("\0")) throw new DomainValidationError(`${name} is required`);
  return value;
}
async function decision(io: Io, signal: AbortSignal): Promise<"apply" | "discard" | "retain"> {
  signal.throwIfAborted();
  io.stderr("Candidate review: enter apply, discard or retain (EOF retains): ");
  const reader = createInterface({ input: process.stdin, terminal: false, signal });
  try {
    for await (const line of reader) {
      signal.throwIfAborted();
      const selected = line.trim();
      if (selected === "apply" || selected === "discard" || selected === "retain") return selected;
      throw new DomainValidationError("review requires apply, discard or retain; candidate retained");
    }
    signal.throwIfAborted();
    return "retain";
  } finally { reader.close(); }
}

/** User-only single-process execution. Serialized results never restore lifecycle authority. */
export async function taskRunCommand(args: string[], io: Io, runtime: { readonly signal?: AbortSignal } = {}): Promise<number> {
  if (args[0] === "resume") {
    if (args.includes("--help")) { io.stdout(USAGE); return CLI_EXIT.ok; }
    return cliFail(io, { command: "task resume", stage: "authority", message: "TaskSpec resume requires the original live verifier/session and remaining budget pools; persisted JSON cannot restore them",
      next: "retain private evidence for reconciliation; top-level resume supports existing supervised/flowchart runs and ordinary checkpoint rebuilding only" });
  }
  let stage = "parse-args";
  let session: TaskSpecSession | undefined, result: TaskExecutionProjection | undefined;
  const pendingWrites = new Set<Promise<void>>();
  const interrupted = new AbortController();
  const signal = runtime.signal === undefined ? interrupted.signal : AbortSignal.any([interrupted.signal, runtime.signal]);
  const stop = () => interrupted.abort(new Error("host interrupted TaskSpec execution"));
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const { values, positionals } = parseArgs({ args: args.slice(1), allowPositionals: true, strict: true,
      options: { project: { type: "string" }, "state-root": { type: "string" }, executor: { type: "string" },
        review: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" } } });
    if (values.help) { io.stdout(USAGE); return CLI_EXIT.ok; }
    if (args[0] !== "run" || positionals.length !== 1) throw new DomainValidationError("expected task run <task.json|yaml>");
    if (values.executor !== "pi") throw new DomainValidationError("task run requires --executor pi");
    const file = path.resolve(required(positionals[0], "TaskSpec file"));
    const sourceRepo = path.resolve(required(values.project, "--project"));
    const stateRoot = path.resolve(values["state-root"] === undefined ? path.join(homedir(), ".pi-sparkle") : required(values["state-root"], "--state-root"));
    stage = "validation"; signal.throwIfAborted();
    const spec = await readTaskSpecFile(file);
    stage = "configuration";
    const options = resolveCliPiExecutorOptions({ stateRoot, config: await loadProvidersConfig(stateRoot), env: process.env });
    const sink = createInvocationSink(stateRoot, { onDrop: () => io.stderr("warning: model invocation telemetry unavailable; inspect private task evidence\n") });
    session = new TaskSpecSession({ stateRoot });
    stage = "execute";
    result = await session.run({ sourceRepo, spec, signal, executorFactory: async context => {
      const cost = context.executionCostBudget;
      const executor = await createConfiguredPiExecutor({ ...options, tools: developmentPiTools(context.tools), stopAfterTaskResult: true,
        onInvocation: invocation => { context.onInvocation(invocation); pendingWrites.add(sink(invocation)); },
        ...(cost === undefined ? {} : { strictReferenceBudget: true as const, onExecutionCost: cost.onExecutionCost,
          referenceBudgetAdmission: cost.assertDispatchAllowed }) });
      cost?.bindExecutor(executor);
      return executor;
    } });
    if (values.json) io.stdout(`${JSON.stringify(result)}\n`);
    else io.stdout(`TaskSpec ${result.accepted ? "accepted" : "refused"}: ${result.runId}\nHost evidence: ${result.artifactPath}\nCandidate retained: ${result.candidatePath}\nEffects settled: ${result.effectsSettled}\n`);
    signal.throwIfAborted();
    if (values.review) {
      stage = "review";
      const selected = await decision(io, signal);
      if (selected !== "retain") {
        stage = selected;
        const action = selected === "apply" ? await session.apply(result.runId, signal) : await session.discard(result.runId, signal);
        if (values.json) io.stdout(`${JSON.stringify(action)}\n`);
        else io.stdout(`TaskSpec ${action.status}: ${action.runId}\nCandidate: ${action.candidatePath}\n`);
      } else if (!values.json) io.stdout("Candidate retained.\n");
    }
    if (!result.accepted) return cliFail(io, { command: "task run", stage: "execute", message: result.refusal?.message ?? "TaskSpec execution unavailable or refused; private diagnostics remain in host evidence",
      runId: result.runId, next: result.refusal?.next ?? `inspect private evidence at ${result.artifactPath}; do not retry unresolved effects` });
    return CLI_EXIT.ok;
  } catch (error) {
    // Exceptions after execution begins may carry raw trusted checker output.
    const privateStage = stage === "execute" || stage === "apply" || stage === "discard";
    return cliFail(io, { command: "task run", stage,
      message: privateStage ? "TaskSpec operation refused or interrupted; candidate and private evidence require inspection" : error instanceof Error ? error.message : String(error),
      ...(result === undefined ? {} : { runId: result.runId }),
      next: result === undefined ? "review the TaskSpec and private state; reconcile any unsettled effects before retrying"
        : `inspect private evidence at ${result.artifactPath}; candidate ${result.candidatePath}; do not replay unresolved effects` });
  } finally {
    try { await session?.shutdown(); }
    finally { await Promise.allSettled([...pendingWrites]); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
  }
}
