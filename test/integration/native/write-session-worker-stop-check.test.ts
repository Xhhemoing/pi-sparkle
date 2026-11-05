import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { calculateCost, createAssistantMessageEventStream, createModels, createProvider,
  fauxAssistantMessage, fauxProvider, fauxToolCall, type Model } from "@earendil-works/pi-ai";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import { NativeWriteSession, type NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";
import { PiAgentExecutor } from "../../../src/pi-adapter/pi-executor.js";
import { developmentPiTools } from "../../../src/pi-adapter/development-tools.js";
import { EventStore } from "../../../src/run/event-store.js";
import { createEvidenceId } from "../../../src/domain/ids.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
type Report = "PASSED" | "FAILED" | "PARTIAL";
interface Options {
  readonly report?: Report;
  readonly values?: readonly string[];
  readonly hang?: boolean;
  readonly usd?: number;
  readonly missingUsage?: boolean;
  readonly afterWrite?: (context: NativeWriteExecutorFactoryInput) => void;
  readonly factoryError?: boolean;
  readonly omitExecution?: boolean;
}
async function fixture(options: Options = {}) {
  const parent = path.resolve(".agent_workspace/worker-stop-check"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "native-")), repo = path.join(root, "repo"); await mkdir(repo);
  const counter = path.join(root, "checks.jsonl");
  await writeFile(path.join(repo, "value.txt"), "before", "utf8");
  await writeFile(path.join(repo, "check.cjs"), "const fs=require('node:fs');const value=fs.readFileSync('value.txt','utf8');fs.appendFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),value})+'\\n');process.exit(value==='good'?0:1)", "utf8");
  git(repo, ["init", "-b", "fixture"]); git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.name", "Worker stop fixture"]); git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const contexts: NativeWriteExecutorFactoryInput[] = [];
  const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"),
    executorFactory(context) {
      contexts.push(context);
      if (options.factoryError) throw new Error("synthetic factory error");
      const value = options.values?.[contexts.length - 1] ?? "good";
      let turns = 0;
      const model = { ...fauxProvider().getModel()!, provider: "worker-stop-local", id: "scripted",
        cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
      const stream = (selected: Model<"faux">) => {
        turns++;
        const message = { ...fauxAssistantMessage([
          ...(turns === 1 ? [fauxToolCall("sparkle_write_file", { path: "value.txt", contents: value })] :
            [fauxToolCall("sparkle_report_task_result", { verification: options.report === "PARTIAL" ? "PASSED" : options.report ?? "FAILED",
              ...(options.report === "PARTIAL" ? { outcome: "PARTIAL" } : {}), evidenceIds: [createEvidenceId()], summary: "advisory worker report" })])
        ], { stopReason: "toolUse" }), api: selected.api, provider: selected.provider, model: selected.id };
        message.usage.input = 1; message.usage.totalTokens = 1; calculateCost(selected, message.usage);
        if (options.missingUsage) delete (message as { usage?: unknown }).usage;
        const events = createAssistantMessageEventStream();
        queueMicrotask(() => { events.push({ type: "start", partial: { ...message, content: [] } });
          events.push({ type: "done", reason: "toolUse", message }); events.end(message); });
        return events;
      };
      const models = createModels(); models.setProvider(createProvider({ id: model.provider, models: [model],
        auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
      const cost = context.executionCostBudget;
      const tools = developmentPiTools(context.tools).map(tool => tool.name !== "sparkle_write_file" ? tool : {
        ...tool, execute: async (...args: Parameters<typeof tool.execute>) => {
          const result = await tool.execute(...args); options.afterWrite?.(context); return result;
        }
      });
      const pi = new PiAgentExecutor({ providerId: model.provider, modelId: model.id, models, tools,
        stopAfterTaskResult: true, retry: { maxAttempts: 1 }, ...(cost === undefined ? {} : {
          strictReferenceBudget: true, onExecutionCost: cost.onExecutionCost, referenceBudgetAdmission: cost.assertDispatchAllowed }) });
      cost?.bindExecutor(pi);
      if (options.omitExecution) return { async *execute() { yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" }; } };
      if (!options.hang) return pi;
      // Exercise the real coordinator deadline after a candidate-scoped write.
      const executor: AgentExecutor = { async *execute(_request, signal) {
        await context.tools.find(tool => tool.name === "sparkle_write_file")!.execute("write", { path: "value.txt", contents: value }, signal);
        options.afterWrite?.(context);
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
        yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      } };
      return executor;
    } });
  const input = { sourceRepo: repo, objective: "Make value good; the host check decides", maxAttempts: 1,
    verification: { command: process.execPath, args: ["check.cjs", counter], timeoutMs: 5000 },
    ...(options.usd === undefined ? {} : { referenceUsdBudget: options.usd }) };
  const checks = async (): Promise<Array<{ cwd: string; value: string }>> => {
    try { return (await readFile(counter, "utf8")).trim().split("\n").map(line => JSON.parse(line)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  };
  return { root, repo, session, contexts, input, checks };
}

for (const report of ["FAILED", "PARTIAL"] as const) test(`host accepts a correct candidate after the real Pi report tool says ${report}`, { timeout: 60000 }, async () => {
  const f = await fixture({ report });
  try {
    const result = await f.session.execute(f.input);
    assert.deepEqual(await f.checks(), [{ cwd: result.candidatePath, value: "good" }]);
    assert.equal(result.acceptance.accepted, true, result.reason); assert.notEqual(result.effectsSettled, false);
    assert.equal(result.status, "COMPLETED"); assert.equal(result.loop?.stopReason, "accepted");
    assert.equal(await readFile(path.join(f.repo, "value.txt"), "utf8"), "before");
  } finally { await f.session.shutdown(); }
});

for (const phase of ["attempt", "cumulative"] as const) test(`host checks a correct candidate after ${phase} worker timeout`, { timeout: 60000 }, async () => {
  const f = await fixture({ hang: true });
  try {
    const result = await f.session.execute({ ...f.input, maxAttempts: 3, workerTimeoutMs: phase === "attempt" ? 1000 : 10000,
      ...(phase === "cumulative" ? { phaseTimeLimits: { workerTotalMs: 1000, checkTotalMs: 10000 } } : {}) });
    assert.deepEqual(await f.checks(), [{ cwd: result.candidatePath, value: "good" }]);
    assert.equal(result.acceptance.accepted, true, result.reason); assert.notEqual(result.effectsSettled, false);
    assert.equal(result.loop?.stopReason, "accepted"); assert.equal(f.contexts.length, 1);
    const events = await new EventStore(path.join(f.root, "state"), result.runId).readAll();
    assert.ok(events.events.some(event => event.type === "RUN_FAILED"), "worker failure evidence remains available");
  } finally { await f.session.shutdown(); }
});

test("total deadline reserves final check time before selecting the worker allowance", { timeout: 60000 }, async () => {
  const f = await fixture({ hang: true });
  try {
    const result = await f.session.execute({ ...f.input, workerTimeoutMs: 20000, maxWallTimeMs: 15000 });
    assert.deepEqual(await f.checks(), [{ cwd: result.candidatePath, value: "good" }]);
    assert.equal(result.acceptance.accepted, true, result.reason); assert.notEqual(result.effectsSettled, false);
    assert.equal(result.loop?.stopReason, "accepted"); assert.equal(f.contexts.length, 1);
  } finally { await f.session.shutdown(); }
});

for (const stop of ["abort", "shutdown", "unsettled-command"] as const) test(`no check after ${stop} even with a correct candidate`, { timeout: 60000 }, async () => {
  const controller = new AbortController(); let shutdown: Promise<void> | undefined;
  const f = await fixture({ afterWrite(context) {
    if (stop === "abort") controller.abort();
    else if (stop === "shutdown") shutdown = f.session.shutdown();
    else context.onCommandCleanupUnsettled({ cleanupUnsettled: true, status: "failed", exitCode: null,
      signal: null, stdoutByteLength: 0, stderrByteLength: 0 } as Parameters<typeof context.onCommandCleanupUnsettled>[0]);
  } });
  try {
    const result = await f.session.execute({ ...f.input, signal: controller.signal });
    assert.deepEqual(await f.checks(), []); assert.equal(result.acceptance.accepted, false);
    if (stop === "unsettled-command") assert.equal(result.effectsSettled, false);
    else assert.equal(result.status, "CANCELLED");
  } finally { await f.session.shutdown(); await shutdown; }
});

for (const stop of ["cost-budget", "cost-unavailable", "unsettled-cost"] as const) test(`no check after ${stop}`, { timeout: 60000 }, async () => {
  const f = await fixture({ usd: stop === "cost-budget" ? 0.0000005 : 1,
    missingUsage: stop === "cost-unavailable", omitExecution: stop === "unsettled-cost" });
  try {
    const result = await f.session.execute(f.input);
    assert.deepEqual(await f.checks(), []); assert.equal(result.acceptance.accepted, false);
    if (stop === "unsettled-cost") assert.equal(result.effectsSettled, false);
    else assert.equal(result.loop?.stopReason, stop);
  } finally { await f.session.shutdown(); }
});

test("factory errors never authorize a check", { timeout: 60000 }, async () => {
  const f = await fixture({ factoryError: true });
  try {
    const result = await f.session.execute(f.input);
    assert.deepEqual(await f.checks(), []); assert.equal(result.loop?.stopReason, "executor-failed");
    assert.equal(result.acceptance.accepted, false);
  } finally { await f.session.shutdown(); }
});

for (const report of ["FAILED", "PASSED"] as const) test(`wrong candidate with worker ${report} is refused and repairs only from host feedback`, { timeout: 60000 }, async () => {
  const f = await fixture({ report, values: ["wrong", "good"] });
  try {
    const result = await f.session.execute({ ...f.input, maxAttempts: 2 });
    assert.deepEqual(await f.checks(), [{ cwd: result.candidatePath, value: "wrong" }, { cwd: result.candidatePath, value: "good" }]);
    assert.equal(result.loop?.attempts[0]?.accepted, false); assert.equal(f.contexts[1]?.attempt?.previous?.exitCode, 1);
    assert.equal(result.acceptance.accepted, true); assert.notEqual(result.effectsSettled, false);
  } finally { await f.session.shutdown(); }
});

test("wrong candidate after worker exhaustion is checked but cannot start another worker", { timeout: 60000 }, async () => {
  const f = await fixture({ values: ["wrong"], hang: true });
  try {
    const result = await f.session.execute({ ...f.input, maxAttempts: 3, phaseTimeLimits: { workerTotalMs: 1000 } });
    assert.deepEqual(await f.checks(), [{ cwd: result.candidatePath, value: "wrong" }]);
    assert.equal(result.acceptance.accepted, false); assert.equal(result.loop?.stopReason, "time-budget");
    assert.equal(f.contexts.length, 1); assert.notEqual(result.effectsSettled, false);
  } finally { await f.session.shutdown(); }
});
