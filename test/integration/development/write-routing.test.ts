import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runDirectDevelopmentTask } from "../../../examples/direct-development-task.js";
import { ResourceRegistry } from "../../../src/adaptation/registry.js";
import { saveAdaptationRegistry } from "../../../src/adaptation/promotion.js";
import { routingPolicyContent, routingPolicyIdentity } from "../../../src/learning/learned-routing.js";
import { NativeWriteSession } from "../../../src/native/write-session.js";
import { createDevelopmentPiExecutorFactory } from "../../../src/pi-adapter/development-executor.js";
import { EventStore } from "../../../src/run/event-store.js";
import { readInvocationRecords } from "../../../src/telemetry/invocation-log.js";
import { isInvocation } from "../../../src/telemetry/model-invocation.js";
import { startLoopbackOpenAiProvider, type LoopbackScriptedResponse } from "../../helpers/loopback-openai-provider.js";

function model(id: string, cost = 1) {
  return { id, providerId: id.split("/")[0]!, version: "fixture-1", roles: ["actor" as const], maxComplexity: "HIGH" as const,
    capabilities: ["tool-use"], privacyClass: "cloud-general" as const, providerPolicy: "approved" as "approved" | "forbidden",
    contextWindow: 32000, maxOutputTokens: 4096, inputCostPerMTok: cost, outputCostPerMTok: cost,
    estimatedCostUsd: cost, estimatedDurationMs: 1, latencyMsPer1K: 1, approvedForHighRisk: true };
}
function routing(ids = ["alpha/high", "beta/low"]) {
  return { catalog: { policyVersion: "host-static-test", models: ids.map((id, i) => model(id, ids.length - i)) },
    modelPolicy: { allowedModels: [...ids] }, inputTokenReserve: 64, outputTokens: 128 };
}
const response = (n: number): LoopbackScriptedResponse => n % 3 === 1
  ? { toolCalls: [{ name: "sparkle_write_file", arguments: { path: "value.txt", contents: `after-${n}` } }] }
  : n % 3 === 2 ? { toolCalls: [{ name: "sparkle_report_task_result", arguments: { verification: "PASSED", summary: "updated" } }] }
    : { text: "done" };
async function fixture(body: (paths: { sourceRepo: string; stateRoot: string; sandboxRoot: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "static-write-routing-"));
  const sourceRepo = join(root, "repo"), stateRoot = join(root, "state"), sandboxRoot = join(root, "candidates");
  try {
    await mkdir(sourceRepo); await mkdir(sandboxRoot);
    for (const args of [["init"], ["config", "core.autocrlf", "false"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Routing Test"]]) {
      assert.equal(spawnSync("git", args, { cwd: sourceRepo, windowsHide: true }).status, 0);
    }
    await writeFile(join(sourceRepo, "value.txt"), "before", "utf8");
    assert.equal(spawnSync("git", ["add", "."], { cwd: sourceRepo, windowsHide: true }).status, 0);
    assert.equal(spawnSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"], { cwd: sourceRepo, windowsHide: true }).status, 0);
    await body({ sourceRepo, stateRoot, sandboxRoot });
  } finally { await rm(root, { force: true, recursive: true }); }
}
const verification = { command: process.execPath, args: ["-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8').startsWith('after-') ? 0 : 1)"] };

for (const stopAfterTaskResult of [false, true]) test(`opt-in host routes actual calls and preserves deadline with stop-after-report=${stopAfterTaskResult}`, async () => fixture(async (paths) => {
  const alpha = await startLoopbackOpenAiProvider({ modelIds: ["high"], scriptedResponse: response });
  const beta = await startLoopbackOpenAiProvider({ modelIds: ["low"], scriptedResponse: response });
  const previous = process.env.SPARKLE_STATIC_TEST_KEY;
  process.env.SPARKLE_STATIC_TEST_KEY = "beta-key";
  try {
    const registry = new ResourceRegistry();
    const version = registry.registerBaseline({ identity: routingPolicyIdentity(await realpath(paths.sourceRepo)),
      content: routingPolicyContent({ primaryModelId: "alpha/high", avoid: [], prefer: [{ family: "edit", modelId: "beta/low" }] }),
      author: { kind: "human", identity: "test-host" } });
    await saveAdaptationRegistry(paths.stateRoot, registry);
    const input = { ...paths, objective: "Update value.txt", verification,
      ...(stopAfterTaskResult ? { maxWallTimeMs: 600_000 } : {}),
      staticRouting: routing(), pi: { providerId: "alpha", modelId: "high", apiKey: "alpha-key", retry: { maxAttempts: 1 },
        ...(stopAfterTaskResult ? { stopAfterTaskResult: true } : {}),
        aliases: { low: { providerId: "alpha", modelId: "high" } },
        customProviders: [{ id: "alpha", baseUrl: alpha.baseUrl, models: [{ id: "high" }] },
          { id: "beta", baseUrl: beta.baseUrl, envVar: "SPARKLE_STATIC_TEST_KEY", models: [{ id: "low" }] }] }
    };
    Object.defineProperty(input, "staticRouting", { value: input.staticRouting, enumerable: false });
    const result = await runDirectDevelopmentTask(input);
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.equal(alpha.requests.length, 0, "default provider must not receive the routed task");
    assert.equal(beta.requests.length, stopAfterTaskResult ? 2 : 3);
    assert.ok(beta.requests.every((request) => request.authorization === "Bearer beta-key"));
    const events = (await new EventStore(paths.stateRoot, result.runId).readAll()).events;
    const requests = events.flatMap((event) => event.type === "CHILD_MESSAGE" &&
      event.payload.message.type === "TASK_REQUEST" ? [event.payload.message] : []);
    assert.equal(requests.length, 1);
    const expectedBudgetMs = stopAfterTaskResult ? 600_000 : 300_000;
    assert.deepEqual(requests[0]!.limits, { maxAttempts: 1, timeoutMs: expectedBudgetMs, maxWallTimeMs: expectedBudgetMs });
    const routed = events.filter((event) => event.type === "MODEL_ROUTED");
    assert.equal(routed.length, 1);
    assert.equal(routed[0]!.payload.model, "beta/low");
    assert.equal(routed[0]!.payload.routingPolicyResourceVersionId, version.versionId);
    assert.equal(routed[0]!.taskId, result.taskId);
    const invocations = (await readInvocationRecords(paths.stateRoot)).values;
    assert.ok(invocations.length > 0);
    for (const row of invocations) { assert.ok(isInvocation(row)); assert.equal(row.config.provider, "beta"); assert.equal(row.config.model, "low"); }
    assert.equal(await readFile(join(paths.sourceRepo, "value.txt"), "utf8"), "before");
  } finally {
    if (previous === undefined) delete process.env.SPARKLE_STATIC_TEST_KEY;
    else process.env.SPARKLE_STATIC_TEST_KEY = previous;
    await alpha.close(); await beta.close();
  }
}));

test("same selected model survives repair and input mutations; a reused session selects independently", async () => fixture(async (paths) => {
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["high", "low"], scriptedResponse: response });
  const identity = routingPolicyIdentity(await realpath(paths.sourceRepo));
  const oldRegistry = new ResourceRegistry();
  const oldVersion = oldRegistry.registerBaseline({ identity, content: routingPolicyContent({ primaryModelId: "alpha/high", avoid: [],
    prefer: [{ family: "edit", modelId: "alpha/low" }] }), author: { kind: "human", identity: "fixture" } });
  await saveAdaptationRegistry(paths.stateRoot, oldRegistry);
  const nextRegistry = new ResourceRegistry();
  nextRegistry.registerBaseline({ identity, content: routingPolicyContent({ primaryModelId: "alpha/high", avoid: [],
    prefer: [{ family: "edit", modelId: "alpha/high" }] }), author: { kind: "human", identity: "fixture" } });
  const firstInvocation = Promise.withResolvers<void>();
  const checkerRelease = join(paths.stateRoot, "checker-release");
  const factory = createDevelopmentPiExecutorFactory({ stateRoot: paths.stateRoot, providerId: "alpha", modelId: "high", apiKey: "local-key",
    onInvocation: () => firstInvocation.resolve(),
    customProviders: [{ id: "alpha", baseUrl: provider.baseUrl, models: [{ id: "high" }, { id: "low" }] }], retry: { maxAttempts: 1 } });
  const session = new NativeWriteSession({ ...paths, executorFactory: factory });
  try {
    const choice = routing(["alpha/high", "alpha/low"]);
    const first = session.execute({ sourceRepo: paths.sourceRepo, objective: "Update value.txt", staticRouting: choice, maxAttempts: 2,
      verification: { command: process.execPath, args: ["-e", `const fs=require('node:fs'); (async()=>{while(!fs.existsSync(${JSON.stringify(checkerRelease)})) await new Promise(r=>setTimeout(r,10));process.exit(fs.readFileSync('value.txt','utf8')==='after-4'?0:1)})()`] } });
    choice.modelPolicy.allowedModels.splice(0, 2, "alpha/high");
    choice.catalog.models[1]!.providerPolicy = "forbidden";
    await Promise.race([firstInvocation.promise, first.then(() => { throw new Error("worker stopped before its first invocation"); })]);
    // Change the approved fixture snapshot while the first checker is held.
    await saveAdaptationRegistry(paths.stateRoot, nextRegistry);
    await writeFile(checkerRelease, "continue", "utf8");
    const result = await first;
    assert.equal(result.acceptance.accepted, true, result.reason);
    assert.equal(result.loop?.attempts.length, 2);
    assert.ok(provider.requests.every((request) => (request.body as { model: string }).model === "low"));
    for (const attempt of result.loop!.attempts) {
      const events = (await new EventStore(paths.stateRoot, attempt.runId).readAll()).events;
      const event = events.find((row) => row.type === "MODEL_ROUTED");
      assert.equal(event?.payload.model, "alpha/low");
      assert.equal(event?.payload.routingPolicyResourceVersionId, oldVersion.versionId);
    }
    const before = provider.requests.length;
    const next = await session.execute({ sourceRepo: paths.sourceRepo, objective: "Update value.txt", verification, staticRouting: routing(["alpha/high", "alpha/low"]) });
    assert.equal(next.acceptance.accepted, true, next.reason);
    assert.ok(provider.requests.slice(before).every((request) => (request.body as { model: string }).model === "high"));
  } finally { await session.shutdown(); await provider.close(); }
}));

for (const mode of ["provider", "privacy", "capability", "context", "high-risk"] as const) test(`static host refuses ${mode} before HTTP dispatch`, async () => fixture(async (paths) => {
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["high"], scriptedResponse: response });
  try {
    const choice = routing(["alpha/high"]);
    if (mode === "provider") choice.catalog.models[0]!.providerPolicy = "forbidden";
    if (mode === "privacy") Object.assign(choice, { privacyRequired: "local" });
    if (mode === "capability") choice.catalog.models[0]!.capabilities = [];
    if (mode === "context") choice.catalog.models[0]!.contextWindow = 100;
    let error: unknown;
    try { await runDirectDevelopmentTask({ ...paths, objective: mode === "high-risk" ? "Deploy to production" : "Update value.txt", verification,
      staticRouting: choice, pi: { providerId: "alpha", modelId: "high", apiKey: "local", customProviders: [{ id: "alpha", baseUrl: provider.baseUrl, models: [{ id: "high" }] }] } }); }
    catch (caught) { error = caught; }
    assert.ok(error instanceof Error, "unsafe choice must refuse before executor dispatch");
    assert.equal(provider.requests.length, 0);
  } finally { await provider.close(); }
}));

test("repair context growth stops the selected model without moving to a larger alternative", async () => fixture(async (paths) => {
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["high", "low"], scriptedResponse: response });
  try {
    const choice = routing(["alpha/high", "alpha/low"]);
    // The 4096 ASCII-byte feedback alone exceeds this input capacity.
    choice.catalog.models[1]!.contextWindow = 1000;
    choice.catalog.models[1]!.maxOutputTokens = 512;
    const result = await runDirectDevelopmentTask({ ...paths, objective: "Update value.txt", staticRouting: choice, maxAttempts: 2,
      verification: { command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(4096));process.exit(1)"] },
      pi: { providerId: "alpha", modelId: "high", apiKey: "local", customProviders: [{ id: "alpha", baseUrl: provider.baseUrl, models: [{ id: "high" }, { id: "low" }] }] } });
    assert.equal(result.acceptance.accepted, false);
    assert.match(result.reason, /routing|context/i);
    assert.equal(provider.requests.length, 3, "only the first attempt may dispatch");
    assert.ok(provider.requests.every((request) => (request.body as { model: string }).model === "low"));
  } finally { await provider.close(); }
}));

test("actual grounded request capacity is checked after routing and before provider dispatch", async () => fixture(async (paths) => {
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["high"], scriptedResponse: response });
  try {
    const choice = routing(["alpha/high"]);
    choice.catalog.models[0]!.contextWindow = 370;
    choice.catalog.models[0]!.maxOutputTokens = 256;
    const result = await runDirectDevelopmentTask({ ...paths, objective: "Update value.txt", staticRouting: choice, verification,
      pi: { providerId: "alpha", modelId: "high", apiKey: "local", customProviders: [{ id: "alpha", baseUrl: provider.baseUrl, models: [{ id: "high" }] }] } });
    const events = (await new EventStore(paths.stateRoot, result.runId).readAll()).events;
    assert.ok(events.some((event) => event.type === "MODEL_ROUTED"), "initial selection should fit before grounding is added");
    assert.equal(result.acceptance.accepted, false);
    assert.equal(provider.requests.length, 0);
    assert.ok(events.some((event) => event.type === "RUN_FAILED" && /context/.test(event.payload.reason)), JSON.stringify(events));
  } finally { await provider.close(); }
}));

test("routed provider failure never invokes the configured fallback model", async () => fixture(async (paths) => {
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["high", "low"], scriptedResponse: () => ({ httpStatus: 503 }) });
  try {
    const result = await runDirectDevelopmentTask({ ...paths, objective: "Update value.txt", staticRouting: routing(["alpha/low"]), verification,
      pi: { providerId: "alpha", modelId: "high", apiKey: "local", fallbackModels: [{ providerId: "alpha", modelId: "high" }],
        retry: { maxAttempts: 1 }, customProviders: [{ id: "alpha", baseUrl: provider.baseUrl, models: [{ id: "high" }, { id: "low" }] }] } });
    assert.equal(result.acceptance.accepted, false);
    assert.equal(provider.requests.length, 1);
    assert.equal((provider.requests[0]!.body as { model: string }).model, "low");
  } finally { await provider.close(); }
}));

test("cancellation of a routed task starts no alternate model", async () => fixture(async (paths) => {
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["high", "low"], scriptedResponse: () => ({ text: "cancel" }) });
  try {
    const abort = new AbortController();
    const result = await runDirectDevelopmentTask({ ...paths, objective: "Update value.txt", staticRouting: routing(["alpha/low"]), verification,
      signal: abort.signal, pi: { providerId: "alpha", modelId: "high", apiKey: "local", onInvocation: () => abort.abort(),
        fallbackModels: [{ providerId: "alpha", modelId: "high" }], customProviders: [{ id: "alpha", baseUrl: provider.baseUrl, models: [{ id: "high" }, { id: "low" }] }] } });
    assert.equal(result.status, "CANCELLED");
    assert.equal(provider.requests.length, 1);
    assert.equal((provider.requests[0]!.body as { model: string }).model, "low");
  } finally { await provider.close(); }
}));
