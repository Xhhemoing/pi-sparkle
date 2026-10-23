import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { NativeDelegateResult } from "../../../src/native/session.js";
import { createNativeExecutor } from "../../../src/pi-adapter/native-executor.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { ExecutionEvent } from "../../../src/execution/contract.js";

type PackageManifest = {
  name: string;
  version: string;
  exports: Record<string, string | { import: string }>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
type ResolvedPackage = {
  manifest: PackageManifest;
  packageJson: string;
  entryUrl: string;
};

// Resolve from the SDK's real package location, never from the app's root AI.
// Reading the manifest also records both declared ranges and actual versions:
// an SDK ^1.2 dependency can otherwise silently resolve to 1.4 in a matrix lane.
async function resolvePackage(specifier: string, base: string): Promise<ResolvedPackage> {
  const located = findPackageJSON(specifier, base);
  assert.ok(located, `cannot resolve ${specifier} from ${base}`);
  const packageJson = await realpath(located);
  const manifest = JSON.parse(await readFile(packageJson, "utf8")) as PackageManifest;
  assert.equal(manifest.name, specifier);
  const rootExport = manifest.exports["."];
  assert.ok(rootExport, `public package entry is missing for ${specifier}`);
  const exported = typeof rootExport === "string" ? rootExport : rootExport.import;
  const entry = await realpath(join(dirname(packageJson), exported));
  return { manifest, packageJson, entryUrl: pathToFileURL(entry).href };
}

async function hostPackages(t: TestContext) {
  const sdk = await resolvePackage("@earendil-works/pi-coding-agent", import.meta.url);
  const appBase = pathToFileURL(join(process.cwd(), "src/pi-adapter/pi-executor.ts")).href;
  const [hostAi, hostCore, appAi, appCore] = await Promise.all([
    resolvePackage("@earendil-works/pi-ai", sdk.entryUrl),
    resolvePackage("@earendil-works/pi-agent-core", sdk.entryUrl),
    resolvePackage("@earendil-works/pi-ai", appBase),
    resolvePackage("@earendil-works/pi-agent-core", appBase)
  ]);
  t.diagnostic(JSON.stringify({
    packages: Object.entries({ sdk, hostAi, hostCore, appAi, appCore }).map(([role, installed]) => ({
      role, name: installed.manifest.name, version: installed.manifest.version,
      declaredAi: installed.manifest.dependencies?.["@earendil-works/pi-ai"],
      declaredCore: installed.manifest.dependencies?.["@earendil-works/pi-agent-core"],
      packageJson: installed.packageJson, entryUrl: installed.entryUrl
    })),
    note: "faux usage is synthetic provider telemetry; zero fixture prices are not billing evidence"
  }));
  const app = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as PackageManifest;
  const declaredSdk = app.devDependencies?.["@earendil-works/pi-coding-agent"];
  assert.ok(declaredSdk, "compatibility suite requires an explicitly declared dev SDK version");
  assert.equal(sdk.manifest.version, declaredSdk, "actual SDK must match the declared matrix dev SDK");
  assert.equal(hostAi.manifest.version, declaredSdk, "actual SDK-side AI must match the matrix host version");
  assert.equal(hostCore.manifest.version, declaredSdk, "actual SDK-side core must match the matrix host version");
  for (const installed of [appAi, appCore]) {
    assert.equal(installed.manifest.version, app.dependencies?.[installed.manifest.name],
      "actual app package must match its exact root dependency pin");
  }
  if (hostAi.manifest.version !== appAi.manifest.version) {
    assert.notEqual(hostAi.entryUrl, appAi.entryUrl, "mixed lane must load distinct host/app AI packages");
    assert.notEqual(hostCore.entryUrl, appCore.entryUrl, "mixed lane must load distinct host/app core packages");
  }
  const ai = await import(hostAi.entryUrl) as typeof import("@earendil-works/pi-ai");
  const transcriptExport = hostAi.manifest.exports["./utils/*"];
  assert.ok(transcriptExport, "host AI must publicly export its transcript utilities");
  const transcriptPattern = typeof transcriptExport === "string" ? transcriptExport : transcriptExport.import;
  const transcriptPath = await realpath(join(dirname(hostAi.packageJson), transcriptPattern.replace("*", "transcript")));
  const { getCurrentTools } = await import(pathToFileURL(transcriptPath).href) as typeof import("@earendil-works/pi-ai/utils/transcript");
  t.diagnostic(`actual host transcript utilities: ${transcriptPath}`);
  const loaderUrl = new URL("./core/extensions/loader.js", sdk.entryUrl);
  t.diagnostic(`actual SDK loader: ${await realpath(fileURLToPath(loaderUrl))}`);
  const { loadExtensions } = await import(loaderUrl.href);
  return { ai, getCurrentTools, loadExtensions };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const { ai, getCurrentTools, loadExtensions } = await hostPackages(t);
  const parent = join(process.cwd(), ".agent_workspace", "host-compat");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "native-"));
  await writeFile(join(root, "fixture.txt"), "synthetic host compatibility fixture", "utf8");
  const loaded = await loadExtensions([join(process.cwd(), "extensions/pi-sparkle/index.ts")], root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  const tool = extension.tools.get("sparkle_delegate")?.definition;
  assert.ok(tool, "real SDK loader must register the real delegate handler");
  const faux = ai.fauxProvider({ provider: "host-compat-fixture", models: [{ id: "read-only" }] });
  const models = ai.createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const replies: AssistantMessage[] = [];
  const responseSettlements: Promise<void>[] = [];
  let dispatches = 0;
  let authReads = 0;
  const ctx = {
    cwd: root, model, scopedModels: [{ model }],
    modelRegistry: {
      getAvailable: () => faux.models,
      getApiKeyAndHeaders: async () => { authReads++; throw new Error("host bridge owns credentials"); },
      streamSimple(selected: Model<string>, context: Context, options?: SimpleStreamOptions) {
        dispatches++;
        assert.equal(selected, model, "dispatch must reuse the exact host model object");
        assert.equal(selected.provider, "host-compat-fixture");
        assert.equal(selected.id, "read-only");
        assert.ok(options?.signal, "native worker forwards its cancellation signal to host transport");
        assert.deepEqual(getCurrentTools(context.messages).map((entry) => entry.name).sort(), [
          "sparkle_read_file", "sparkle_report_task_result"
        ], "native delegate exposes only read/report tools");
        const stream = models.streamSimple(selected, context, options);
        // Observe the same actual host response without consuming its iterator.
        // No default-to-zero usage or substitute root-AI provider is involved.
        responseSettlements.push(stream.result().then((reply) => { replies.push(reply); }));
        return stream;
      }
    }
  };
  const shutdown = async () => {
    for (const handler of extension.handlers.get("session_shutdown") ?? []) {
      await handler({ type: "session_shutdown" }, ctx);
    }
  };
  const delegate = (signal?: AbortSignal) => tool.execute("host-compat", {
    tasks: [{ role: "scout", objective: "Inspect fixture.txt and report the synthetic finding" }],
    model: `${model.provider}/${model.id}`
  }, signal, undefined, ctx) as Promise<{ details: NativeDelegateResult }>;
  const cleanup = async () => {
    await shutdown();
    await Promise.all(responseSettlements);
    assert.equal(authReads, 0, "native bridge must not pull host credentials");
    assert.equal(await readFile(join(root, "fixture.txt"), "utf8"), "synthetic host compatibility fixture");
    // root is exactly this test's mkdtemp result, never a shared/repo directory.
    await rm(root, { recursive: true, force: true });
  };
  return { ai, faux, root, model, replies, responseSettlements, delegate, shutdown, cleanup,
    dispatches: () => dispatches, streamSimple: ctx.modelRegistry.streamSimple };
}

test("SDK-host AI dispatch reaches actual read/report handlers with reported usage", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  try {
    f.faux.setResponses([
      f.ai.fauxAssistantMessage(f.ai.fauxToolCall("sparkle_read_file", { path: "fixture.txt" })),
      (context) => {
        const result = context.messages.find((message) => message.role === "toolResult" && message.toolName === "sparkle_read_file");
        assert.ok(result, "real read tool result must return through the host context");
        assert.match(JSON.stringify(result), /synthetic host compatibility fixture/);
        return f.ai.fauxAssistantMessage(f.ai.fauxToolCall("sparkle_report_task_result", {
          verification: "PASSED", summary: "fixture.txt contains the synthetic host compatibility fixture"
        }));
      },
      f.ai.fauxAssistantMessage("Inspection complete")
    ]);
    const result = await f.delegate();
    await Promise.all(f.responseSettlements);
    assert.equal(result.details.status, "COMPLETED");
    assert.equal(result.details.independentVerification, "UNOBSERVED");
    assert.equal(result.details.results.length, 1);
    assert.equal(result.details.results[0]?.summary, "fixture.txt contains the synthetic host compatibility fixture");
    assert.equal(f.dispatches(), 3, "read, report and final response must all use the host dispatcher");
    assert.equal(f.faux.state.callCount, 3);
    assert.equal(f.replies.length, 3);
    for (const reply of f.replies) {
      assert.equal(reply.provider, f.model.provider);
      assert.equal(reply.model, f.model.id);
      assert.ok(Number.isInteger(reply.usage.input) && reply.usage.input > 0, "host response must actually report input usage");
      assert.ok(Number.isInteger(reply.usage.output) && reply.usage.output > 0, "host response must actually report output usage");
    }
    // Native run evidence must contain the child's actual submitted report,
    // rather than proving only the in-memory public return shape.
    const eventsPath = join(f.root, ".agent_workspace", "pi-sparkle", "runtime", "runs", result.details.runId, "events.jsonl");
    const events = (await readFile(eventsPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      type: string; payload: { message?: { type: string; summary?: string } };
    });
    assert.ok(events.some((event) => event.type === "CHILD_MESSAGE"
      && event.payload.message?.type === "TASK_RESULT"
      && event.payload.message.summary === result.details.results[0]?.summary));
  } finally {
    await f.cleanup();
  }
});

test("actual SDK-host usage crosses the app native executor into TURN_FINISHED events", { timeout: 30_000 }, async (t) => {
  const f = await fixture(t);
  try {
    f.faux.setResponses([
      f.ai.fauxAssistantMessage(f.ai.fauxToolCall("sparkle_report_task_result", {
        verification: "PASSED", summary: "synthetic usage bridge observed"
      })),
      f.ai.fauxAssistantMessage("Synthetic usage bridge complete")
    ]);
    // The public native result intentionally has no usage field and its event
    // store drops TURN_FINISHED usage. Observe the real app executor's event
    // boundary separately, still dispatching through the SDK-local host AI.
    const executor = createNativeExecutor({
      projectRoot: f.root, defaultModel: f.model, models: [f.model], streamSimple: f.streamSimple
    });
    const events: ExecutionEvent[] = [];
    for await (const event of executor.execute({
      runId: createRunId(), taskId: createTaskId(), agentInstanceId: createAgentInstanceId(),
      workingDirectory: f.root, prompt: "Report the synthetic usage bridge result"
    }, new AbortController().signal)) events.push(event);
    await Promise.all(f.responseSettlements);
    assert.deepEqual(events.at(-1), { type: "EXECUTION_FINISHED", outcome: "SUCCESS" });
    assert.equal(f.dispatches(), 2);
    const turns = events.filter((event) => event.type === "TURN_FINISHED");
    assert.equal(turns.length, 2);
    assert.equal(f.replies.length, turns.length);
    for (const [index, turn] of turns.entries()) {
      const reply = f.replies[index]!;
      assert.ok(reply.usage.input > 0);
      assert.ok(reply.usage.output > 0);
      assert.equal(turn.usage?.inputTokens, reply.usage.input, "actual host input usage must reach the app's event boundary");
      assert.equal(turn.usage?.outputTokens, reply.usage.output, "actual host output usage must reach the app's event boundary");
      assert.equal(turn.usage?.cacheReadTokens, reply.usage.cacheRead > 0 ? reply.usage.cacheRead : undefined);
    }
    assert.ok(events.some((event) => event.type === "MESSAGE" && event.message.type === "TASK_RESULT"
      && event.message.summary === "synthetic usage bridge observed"));
  } finally {
    await f.cleanup();
  }
});
for (const cancellation of ["handler", "shutdown"] as const) {
  test(`SDK-host ${cancellation} cancellation waits for a held actual host response to settle`, { timeout: 30_000 }, async (t) => {
    const f = await fixture(t);
    const entered = deferred();
    const cancelled = deferred();
    const release = deferred();
    let providerSettled = false;
    let returned = false;
    let closed = false;
    let pending: ReturnType<typeof f.delegate> | undefined;
    let closing: Promise<void> | undefined;
    try {
      f.faux.setResponses([async (_context, options) => {
        assert.ok(options?.signal);
        if (options.signal.aborted) cancelled.resolve();
        else options.signal.addEventListener("abort", cancelled.resolve, { once: true });
        entered.resolve();
        await release.promise;
        providerSettled = true;
        return f.ai.fauxAssistantMessage("held synthetic response released");
      }]);
      const abort = new AbortController();
      pending = f.delegate(abort.signal).then((result) => { returned = true; return result; });
      await entered.promise;
      if (cancellation === "handler") abort.abort();
      else closing = f.shutdown().then(() => { closed = true; });
      await cancelled.promise;
      await setImmediate();
      assert.equal(providerSettled, false);
      assert.equal(f.replies.length, 0, "actual host response remains unsettled before release");
      assert.equal(returned, false, "delegate must not return on abort before its actual host response settles");
      assert.equal(closed, false, "shutdown must not return before its actual host response settles");
      release.resolve();
      const result = await pending;
      await closing;
      await Promise.all(f.responseSettlements);
      assert.equal(providerSettled, true);
      assert.equal(f.replies.length, 1, "the actual host stream must settle before cleanup");
      assert.equal(f.replies[0]?.stopReason, "aborted");
      assert.equal(result.details.status, "CANCELLED");
      assert.equal(result.details.independentVerification, "UNOBSERVED");
      assert.equal(f.dispatches(), 1);
      if (cancellation === "shutdown") await assert.rejects(f.delegate(), /shut down/);
    } finally {
      // Even failed assertions release the exact held callback before cleanup.
      release.resolve();
      await Promise.allSettled([...(pending === undefined ? [] : [pending]), ...(closing === undefined ? [] : [closing])]);
      await f.cleanup();
    }
  });
}
