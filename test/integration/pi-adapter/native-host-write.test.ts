import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentSystemPrompt, getCurrentTools,
  type Context, type Model, type Api, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createEventBus, createExtensionRuntime, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createSparkleExtension } from "../../../extensions/pi-sparkle/index.js";
import type { DevelopmentTaskSpec } from "../../../src/development/task-spec.js";

const HOST = "  HOST_WRITE_PROMPT\r\n中文  ";
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function definition(maxAttempts = 1): DevelopmentTaskSpec {
  return { version: 1, objective: "Repair value.txt using the owned tools", context: ["value.txt"],
    write: { allow: ["value.txt", "checks"], protect: ["checks"] }, prepare: [],
    checks: [{ id: "business", command: process.execPath, args: ["checks/business.cjs"], verifierVersion: "v1",
      protectedPaths: ["checks"], visibleToWorker: true, expect: { baseline: "fail", failureAssertion: "value-regression" } },
    { id: "private", command: process.execPath, args: ["checks/private.cjs"], verifierVersion: "v1", protectedPaths: ["checks"],
      visibleToWorker: false, expect: { baseline: "pass" } }],
    worker: { model: "inherit", maxAttempts }, budget: { totalSeconds: 30, prepareSeconds: 5, checkSeconds: 5, workerSeconds: 10 } };
}
async function fixture(config: { prompt?: string; resources?: boolean; repair?: boolean; refuseWrites?: boolean; thinkingBudgets?: boolean;
  paths?: "source-state" | "source-sandbox"; format?: "yaml" } = {}) {
  const parent = path.join(process.cwd(), ".agent_workspace", "phase1-host-task");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "command-"));
  const sourceRepo = path.join(root, "source"), stateRoot = path.join(root, "state"), sandboxRoot = path.join(root, "candidates");
  await mkdir(path.join(sourceRepo, "checks"), { recursive: true });
  await writeFile(path.join(sourceRepo, "value.txt"), "before", "utf8");
  await writeFile(path.join(sourceRepo, "outside.txt"), "outside protected by scope", "utf8");
  await writeFile(path.join(sourceRepo, "AGENTS.md"), "AMBIENT_AGENTS_MUST_NOT_ENTER_CHILD", "utf8");
  const checker = "if(require('node:fs').readFileSync('value.txt','utf8')!=='after'){console.log(JSON.stringify({assertion:'value-regression',outcome:'failed'}));process.exit(1)}";
  await writeFile(path.join(sourceRepo, "checks/business.cjs"), checker, "utf8");
  await writeFile(path.join(sourceRepo, "checks/private.cjs"), "console.error('HIDDEN_CHECK_OUTPUT_MUST_STAY_PRIVATE')", "utf8");
  git(sourceRepo, ["init", "-b", "fixture"]); git(sourceRepo, ["config", "core.autocrlf", "false"]);
  git(sourceRepo, ["config", "user.name", "Host fixture"]); git(sourceRepo, ["config", "user.email", "fixture@example.invalid"]);
  git(sourceRepo, ["add", "."]); git(sourceRepo, ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const revision = git(sourceRepo, ["rev-parse", "HEAD"]);
  const specPath = path.join(root, config.format === "yaml" ? "task with spaces.YML" : "task with spaces.json");
  await writeFile(specPath, (config.format === "yaml" ? stringify : JSON.stringify)(definition(config.repair ? 2 : 1)), "utf8");
  const faux = fauxProvider({ provider: "host-write", models: [{ id: "A", reasoning: true }, { id: "B", reasoning: true }] });
  const a = faux.getModel("A")!, b = faux.getModel("B")!, models = createModels(); models.setProvider(faux.provider);
  const wires: { context: Context; options: SimpleStreamOptions | undefined; model: Model<Api> }[] = [];
  const messages: unknown[] = [];
  const publishOptions: unknown[] = [];
  const runtime = createExtensionRuntime();
  runtime.sendMessage = (message, options) => { messages.push(message); publishOptions.push(options); };
  runtime.getThinkingLevel = () => "off";
  const thinkingBudgets = { low: 1234, high: 5678 }; let settingsReads = 0;
  runtime.getSettings = () => { settingsReads++; return config.thinkingBudgets ? { thinkingBudgets,
    get defaultProvider(): never { throw Error("unrelated host settings must not be read"); } } : {}; };
  let resourceCalls = 0;
  const approved = { contextFiles: [{ path: "host-label", text: "APPROVED_CONTEXT" }],
    skills: [{ name: "approved", description: "Approved skill", body: "APPROVED_BODY" }] };
  const ctx = { cwd: sourceRepo, model: a, scopedModels: [{ model: a }], thinkingLevel: "low", getSystemPrompt: () => config.prompt ?? HOST,
    signal: undefined, hasUI: false,
    // Reading any parent transcript would fail the actual command.
    get sessionManager(): never { throw new Error("PARENT_TRANSCRIPT_MUST_NOT_BE_READ"); },
    modelRegistry: { getAvailable: () => faux.models, streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
      wires.push({ context, options, model }); return models.streamSimple(model, context, options);
    } }
  };
  const { loadExtensionFromFactory } = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
  const extension = await loadExtensionFromFactory(createSparkleExtension({ task: {
    stateRoot: config.paths === "source-state" ? sourceRepo : stateRoot,
    sandboxRoot: config.paths === "source-sandbox" ? path.join(sourceRepo, "candidates") : sandboxRoot },
    ...(config.resources ? { approvedResources: () => {
      resourceCalls++; ctx.model = b; ctx.cwd = root; ctx.thinkingLevel = "high";
      if (config.thinkingBudgets) thinkingBudgets.low = 9999;
      queueMicrotask(() => { approved.contextFiles[0]!.text = "MUTATED_CONTEXT"; approved.skills[0]!.body = "MUTATED_BODY"; });
      return approved;
    } } : {})
  } as Parameters<typeof createSparkleExtension>[0]), sourceRepo, createEventBus(), runtime);
  const command = extension.commands.get("sparkle-task");
  assert.ok(command, "real extension loader must expose the user-only TaskSpec command");
  assert.deepEqual([...extension.tools.keys()].sort(), ["sparkle_apply_candidate", "sparkle_delegate"], "models cannot submit executable TaskSpecs");
  const run = (args = `"${specPath}"`) => command.handler(args, ctx as unknown as ExtensionCommandContext);
  const act = (action: "apply" | "discard", runId: string) => {
    const selected = extension.commands.get(`sparkle-task-${action}`);
    assert.ok(selected, "actual loader must expose the user lifecycle command");
    return selected.handler(runId, ctx as unknown as ExtensionCommandContext);
  };
  const shutdown = async () => { for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, ctx); };
  let calls = 0;
  faux.setResponses(Array.from({ length: 8 }, () => () => {
    calls++;
    if (config.refuseWrites && calls === 1) return fauxAssistantMessage([
      fauxToolCall("sparkle_write_file", { path: "outside.txt", contents: "bad" }),
      fauxToolCall("sparkle_patch_file", { path: "checks/business.cjs", oldText: "process.exit(1)", newText: "process.exit(0)" })
    ], { stopReason: "toolUse" });
    const writeCall = config.refuseWrites ? 2 : 1;
    if (calls === writeCall || (config.repair && calls === 3)) return fauxAssistantMessage(fauxToolCall(calls === 3 ? "sparkle_patch_file" : "sparkle_write_file",
      calls === 3 ? { path: "value.txt", oldText: "needs repair", newText: "after" }
        : { path: "value.txt", contents: config.repair ? "needs repair" : "after" }), { stopReason: "toolUse" });
    return fauxAssistantMessage(fauxToolCall("sparkle_report_task_result", { verification: "PASSED", summary: "worker report is not host acceptance" }), { stopReason: "toolUse" });
  }));
  return { root, sourceRepo, specPath, stateRoot, revision, checker, wires, messages, publishOptions, ctx, faux, run, act, shutdown, thinkingBudgets,
    get settingsReads() { return settingsReads; },
    get resourceCalls() { return resourceCalls; } };
}

for (const prompt of [HOST, ""]) test(`actual extension command executes an owned scoped writer with ${prompt ? "opaque" : "empty"} inherited prompt`, { timeout: 60000 }, async () => {
  const f = await fixture({ prompt, resources: true });
  try {
    await f.run();
    assert.equal(f.wires.length, 2, JSON.stringify(f.messages)); assert.equal(f.resourceCalls, 1);
    const result = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(result.type, "TASKSPEC_EXECUTION"); assert.equal(result.accepted, true); assert.equal(result.effectsSettled, true);
    assert.deepEqual(f.publishOptions, [{ triggerTurn: false }], "publishing evidence must not start another host model turn");
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "after");
    for (const wire of f.wires) {
      assert.equal(getCurrentSystemPrompt(wire.context.messages), prompt);
      assert.equal(wire.options?.reasoning, "low"); assert.equal(wire.model.id, "A");
      assert.deepEqual(getCurrentTools(wire.context.messages).map((tool) => tool.name).sort(),
        ["sparkle_list_files", "sparkle_patch_file", "sparkle_read_file", "sparkle_report_task_result", "sparkle_search_files", "sparkle_write_file"]);
      const text = JSON.stringify(wire.context.messages);
      assert.match(text, /APPROVED_CONTEXT/); assert.match(text, /APPROVED_BODY/);
      assert.doesNotMatch(text, /AMBIENT_AGENTS|MUTATED_|PARENT_TRANSCRIPT|HIDDEN_CHECK_OUTPUT/);
    }
    assert.doesNotMatch(JSON.stringify(f.messages), /HIDDEN_CHECK_OUTPUT/);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
    assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision); assert.equal(git(f.sourceRepo, ["status", "--porcelain"]), "");
  } finally { await f.shutdown(); }
});

for (const format of [undefined, "yaml"] as const) test(`actual user commands apply then discard only a held candidate without further model dispatch${format === undefined ? "" : " from YAML"}`, { timeout: 120000 }, async () => {
  const f = await fixture({ resources: true, ...(format === undefined ? {} : { format }) });
  try {
    await f.run();
    const run = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(run.accepted, true); assert.equal(run.managed, true);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
    await f.act("apply", run.runId);
    const applied = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(applied.status, "APPLIED", JSON.stringify(f.messages)); assert.equal(applied.reverified, true);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "after"); assert.equal(f.wires.length, 2);
    await f.act("discard", run.runId);
    const discarded = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(discarded.status, "DISPOSED", JSON.stringify(f.messages)); assert.equal(f.wires.length, 2);
    await assert.rejects(fs.access(run.candidatePath), { code: "ENOENT" }); await fs.access(run.artifactPath);
    assert.doesNotMatch(JSON.stringify(f.messages), /HIDDEN_CHECK_OUTPUT|APPROVED_BODY|HOST_WRITE_PROMPT/);
  } finally { await f.shutdown(); }
});

test("actual user lifecycle commands refuse foreign runIds without model or ownership reconstruction", { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    for (const action of ["apply", "discard"] as const) {
      await f.act(action, "run_foreign");
      assert.match(JSON.stringify(f.messages.at(-1)), /not held.*live/);
    }
    assert.equal(f.wires.length, 0); assert.equal(git(f.sourceRepo, ["rev-parse", "HEAD"]), f.revision);
  } finally { await f.shutdown(); }
});

test("actual command preserves scoped write and patch refusals and accepts only independently checked repair", { timeout: 60000 }, async () => {
  const f = await fixture({ refuseWrites: true });
  try {
    await f.run();
    const result = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(result.accepted, true, JSON.stringify(f.messages));
    assert.equal(await readFile(path.join(result.candidatePath, "outside.txt"), "utf8"), "outside protected by scope");
    assert.equal(await readFile(path.join(result.candidatePath, "checks/business.cjs"), "utf8"), f.checker);
    assert.match(JSON.stringify(f.wires), /outside task scope|protected verifier/);
  } finally { await f.shutdown(); }
});

test("actual command repairs the retained candidate with captured host resources and visible-only feedback", { timeout: 60000 }, async () => {
  const f = await fixture({ repair: true, resources: true });
  try {
    await f.run();
    const result = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(result.accepted, true, JSON.stringify(f.messages)); assert.equal(f.wires.length, 4); assert.equal(f.resourceCalls, 1);
    const repair = JSON.stringify(f.wires[2]!.context.messages);
    assert.match(repair, /worker-visible host check feedback/); assert.match(repair, /APPROVED_BODY/);
    assert.doesNotMatch(repair, /MUTATED_|HIDDEN_CHECK_OUTPUT/);
    assert.equal(await readFile(path.join(result.candidatePath, "value.txt"), "utf8"), "after");
  } finally { await f.shutdown(); }
});

test("actual TaskSpec admission captures only thinking budgets before a resource callback and reuses them for repair", { timeout: 60000 }, async () => {
  const f = await fixture({ repair: true, resources: true, thinkingBudgets: true });
  try {
    await f.run(); const result = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(result.accepted, true, JSON.stringify(f.messages)); assert.equal(f.settingsReads, 1); assert.equal(f.resourceCalls, 1);
    assert.equal(f.wires.length, 4);
    for (const wire of f.wires) { assert.equal(wire.options?.reasoning, "low"); assert.deepEqual(wire.options?.thinkingBudgets, { low: 1234, high: 5678 }); }
    assert.equal(f.thinkingBudgets.low, 9999); assert.equal(Object.isFrozen(f.thinkingBudgets), false);
  } finally { await f.shutdown(); }
});

test("user cancellation and extension shutdown wait for an actual held owned write to settle", { timeout: 60000 }, async () => {
  const f = await fixture();
  const cancellation = new AbortController();
  Object.assign(f.ctx, { signal: cancellation.signal });
  const held = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const originalWrite = fs.writeFile;
  let intercepted = false, stopped = false, running: Promise<void> | undefined, stopping: Promise<void> | undefined;
  fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => {
    const file = String(args[0]);
    if (!intercepted && file.endsWith(`${path.sep}value.txt`) && file !== path.join(f.sourceRepo, "value.txt")) {
      intercepted = true; held.resolve(); await release.promise;
    }
    return originalWrite(...args);
  }) as typeof fs.writeFile;
  syncBuiltinESMExports();
  try {
    running = f.run();
    assert.ok(running instanceof Promise, "the actual command must start and return its settlement promise");
    await Promise.race([held.promise, running.then(() => { throw new Error(`owned write was never held: ${JSON.stringify(f.messages)}`); })]);
    cancellation.abort(); stopping = f.shutdown().then(() => { stopped = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(stopped, false, "shutdown cannot abandon an executing child tool");
    assert.equal(f.messages.length, 0, "the command cannot publish before actual write settlement");
    release.resolve(); await Promise.all([running, stopping]);
    assert.equal(intercepted, true); assert.equal(stopped, true); assert.equal(f.wires.length, 1, "cancellation prevents another dispatch");
    const result = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.equal(result.accepted, false); assert.equal(result.effectsSettled, true);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
  } finally {
    release.resolve(); await Promise.allSettled([...(running === undefined ? [] : [running]), ...(stopping === undefined ? [] : [stopping])]);
    fs.writeFile = originalWrite; syncBuiltinESMExports(); await f.shutdown();
  }
});

for (const kind of ["missing-model", "scope", "malformed", "oversized", "linked", "preflight", "invalid-utf8", "extra-argument", "linked-parent",
  "source-state", "source-sandbox"] as const) test(`actual command refuses ${kind} without a provider dispatch`, { timeout: 60000 }, async () => {
  const f = await fixture(kind === "source-state" || kind === "source-sandbox" ? { paths: kind } : {});
  try {
    if (kind === "missing-model") Object.assign(f.ctx, { model: undefined });
    if (kind === "scope") f.ctx.scopedModels = [{ model: f.faux.getModel("B")! }];
    if (kind === "malformed") await writeFile(f.specPath, "{invalid", "utf8");
    if (kind === "invalid-utf8") await writeFile(f.specPath, Buffer.from([0xc3, 0x28]));
    if (kind === "oversized") await writeFile(f.specPath, " ".repeat(65537), "utf8");
    if (kind === "linked") { const target = path.join(f.root, "linked-target.json"); await writeFile(target, JSON.stringify(definition()), "utf8");
      await import("node:fs/promises").then(({ unlink }) => unlink(f.specPath)); await symlink(target, f.specPath); }
    if (kind === "preflight") await writeFile(f.specPath, JSON.stringify({ ...definition(), checks: [{ ...definition().checks[0]!, expect: { baseline: "pass" } }] }), "utf8");
    let args: string | undefined;
    if (kind === "extra-argument") args = `"${f.specPath}" extra`;
    if (kind === "linked-parent") { const linked = path.join(f.root, "linked-directory"); await symlink(path.dirname(f.specPath), linked, "junction");
      args = `"${path.join(linked, path.basename(f.specPath))}"`; }
    await f.run(args); assert.equal(f.wires.length, 0);
    const result = JSON.parse((f.messages.at(-1) as { content: string }).content);
    assert.ok(result.status === "refused" || result.accepted === false);
    assert.equal(await readFile(path.join(f.sourceRepo, "value.txt"), "utf8"), "before");
    assert.equal(git(f.sourceRepo, ["status", "--porcelain"]), "");
  } finally { await f.shutdown(); }
});
