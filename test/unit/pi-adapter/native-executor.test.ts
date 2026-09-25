import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createProvider } from "@earendil-works/pi-ai";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createNativeExecutor } from "../../../src/pi-adapter/native-executor.js";
import { createObservationProjector } from "../../../src/pi-adapter/observation-tools.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { NativeSession } from "../../../src/native/session.js";
import { buildNativeRoutingCatalog } from "../../../src/native/routing-catalog.js";
import { parseLearnedRoutingPolicy } from "../../../src/learning/learned-routing.js";
import { EventStore } from "../../../src/run/event-store.js";
import { adaptationRegistryPath } from "../../../src/adaptation/promotion.js";
import { startLoopbackOpenAiProvider } from "../../helpers/loopback-openai-provider.js";

test("native worker reuses host transport/auth and extension honors a non-empty multi-model scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-worker-"));
  await writeFile(join(root, "example.txt"), "native fixture");
  const server = await startLoopbackOpenAiProvider({ modelIds: ["native", "secondary"], scriptedResponse: (n) => n === 1
    ? { toolCalls: [{ name: "sparkle_read_file", arguments: { path: "example.txt" } }] }
    : { text: "read complete" } });
  try {
    const model = { id: "native", provider: "host", name: "Native", api: "openai-completions" as const,
      baseUrl: server.baseUrl, reasoning: false, input: ["text" as const], contextWindow: 8192, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const secondaryModel = { ...model, id: "secondary", name: "Secondary" };
    const outsideScopeModel = { ...model, id: "outside-scope", name: "Outside scope" };
    const provider = createProvider({ id: "host", models: [model, secondaryModel], auth: { apiKey: {
      name: "must not be used", resolve: async () => { throw new Error("bypassed host auth"); }
    } }, api: openAICompletionsApi() });
    let authCalls = 0;
    const executor = createNativeExecutor({
      projectRoot: root,
      defaultModel: model,
      models: [model],
      streamSimple: (selected, context, options) => {
        authCalls++;
        return provider.streamSimple(selected as typeof model, context as never, { ...options, apiKey: "loopback-only" });
      }
    });
    const events = [];
    for await (const event of executor.execute({ runId: createRunId(), taskId: createTaskId(),
      agentInstanceId: createAgentInstanceId(), workingDirectory: root, prompt: "Read example.txt" }, new AbortController().signal)) events.push(event);
    assert.ok(authCalls > 0);
    assert.ok(events.some((e) => e.type === "TOOL_FINISHED" && !e.isError));
    assert.equal(await readFile(join(root, "example.txt"), "utf8"), "native fixture");
    const wire = JSON.stringify(server.requests);
    assert.match(wire, /native fixture/);
    assert.doesNotMatch(wire, /sparkle_write_file|sparkle_run_command|sparkle_spawn/);
    assert.equal(server.protocolErrors.length, 0);

    // Invoke the registered public tool through Pi's real loader, with only
    // the host context substituted. Provider traffic remains real loopback.
    const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const { loadExtensions } = await import(loaderUrl.href);
    const loaded = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], root);
    assert.deepEqual(loaded.errors, []);
    const tool = loaded.extensions[0].tools.get("sparkle_delegate").definition;
    let registryAuthReads = 0;
    const result = await tool.execute("call-native", { tasks: [{ role: "scout", objective: "Inspect example.txt" }], model: "host/native" },
      new AbortController().signal, undefined, {
        cwd: root, scopedModels: [{ model }, { model: secondaryModel }], modelRegistry: {
          getAvailable: () => [model, secondaryModel, outsideScopeModel], getProvider: () => provider,
          getApiKeyAndHeaders: async () => {
            registryAuthReads++;
            return { ok: true, apiKey: "must-not-cross-native-bridge" };
          },
          streamSimple: (selected: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
            provider.streamSimple(selected as typeof model, context as never, { ...options, apiKey: "loopback-only" })
        }
      });
    assert.match(result.details.runId, /^run_/);
    assert.equal(result.details.independentVerification, "UNOBSERVED");
    assert.match(result.content[0].text, /not independently verified/);
    assert.ok(server.requests.length > 2, "registered tool must actually execute a worker");
    assert.equal(registryAuthReads, 0, "extension must leave credentials inside host streamSimple");
    assert.doesNotMatch(JSON.stringify(server.requests), /outside-scope/, "scope-excluded models must not enter dispatch");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native read wrapper never archives credential-like paths even after repeated reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-worker-secret-projection-"));
  const stateRoot = join(root, "state");
  const secretText = `API_KEY=sk-abcdefghijklmnop\n${"padding".repeat(2_000)}`;
  await writeFile(join(root, ".env.production"), secretText);
  const server = await startLoopbackOpenAiProvider({
    modelIds: ["native"],
    scriptedResponse: (requestNumber) => requestNumber <= 3
      ? { toolCalls: [{ name: "sparkle_read_file", arguments: { path: ".env.production" } }] }
      : { text: "inspection complete" }
  });
  try {
    const model = { id: "native", provider: "host", name: "Native", api: "openai-completions" as const,
      baseUrl: server.baseUrl, reasoning: false, input: ["text" as const], contextWindow: 32_768, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const provider = createProvider({ id: "host", models: [model], auth: { apiKey: {
      name: "unused", resolve: async () => { throw new Error("host registry owns auth"); }
    } }, api: openAICompletionsApi() });
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    const executor = createNativeExecutor({
      projectRoot: root,
      defaultModel: model,
      models: [model],
      observationProjector: projector,
      streamSimple: (selected, context, options) =>
        provider.streamSimple(selected as typeof model, context as never, { ...options, apiKey: "loopback-only" })
    });
    const session = new NativeSession();
    const result = await session.delegate({
      projectRoot: root,
      stateRoot,
      model,
      executor,
      observationProjector: projector,
      tasks: [{ role: "scout", objective: "Read .env.production three times" }]
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(projector.refs.size, 0);
    assert.equal(projector.mechanism.projectionBytes, 0);
    await assert.rejects(
      () => readdir(join(stateRoot, "runtime", "runs", result.runId, "observations")),
      /ENOENT/
    );
    await session.shutdown();
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native read wrapper classifies the canonical target of an in-root directory alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-worker-secret-alias-"));
  const stateRoot = join(root, "state");
  const secretsDir = join(root, "secrets");
  await mkdir(secretsDir, { recursive: true });
  await writeFile(join(secretsDir, "vault.dat"), "ordinary-text-".repeat(2_000), "utf8");
  symlinkSync(secretsDir, join(root, "public-cache"), process.platform === "win32" ? "junction" : "dir");
  const server = await startLoopbackOpenAiProvider({
    modelIds: ["native"],
    scriptedResponse: (requestNumber) => requestNumber <= 3
      ? { toolCalls: [{ name: "sparkle_read_file", arguments: { path: "public-cache/vault.dat" } }] }
      : { text: "inspection complete" }
  });
  try {
    const model = { id: "native", provider: "host", name: "Native", api: "openai-completions" as const,
      baseUrl: server.baseUrl, reasoning: false, input: ["text" as const], contextWindow: 32_768, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const provider = createProvider({ id: "host", models: [model], auth: { apiKey: {
      name: "unused", resolve: async () => { throw new Error("host registry owns auth"); }
    } }, api: openAICompletionsApi() });
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    const executor = createNativeExecutor({
      projectRoot: root, defaultModel: model, models: [model], observationProjector: projector,
      streamSimple: (selected, context, options) =>
        provider.streamSimple(selected as typeof model, context as never, { ...options, apiKey: "loopback-only" })
    });
    const session = new NativeSession();
    const result = await session.delegate({
      projectRoot: root, stateRoot, model, executor, observationProjector: projector,
      tasks: [{ role: "scout", objective: "Read public-cache/vault.dat three times" }]
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(projector.refs.size, 0);
    assert.equal(projector.mechanism.projectionBytes, 0);
    await assert.rejects(() => readdir(join(stateRoot, "runtime", "runs", result.runId, "observations")), /ENOENT/);
    await session.shutdown();
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native extension fails closed on a corrupt learned-routing registry before run or provider work", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-corrupt-routing-"));
  const stateRoot = join(root, ".agent_workspace", "pi-sparkle");
  const registryPath = adaptationRegistryPath(stateRoot);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, "{corrupt", "utf8");
  try {
    const makeModel = (id: string): Model<"openai-completions"> => ({
      id, provider: "host", name: id, api: "openai-completions",
      baseUrl: "http://127.0.0.1/unused", reasoning: false, input: ["text"],
      contextWindow: 8192, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    });
    const primary = makeModel("primary");
    const secondary = makeModel("secondary");
    const loaderUrl = new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const { loadExtensions } = await import(loaderUrl.href);
    const loaded = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], root);
    assert.deepEqual(loaded.errors, []);
    const tool = loaded.extensions[0].tools.get("sparkle_delegate").definition;
    let providerCalls = 0;
    await assert.rejects(
      () => tool.execute("corrupt-routing", {
        tasks: [{ role: "scout", objective: "Inspect" }], model: "host/primary"
      }, new AbortController().signal, undefined, {
        cwd: root,
        scopedModels: [{ model: primary }, { model: secondary }],
        modelRegistry: {
          getAvailable: () => [primary, secondary],
          getProvider: () => undefined,
          getApiKeyAndHeaders: async () => ({ ok: false as const, error: "unused" }),
          streamSimple: () => {
            providerCalls += 1;
            throw new Error("provider must not start");
          }
        }
      }),
      /invalid registry snapshot/
    );
    assert.equal(providerCalls, 0);
    await assert.rejects(() => readdir(join(stateRoot, "runtime")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cheap learned preference dispatches the canonical secondary through host streamSimple", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-multi-model-"));
  const primaryServer = await startLoopbackOpenAiProvider({ modelIds: ["primary"] });
  const secondaryServer = await startLoopbackOpenAiProvider({
    modelIds: ["secondary"],
    scriptedResponse: (requestNumber) => requestNumber === 1 ? {
      toolCalls: [{
        name: "sparkle_report_task_result",
        arguments: { verification: "PASSED", summary: "reviewed the boundary" }
      }]
    } : { text: "done" }
  });
  try {
    const makeModel = (provider: string, id: string, baseUrl: string): Model<"openai-completions"> => ({
      id, provider, name: id, api: "openai-completions", baseUrl, reasoning: false,
      input: ["text"], contextWindow: 8192, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    });
    const primary = makeModel("provider-a", "primary", primaryServer.baseUrl);
    const secondary = makeModel("provider-b", "secondary", secondaryServer.baseUrl);
    primary.headers = { Authorization: "Bearer primary-secret" };
    secondary.headers = { Authorization: "Bearer secondary-secret" };
    const providers = new Map([
      [primary.provider, createProvider({ id: primary.provider, models: [primary], auth: { apiKey: {
        name: "unused", resolve: async () => { throw new Error("host registry owns auth"); }
      } }, api: openAICompletionsApi() })],
      [secondary.provider, createProvider({ id: secondary.provider, models: [secondary], auth: { apiKey: {
        name: "unused", resolve: async () => { throw new Error("host registry owns auth"); }
      } }, api: openAICompletionsApi() })]
    ]);
    const dispatched: Array<{
      ref: string;
      inputCost: number;
      sameHostModel: boolean;
      authorization: string | undefined;
      frozen: boolean;
      costFrozen: boolean;
      headersFrozen: boolean;
    }> = [];
    const executor = createNativeExecutor({
      projectRoot: root,
      defaultModel: primary,
      models: [primary, secondary],
      streamSimple: (model, context, options) => {
        dispatched.push({
          ref: `${model.provider}/${model.id}`,
          inputCost: model.cost.input,
          sameHostModel: model === secondary,
          authorization: model.headers?.Authorization,
          frozen: Object.isFrozen(model),
          costFrozen: Object.isFrozen(model.cost),
          headersFrozen: Object.isFrozen(model.headers)
        });
        return providers.get(model.provider)!.streamSimple(model as Model<"openai-completions">, context as never, {
          ...options,
          apiKey: `auth-for-${model.provider}`
        });
      }
    });

    assert.deepEqual(executor.supportedModelIds, ["provider-a/primary", "provider-b/secondary"]);
    assert.equal(Object.isFrozen(executor.supportedModelIds), true);
    assert.throws(() => (executor.supportedModelIds as string[]).push("provider-c/forced"), TypeError);
    const primaryRef = `${primary.provider}/${primary.id}`;
    const secondaryRef = `${secondary.provider}/${secondary.id}`;
    const catalog = buildNativeRoutingCatalog(
      [{ ref: primaryRef, preferred: true }, { ref: secondaryRef }],
      { primary: primaryRef, fast: secondaryRef }
    );
    const learned = parseLearnedRoutingPolicy(JSON.stringify({
      primaryModelId: "premium",
      avoid: [],
      prefer: [{ family: "review", modelId: "cheap" }]
    }));
    const mutableSecondary = secondary as unknown as {
      provider: string;
      id: string;
      cost: { input: number };
      headers: Record<string, string>;
    };
    mutableSecondary.cost.input = 999;
    assert.equal(Object.isFrozen(secondary), false, "bridge must not freeze the caller's model object");
    const session = new NativeSession();
    const result = await session.delegate({
      projectRoot: root,
      stateRoot: join(root, "state"),
      model: { provider: "provider-a", id: "primary" },
      tasks: [{ role: "reviewer", objective: "Review the boundary" }],
      executor,
      routing: { catalog, learned }
    });

    assert.equal(result.status, "COMPLETED");
    assert.ok(dispatched.length >= 1);
    assert.ok(dispatched.every((entry) => entry.ref === secondaryRef));
    assert.ok(dispatched.every((entry) => entry.inputCost === 999));
    assert.ok(dispatched.every((entry) => entry.sameHostModel));
    assert.ok(dispatched.every((entry) => entry.authorization === "Bearer secondary-secret"));
    assert.ok(dispatched.every((entry) => !entry.frozen && !entry.costFrozen && !entry.headersFrozen));
    assert.equal(primaryServer.requests.length, 0);
    assert.ok(secondaryServer.requests.length >= 1);
    assert.equal(secondaryServer.protocolErrors.length, 0);
    const events = (await new EventStore(join(root, "state"), result.runId).readAll()).events;
    const routed = events.filter((event) => event.type === "MODEL_ROUTED");
    assert.deepEqual(routed.map((event) => (event.payload as { model: string }).model), [secondaryRef]);
    assert.ok(routed.every((event) => !(event.payload as { eligibleModels: readonly string[] }).eligibleModels.includes("cheap")));
    assert.match(result.text, /Models: provider-b\/secondary/);
    await session.shutdown();
  } finally {
    await Promise.all([primaryServer.close(), secondaryServer.close()]);
    await rm(root, { recursive: true, force: true });
  }
});

test("native bridge rejects host model providers containing a slash", () => {
  const malformed = {
    id: "model",
    provider: "provider/child",
    name: "Malformed",
    api: "openai-completions" as const,
    baseUrl: "http://127.0.0.1/unused",
    reasoning: false,
    input: ["text" as const],
    contextWindow: 8192,
    maxTokens: 512,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  assert.throws(() => createNativeExecutor({
    projectRoot: process.cwd(),
    defaultModel: malformed,
    models: [malformed],
    streamSimple: () => { throw new Error("must not dispatch"); }
  }), /provider.*slash|providerId.*contain|canonical/i);
});

test("native bridge does not read or clone host model headers while building its capability snapshot", () => {
  const model = {
    id: "model", provider: "provider", name: "Model", api: "openai-completions" as const,
    baseUrl: "http://127.0.0.1/unused", reasoning: false, input: ["text" as const],
    contextWindow: 8192, maxTokens: 512,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  } as Model<Api>;
  Object.defineProperty(model, "headers", {
    enumerable: true,
    get() { throw new Error("headers must stay host-owned"); }
  });
  const executor = createNativeExecutor({
    projectRoot: process.cwd(), defaultModel: model, models: [model],
    streamSimple: () => { throw new Error("unused"); }
  });
  assert.deepEqual(executor.supportedModelIds, ["provider/model"]);
});

test("native bridge rejects non-canonical default model components even when the formatted ref is eligible", () => {
  const eligible = {
    id: "model",
    provider: "provider",
    name: "Eligible",
    api: "openai-completions" as const,
    baseUrl: "http://127.0.0.1/unused",
    reasoning: false,
    input: ["text" as const],
    contextWindow: 8192,
    maxTokens: 512,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  const create = (defaultModel: typeof eligible) => createNativeExecutor({
    projectRoot: process.cwd(),
    defaultModel,
    models: [eligible],
    streamSimple: () => { throw new Error("must not dispatch"); }
  });

  assert.throws(() => create({ ...eligible, provider: " provider" }), /default.*canonical|component.*whitespace/i);
  assert.throws(() => create({ ...eligible, id: "model " }), /default.*canonical|component.*whitespace/i);
});

test("native bridge converts a synchronous host streamSimple throw into execution failure", async () => {
  const model = {
    id: "model",
    provider: "provider",
    name: "Model",
    api: "openai-completions" as const,
    baseUrl: "http://127.0.0.1/unused",
    reasoning: false,
    input: ["text" as const],
    contextWindow: 8192,
    maxTokens: 512,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  const executor = createNativeExecutor({
    projectRoot: process.cwd(),
    defaultModel: model,
    models: [model],
    streamSimple: () => { throw new Error("synchronous host stream failure"); }
  });
  const events = [];
  for await (const event of executor.execute({
    runId: createRunId(),
    taskId: createTaskId(),
    agentInstanceId: createAgentInstanceId(),
    workingDirectory: process.cwd(),
    prompt: "Inspect"
  }, new AbortController().signal)) events.push(event);

  assert.ok(events.some((event) => event.type === "EXECUTION_FINISHED" && event.outcome === "FAILURE"));
});
