import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createNativeExecutor } from "../../../src/pi-adapter/native-executor.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import { startLoopbackOpenAiProvider } from "../../helpers/loopback-openai-provider.js";

test("native worker reuses host transport/auth and can read but cannot write or run commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-worker-"));
  await writeFile(join(root, "example.txt"), "native fixture");
  const server = await startLoopbackOpenAiProvider({ modelIds: ["native"], scriptedResponse: (n) => n === 1
    ? { toolCalls: [{ name: "sparkle_read_file", arguments: { path: "example.txt" } }] }
    : { text: "read complete" } });
  try {
    const model = { id: "native", provider: "host", name: "Native", api: "openai-completions" as const,
      baseUrl: server.baseUrl, reasoning: false, input: ["text" as const], contextWindow: 8192, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const provider = createProvider({ id: "host", models: [model], auth: { apiKey: {
      name: "must not be used", resolve: async () => { throw new Error("bypassed host auth"); }
    } }, api: openAICompletionsApi() });
    let authCalls = 0;
    const executor = createNativeExecutor({ projectRoot: root, model, provider,
      resolveAuth: async () => { authCalls++; return { ok: true, apiKey: "loopback-only" }; } });
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
    const result = await tool.execute("call-native", { tasks: [{ role: "scout", objective: "Inspect example.txt" }], model: "host/native" },
      new AbortController().signal, undefined, {
        cwd: root, scopedModels: [], modelRegistry: {
          getAvailable: () => [model], getProvider: () => provider,
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "loopback-only" })
        }
      });
    assert.match(result.details.runId, /^run_/);
    assert.equal(result.details.independentVerification, "UNOBSERVED");
    assert.match(result.content[0].text, /not independently verified/);
    assert.ok(server.requests.length > 2, "registered tool must actually execute a worker");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
