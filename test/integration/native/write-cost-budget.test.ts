import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { calculateCost, createAssistantMessageEventStream, createModels, createProvider, fauxAssistantMessage,
  fauxProvider, fauxToolCall, type Model, type Usage } from "@earendil-works/pi-ai";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { NativeWriteSession, type NativeWriteExecutorFactory, type NativeWriteExecutorFactoryInput } from "../../../src/native/write-session.js";
import { startDevelopmentTaskSpec } from "../../../src/development/start-task-spec.js";
import type { DevelopmentTaskSpec } from "../../../src/development/task-spec.js";
import { PiAgentExecutor, type ExecutionCostReport, type PiExecutorOptions } from "../../../src/pi-adapter/pi-executor.js";
import { developmentPiTools } from "../../../src/pi-adapter/development-tools.js";
import type { AgentExecutor } from "../../../src/execution/contract.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
interface BudgetHandle { readonly remainingReferenceUsd: number; readonly onExecutionCost: (report: ExecutionCostReport) => void;
  readonly assertDispatchAllowed: () => void;
  readonly bindExecutor: (executor: AgentExecutor) => void; }
const budget = (context: NativeWriteExecutorFactoryInput) => (context as unknown as { executionCostBudget?: BudgetHandle }).executionCostBudget;
interface Response { readonly value: string; readonly amount: "six" | "five"; readonly missing?: boolean; readonly partial?: boolean; readonly continue?: boolean; }
async function fixture(responses: readonly Response[], options: { maxAttempts?: number; cap?: number; unsupported?: boolean;
  omitBudget?: boolean;
  hostEvaluator?: boolean; onWrite?: (context: NativeWriteExecutorFactoryInput) => void;
  unpriced?: boolean; binding?: "foreign" | "duplicate" | "lookalike" | "missing-admission" | "foreign-admission"; mutateAdmission?: boolean;
  held?: { entered: ReturnType<typeof Promise.withResolvers<void>>; release: ReturnType<typeof Promise.withResolvers<void>>;
    aborted: ReturnType<typeof Promise.withResolvers<void>> };
  transform?: (executor: PiAgentExecutor, context: NativeWriteExecutorFactoryInput) => AgentExecutor } = {}) {
  const parent = path.join(process.cwd(), ".agent_workspace/phase1-task-cost-pool"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "native-")); const repo = path.join(root, "repo"); await mkdir(repo);
  const checkLog = path.join(root, "checks.log");
  await writeFile(path.join(repo, "value.txt"), "zero", "utf8");
  await writeFile(path.join(repo, "check.cjs"), "const fs=require('node:fs');fs.appendFileSync(process.argv[2],'check\\n');const ok=fs.readFileSync('value.txt','utf8')==='good';if(!ok)console.log(JSON.stringify({assertion:'value-correct',outcome:'failed'}));process.exit(ok?0:1)", "utf8");
  git(repo, ["init"]); git(repo, ["config", "user.name", "USD Test"]); git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["add", "."]); git(repo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(repo, ["rev-parse", "HEAD"]);
  const model = { ...fauxProvider().getModel()!, provider: "native-cost-local", id: "priced",
    cost: options.unpriced ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } : { input: 600_000, output: 500_000, cacheRead: 1, cacheWrite: 1 } };
  let dispatches = 0, executed = 0; const contexts: NativeWriteExecutorFactoryInput[] = []; const caps: (number | undefined)[] = [];
  const stream = (selected: Model<"faux">) => {
    const response = responses[dispatches++]; assert.ok(response, "unexpected provider work");
    const usage: Usage = { input: response.amount === "six" ? 1 : 0, output: response.amount === "five" ? 1 : 0,
      cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    calculateCost(selected, usage);
    if (response.partial) usage.cost.total += 0.1;
    const message = { ...fauxAssistantMessage([
      fauxToolCall("sparkle_write_file", { path: "value.txt", contents: response.value }),
      ...(response.continue ? [] : [fauxToolCall("sparkle_report_task_result", { verification: "PASSED", summary: "host checks decide" })])
    ], { stopReason: "toolUse" }), api: selected.api, model: selected.id, provider: selected.provider, usage };
    if (response.missing) delete (message as { usage?: Usage }).usage;
    const result = createAssistantMessageEventStream();
    queueMicrotask(() => { result.push({ type: "start", partial: { ...message, content: [] } });
      result.push({ type: "done", reason: "toolUse", message }); result.end(message); }); return result;
  };
  const models = createModels(); models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: "Local", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  const factory: NativeWriteExecutorFactory = (context) => {
      contexts.push(context); const cost = budget(context);
      if (options.unsupported) return { async *execute() { executed++; yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }; } };
      const tools = options.held === undefined && options.onWrite === undefined ? context.tools : context.tools.map((tool) => tool.name !== "sparkle_write_file" ? tool : {
        ...tool, execute: async (id: string, params: unknown, signal?: AbortSignal) => {
          options.onWrite?.(context);
          if (options.held !== undefined) {
            assert.ok(signal); signal.addEventListener("abort", () => options.held!.aborted.resolve(), { once: true });
            options.held!.entered.resolve(); await options.held!.release.promise;
          }
          return tool.execute(id, params, signal);
        }
      });
      const piOptions: PiExecutorOptions = { providerId: model.provider, modelId: model.id, models, tools: developmentPiTools(tools),
        stopAfterTaskResult: true, retry: { maxAttempts: 1 }, ...(cost === undefined ? {} : {
          strictReferenceBudget: true, onExecutionCost: cost.onExecutionCost,
          ...(options.binding === "missing-admission" ? {} : { referenceBudgetAdmission: options.binding === "foreign-admission" ? () => undefined : cost.assertDispatchAllowed }) }) };
      const pi = new PiAgentExecutor(piOptions);
      if (options.mutateAdmission) (piOptions as PiExecutorOptions & { referenceBudgetAdmission?: () => void }).referenceBudgetAdmission = () => undefined;
      if (options.binding === "foreign") cost?.bindExecutor(new PiAgentExecutor({ providerId: model.provider, modelId: model.id, models,
        strictReferenceBudget: true, onExecutionCost: () => undefined }));
      else if (options.binding === "lookalike") cost?.bindExecutor({ execute: pi.execute.bind(pi) });
      else cost?.bindExecutor(pi);
      if (options.binding === "duplicate") cost?.bindExecutor(pi);
      const inner = options.transform?.(pi, context) ?? pi;
      return { async *execute(request, signal) { executed++; caps.push(request.maxCostUsd); yield* inner.execute(request, signal); } };
    };
  const session = new NativeWriteSession({ stateRoot: path.join(root, "state"), sandboxRoot: path.join(root, "candidates"), executorFactory: factory,
    ...(options.hostEvaluator ? { hostEvaluator: { evaluatorId: "cost", evaluatorVersion: "v1", rubricId: "cost", rubricVersion: "v1",
      evaluatorDefinitionCanonicalJson: "{}", modelFailureExitCodes: [1] } } : {}) });
  const run = () => session.execute({ sourceRepo: repo, objective: "make good", verification: { command: process.execPath, args: ["check.cjs", checkLog] },
    maxAttempts: options.maxAttempts ?? 3, ...(options.omitBudget ? {} : { referenceUsdBudget: options.cap ?? 1 }) });
  const spec: DevelopmentTaskSpec = { version: 1, objective: "make good", context: ["value.txt"], write: { allow: ["value.txt", "check.cjs"], protect: ["check.cjs"] }, prepare: [],
    checks: [{ id: "value", command: process.execPath, args: ["check.cjs", checkLog], verifierVersion: "v1", protectedPaths: ["check.cjs"],
      expect: { baseline: "fail", failureAssertion: "value-correct" } }], worker: { model: "inherit", maxAttempts: options.maxAttempts ?? 3 },
    budget: { totalSeconds: 30, prepareSeconds: 5, checkSeconds: 5, workerSeconds: 10,
      workerTotalSeconds: 20, checkTotalSeconds: 10, usd: options.cap ?? 1 } };
  const runSpec = () => startDevelopmentTaskSpec({ sourceRepo: repo, stateRoot: path.join(root, "spec-state"), sandboxRoot: path.join(root, "spec-candidates"), spec, executorFactory: factory });
  return { root, repo, revision, model, models, checkLog, contexts, caps, session, run, runSpec, dispatches: () => dispatches, executed: () => executed,
    checks: async () => { try { return (await readFile(checkLog, "utf8")).trim().split("\n").length; } catch { return 0; } } };
}

test("one Native logical task deducts actual 0.6 then offers 0.4 and refuses successful 0.5 overrun", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "bad", amount: "six" }, { value: "good", amount: "five" }]);
  try {
    const result = await f.run();
    assert.equal(result.acceptance.accepted, false); assert.equal(result.loop?.stopReason, "cost-budget");
    assert.equal(f.contexts.length, 2); assert.equal(budget(f.contexts[0]!)?.remainingReferenceUsd, 1);
    assert.equal(budget(f.contexts[1]!)?.remainingReferenceUsd, 0.4); assert.deepEqual(f.caps, [1, 0.4]);
    assert.equal(f.dispatches(), 2); assert.equal(await f.checks(), 1, "known overrun must not authorize another verifier");
    assert.equal(await readFile(path.join(f.repo, "value.txt"), "utf8"), "zero"); assert.equal(git(f.repo, ["rev-parse", "HEAD"]), f.revision);
  } finally { await f.session.shutdown(); }
});

test("Native single-attempt successful overrun is refused before the early return", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "six" }], { maxAttempts: 1, cap: 0.5 });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(result.loop?.stopReason, "cost-budget");
    assert.equal(f.dispatches(), 1); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

for (const value of ["good", "bad"]) test(`Native missing usage ${value} cannot become zero or authorize repair`, { timeout: 60000 }, async () => {
  const f = await fixture([{ value, amount: "six", missing: true }, { value: "good", amount: "five" }]);
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(result.loop?.stopReason, "cost-unavailable");
    assert.equal(f.contexts.length, 1); assert.equal(f.dispatches(), 1); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

for (const value of ["good", "bad"]) test(`Native exact exhaustion ${value} permits only existing successful verification`, { timeout: 60000 }, async () => {
  const f = await fixture([{ value, amount: "six" }, { value: "good", amount: "five" }], { cap: 0.6 });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, value === "good");
    assert.equal(result.loop?.stopReason, value === "good" ? "accepted" : "cost-budget");
    assert.equal(f.contexts.length, 1); assert.equal(f.dispatches(), 1); assert.equal(await f.checks(), 1); } finally { await f.session.shutdown(); }
});

test("Native USD refuses an ordinary unsupported executor before actual execute", { timeout: 60000 }, async () => {
  const f = await fixture([], { unsupported: true });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.executed(), 0);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("actual TaskSpec preflight SDK and Native repair share budget.usd without changing source or renewing time pools", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "bad", amount: "six" }, { value: "good", amount: "five" }]);
  const result = await f.runSpec();
  assert.equal(result.preflight?.ok, true); assert.equal(result.execution.acceptance.accepted, false);
  assert.equal(result.execution.loop?.stopReason, "cost-budget"); assert.deepEqual(f.caps, [1, 0.4]);
  assert.equal(await f.checks(), 2, "one base check and one failed attempt check; overrun cannot start the final checker");
  assert.equal(result.execution.referenceCost?.knownReferenceUsd, 1.1);
  const persisted = JSON.parse(await readFile(result.execution.loop!.artifact.path, "utf8"));
  assert.equal(persisted.body.referenceCost.knownReferenceUsd, 1.1);
  assert.equal(await readFile(path.join(f.repo, "value.txt"), "utf8"), "zero"); assert.equal(git(f.repo, ["rev-parse", "HEAD"]), f.revision);
});

for (const binding of ["foreign", "duplicate", "lookalike", "missing-admission", "foreign-admission"] as const) {
  test(`Native rejects ${binding} executor cost binding before worker dispatch`, { timeout: 60000 }, async () => {
    const f = await fixture([], { binding });
    try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.executed(), 0);
      assert.equal(f.dispatches(), 0); assert.equal(result.loop?.stopReason, "cost-unavailable"); } finally { await f.session.shutdown(); }
  });
}

test("Native retains a genuine foreign request receipt without attributing its amount to this task", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "six" }], { transform: (pi) => ({ async *execute(request, signal) {
    yield* pi.execute({ ...request, taskId: createTaskId() }, signal);
  } }) });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 1);
    assert.equal(result.referenceCost?.knownReferenceUsd, 0);
    assert.equal(result.referenceCost?.coverage, "unknown"); assert.equal(result.referenceCost?.attempts[0]?.report?.knownReferenceUsd, 0.6);
    assert.equal(result.effectsSettled, false); assert.equal(result.loop?.stopReason, "verification-unavailable");
    assert.equal(result.referenceCost?.remainingReferenceUsd, undefined); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("Native does not turn a missing original receipt into complete zero or release uncertain ownership", { timeout: 60000 }, async () => {
  const f = await fixture([], { transform: () => ({ async *execute() { yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" }; } }) });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 0);
    assert.equal(result.effectsSettled, false); assert.equal(result.loop?.stopReason, "verification-unavailable");
    assert.equal(result.referenceCost?.coverage, "unknown"); assert.equal(result.referenceCost?.remainingReferenceUsd, undefined); } finally { await f.session.shutdown(); }
});

test("Native refuses a fabricated complete receipt before provider dispatch", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "six" }], { transform: (pi, context) => ({ async *execute(request, signal) {
    budget(context)!.onExecutionCost({ ...request, streamDispatches: 0, knownReferenceUsd: 0, coverage: "complete", settled: true,
      ledger: { turns: 0, turnsWithoutUsage: 0, tokensIn: 0, tokensOut: 0, spentUsd: 0 } });
    yield* pi.execute(request, signal);
  } }) });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 0);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); assert.equal(result.referenceCost?.knownReferenceUsd, 0);
    assert.equal(result.referenceCost?.coverage, "unknown"); assert.equal(result.referenceCost?.remainingReferenceUsd, undefined);
    assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("Native refuses a fabricated receipt during owned work and retains actual provider subtotal", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "six" }], { onWrite(context) {
    budget(context)!.onExecutionCost({ runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
      streamDispatches: 0, knownReferenceUsd: 0, coverage: "complete", settled: true,
      ledger: { turns: 0, turnsWithoutUsage: 0, tokensIn: 0, tokensOut: 0, spentUsd: 0 } });
  } });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 1);
    assert.equal(result.referenceCost?.knownReferenceUsd, 0.6); assert.equal(result.referenceCost?.coverage, "partial");
    assert.equal(result.referenceCost?.remainingReferenceUsd, undefined); assert.equal(result.loop?.stopReason, "cost-unavailable");
    assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("Native refuses duplicate actual execution receipts without refunding their known costs", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "five" }, { value: "good", amount: "five" }], { transform: (pi) => ({ async *execute(request, signal) {
    yield* pi.execute(request, signal); yield* pi.execute(request, signal);
  } }) });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 2);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); assert.equal(result.referenceCost?.knownReferenceUsd, 1);
    assert.equal(result.referenceCost?.remainingReferenceUsd, undefined); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("Native incomplete cache/pricing coverage preserves subtotal and refuses another check or repair", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "six", partial: true }]);
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 1);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); assert.equal(result.referenceCost?.coverage, "partial");
    assert.ok(result.referenceCost!.knownReferenceUsd! > 0); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("Native unpriced model refuses before provider work and keeps unknown coverage", { timeout: 60000 }, async () => {
  const f = await fixture([], { unpriced: true });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 0);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); assert.equal(result.referenceCost?.coverage, "unknown"); } finally { await f.session.shutdown(); }
});

test("Native cancellation waits for the held owned tool before reporting cost and outranks actual overrun", { timeout: 60000 }, async () => {
  const held = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>(), aborted: Promise.withResolvers<void>() };
  const f = await fixture([{ value: "good", amount: "six" }], { cap: 0.5, held });
  const running = f.run(); let stopped = false;
  try {
    await held.entered.promise; const stopping = f.session.shutdown().then(() => { stopped = true; });
    await held.aborted.promise; await setImmediate(); assert.equal(stopped, false);
    held.release.resolve(); const result = await running; await stopping;
    assert.equal(result.acceptance.accepted, false); assert.equal(result.status, "CANCELLED"); assert.equal(result.loop?.stopReason, "cancelled");
    assert.equal(result.referenceCost?.knownReferenceUsd, 0.6); assert.equal(result.referenceCost?.settled, true); assert.equal(await f.checks(), 0);
  } finally { held.release.resolve(); await running; await f.session.shutdown(); }
});

for (const artifactKind of ["ps-p3-closed-loop", "native-write-loop", "native-host-observation"]) test(`Native late receipt during ${artifactKind} persistence cannot preserve true acceptance`, { timeout: 60000 }, async (t) => {
  const f = await fixture([{ value: "good", amount: "six" }], { hostEvaluator: artifactKind === "native-host-observation" }); const original = fs.rename; let injected = false;
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (!injected && String(args[1]).includes("loop-artifacts")) {
      const data = JSON.parse(await readFile(String(args[0]), "utf8")) as { body?: { kind?: string } };
      if (data.body?.kind === artifactKind) { injected = true; budget(f.contexts[0]!)!.onExecutionCost({} as ExecutionCostReport); }
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  try { const result = await f.run(); assert.equal(injected, true); assert.equal(result.acceptance.accepted, false);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); assert.equal(result.referenceCost?.remainingReferenceUsd, undefined);
    const persisted = JSON.parse(await readFile(result.loop!.artifact.path, "utf8")); assert.equal(persisted.body.stopReason, "cost-unavailable");
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.session.shutdown(); }
});

for (const clone of [false, true]) test(`Native refuses ${clone ? "a JSON clone" : "an original foreign-sink receipt"} as local settlement authority`, { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "good", amount: "six" }], { transform: (_pi, context) => ({ async *execute(request, signal) {
    let foreign: ExecutionCostReport | undefined;
    const other = new PiAgentExecutor({ providerId: f.model.provider, modelId: f.model.id, models: f.models,
      strictReferenceBudget: true, stopAfterTaskResult: true, tools: developmentPiTools(context.tools),
      onExecutionCost: (report) => { foreign = report; } });
    yield* other.execute(request, signal); assert.ok(foreign);
    budget(context)!.onExecutionCost(clone ? JSON.parse(JSON.stringify(foreign)) as ExecutionCostReport : foreign);
  } }) });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 1);
    assert.equal(result.effectsSettled, false); assert.equal(result.referenceCost?.coverage, "unknown");
    assert.equal(result.referenceCost?.remainingReferenceUsd, undefined); assert.equal(await f.checks(), 0); } finally { await f.session.shutdown(); }
});

test("Native unknown Pi settlement outranks actual overrun and keeps the candidate owned", { timeout: 60000 }, async (t) => {
  const f = await fixture([{ value: "good", amount: "six" }], { cap: 0.5 });
  const idle = AgentSession.prototype.waitForIdle;
  t.mock.method(AgentSession.prototype, "waitForIdle", async function(this: AgentSession) {
    await idle.call(this); throw Error("synthetic settlement confirmation unavailable");
  });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(result.effectsSettled, false);
    assert.equal(result.loop?.stopReason, "verification-unavailable"); assert.equal(result.referenceCost?.knownReferenceUsd, 0.6);
    assert.equal(result.referenceCost?.settled, false); assert.equal(await f.checks(), 0);
  } finally { t.mock.restoreAll(); await f.session.shutdown(); }
});

test("Native omission preserves legacy repair and does not require monetary reports", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "bad", amount: "six" }, { value: "good", amount: "five" }], { omitBudget: true });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, true); assert.equal(f.dispatches(), 2);
    assert.deepEqual(f.caps, [undefined, undefined]); assert.equal(result.referenceCost, undefined);
    assert.equal(budget(f.contexts[0]!), undefined); assert.equal(await f.checks(), 2); } finally { await f.session.shutdown(); }
});

test("Native live pool refuses repair dispatch when a closed previous receipt invalidates the offered allowance", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "bad", amount: "six" }, { value: "good", amount: "five" }], {
    transform: (pi, context) => {
      if (context.attempt?.number === 2) budget(f.contexts[0]!)!.onExecutionCost({} as ExecutionCostReport);
      return pi;
    }
  });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.contexts.length, 2);
    assert.equal(f.dispatches(), 1, "a once-valid offer cannot authorize dispatch after the live pool becomes unknown");
    assert.equal(result.loop?.stopReason, "cost-unavailable"); } finally { await f.session.shutdown(); }
});

test("Native live pool invalidation also prevents the next turn inside an already started Pi execute", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "bad1", amount: "five" }, { value: "bad2", amount: "six", continue: true }, { value: "good", amount: "five" }], {
    cap: 2, onWrite: (context) => { if (context.attempt?.number === 2) budget(f.contexts[0]!)!.onExecutionCost({} as ExecutionCostReport); }
  });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false);
    assert.equal(f.dispatches(), 2, "the next provider turn must check the original task's live admission closure");
    assert.equal(result.loop?.stopReason, "cost-unavailable"); } finally { await f.session.shutdown(); }
});

test("Native actual Pi admission retains its bound private callback when caller options mutate", { timeout: 60000 }, async () => {
  const f = await fixture([{ value: "bad1", amount: "five" }, { value: "bad2", amount: "six", continue: true }, { value: "good", amount: "five" }], {
    cap: 2, mutateAdmission: true, onWrite: (context) => { if (context.attempt?.number === 2) budget(f.contexts[0]!)!.onExecutionCost({} as ExecutionCostReport); }
  });
  try { const result = await f.run(); assert.equal(result.acceptance.accepted, false); assert.equal(f.dispatches(), 2);
    assert.equal(result.loop?.stopReason, "cost-unavailable"); } finally { await f.session.shutdown(); }
});
