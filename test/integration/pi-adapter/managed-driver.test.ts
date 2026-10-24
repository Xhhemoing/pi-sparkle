import { readPinnedPiVersions } from "../../../src/pi-compat/check.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { stageManagedCandidate } from "../../../src/pi-adapter/managed/candidate.js";
import { qualifyManagedCandidate } from "../../../src/pi-adapter/managed/qualification.js";
import { ManagedGenerationStore } from "../../../src/pi-adapter/managed/generation-store.js";
import { saveProvidersConfig } from "../../../src/config/providers-config.js";
import { authStorePath, FileCredentialStore } from "../../../src/pi-adapter/file-credential-store.js";
import { EventStore } from "../../../src/run/event-store.js";
import { parseRunId } from "../../../src/domain/ids.js";
import { startLoopbackOpenAiProvider } from "../../helpers/loopback-openai-provider.js";
import { listenOnLoopbackForFetch } from "../../helpers/loopback-http-listener.js";

import { boundedSettlement, installManagedSettlementFixture } from "../../helpers/managed-driver-settlement-fixture.js";

type Driver = typeof import("../../../src/pi-adapter/managed/driver.js").startControlledManagedRun;
async function driver(): Promise<Driver> {
  const loaded = await import(pathToFileURL(path.join(process.cwd(), "src/pi-adapter/managed/driver.ts")).href).catch((error: unknown) => {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }) as { startControlledManagedRun?: Driver };
  assert.equal(typeof loaded.startControlledManagedRun, "function", "fixed managed whole-process driver must exist");
  return loaded.startControlledManagedRun!;
}

test("managed driver preabort does not read selection or spawn", async () => {
  const start = await driver();
  const stop = new AbortController(); stop.abort();
  const result = await start({ managerRoot: "missing-manager", request: { kind: "run", stateRoot: "unused", projectRoot: "unused", objective: "unused" }, signal: stop.signal });
  assert.equal(result.spawned, false);
  assert.equal(result.status, "cancelled");
  assert.equal(result.settlement, "not-started");
});

function freshBuild(root: string): void {
  const result = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    cwd: process.cwd(), env: { ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }), HOME: root, USERPROFILE: root, TEMP: root, TMP: root },
    encoding: "utf8", timeout: 60_000, maxBuffer: 512 * 1024, windowsHide: true
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
function runId(output: string): string {
  const id = output.match(/Run (run_[A-Za-z0-9_-]+):/)?.[1];
  assert.ok(id, output);
  return id;
}
async function configure(stateRoot: string, baseUrl: string): Promise<void> {
  await new FileCredentialStore(authStorePath(stateRoot)).modify("loopback", async () => ({ type: "api_key", key: "offline-dummy-key" }));
  await saveProvidersConfig(stateRoot, { version: 1, enabled: ["loopback/driver-1"], primary: "loopback/driver-1", fast: "loopback/driver-1",
    customProviders: [{ id: "loopback", baseUrl, envVar: "PI_DRIVER_LOOPBACK_DUMMY", models: [{ id: "driver-1", contextWindow: 8192, maxTokens: 256, inputCostPerMTok: 0.25, outputCostPerMTok: 1 }] }] });
}

// Two complete SDK generations are physically copied; the Windows aggregate took 259s.
test("actual fixed managed driver loads qualified applications and retains event-bound selection", { timeout: 360_000 }, async (t) => {
  const start = await driver();
  const parent = path.join(process.cwd(), ".agent_workspace/managed-driver-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const managerRoot = path.join(root, "manager"), projectRoot = path.join(root, "project"), stateRoot = path.join(root, "state");
  for (const directory of [managerRoot, projectRoot]) await mkdir(directory);
  await mkdir(path.join(managerRoot, "generations"));
  await writeFile(path.join(projectRoot, "package.json"), "{}\n", "utf8");
  const provider = await startLoopbackOpenAiProvider({ modelIds: ["driver-1"], scriptedResponse: (_number, body) => {
    const messages = body.messages as Array<{ role?: string }>;
    return messages.some((message) => message.role === "tool") ? { text: "complete" }
      : { toolCalls: [{ name: "sparkle_report_task_result", arguments: { verification: "PASSED", summary: "offline controlled work complete" } }] };
  } });
  let preserveRoot = false;
  // Failure evidence is independent of the temporary instrumented ownership bit.
  let preserveFailure = false;
  const diagnoseUnexpectedExit = (phase: "root-A" | "approval-wait", exitCode: number | null) => {
    if (exitCode === 0) return;
    preserveFailure = true;
    const models = provider.requests.slice(0, 8).map((request) => {
      const body = request.body;
      return body !== null && typeof body === "object" && "model" in body && body.model === "driver-1" ? "driver-1" : "unknown";
    });
    // Raw protocol errors can contain request URLs. Classify them instead of
    // printing URLs, headers, authorization, request bodies or arbitrary text.
    const protocolErrors = provider.protocolErrors.slice(0, 8).map((error) => {
      if (error === "request body was not valid JSON") return "invalid-json";
      if (error.startsWith("expected POST /v1/chat/completions, received ")) return "unexpected-method-or-path";
      if (error === "request did not contain the configured model and stream=true") return "invalid-model-or-stream";
      if (/^loopback request cap exceeded \(\d+\)$/.test(error)) return "request-cap-exceeded";
      return "unknown";
    });
    t.diagnostic(JSON.stringify({ phase, exitCode, root, requestCount: provider.requests.length, models,
      protocolErrorCount: provider.protocolErrors.length, protocolErrors }));
  };
  t.after(async () => {
    await provider.close();
    if (preserveRoot) t.diagnostic(`Unresolved instrumented child ownership; preserving ${root}`);
    else if (preserveFailure) t.diagnostic(`Unexpected managed application exit; preserving ${root}`);
    else await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  // The root coordinator schedules this test serially; this is the mandatory
  // fresh build, not a reuse of potentially stale dist from another slice.
  freshBuild(root);
  const pins = readPinnedPiVersions(JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")));
  const versions = { core: pins.agentCore, ai: pins.ai };
  const a = await stageManagedCandidate({ programRoot: process.cwd(), generationsRoot: path.join(managerRoot, "generations"), expectedVersions: versions });
  const b = await stageManagedCandidate({ programRoot: process.cwd(), generationsRoot: path.join(managerRoot, "generations"), expectedVersions: versions });
  const issuedA = await qualifyManagedCandidate({ managerRoot, candidate: a });
  const issuedB = await qualifyManagedCandidate({ managerRoot, candidate: b });
  assert.equal(issuedA.status, "qualified", issuedA.status === "failed" ? issuedA.reason : "");
  assert.equal(issuedB.status, "qualified", issuedB.status === "failed" ? issuedB.reason : "");
  const store = new ManagedGenerationStore(managerRoot);
  await store.approve(issuedA);
  await configure(stateRoot, provider.baseUrl);
  const children = path.join(projectRoot, "children.json");
  await writeFile(children, JSON.stringify({ tasks: [{ id: "tsk_child", role: "worker", objective: "Return the controlled offline result", model: "loopback/driver-1", limits: { maxAttempts: 1 } }] }), "utf8");
  const run = { kind: "run" as const, stateRoot, projectRoot, objective: "Controlled offline work" };
  await t.test("nonzero settled application exit remains failed", async () => {
    const result = await start({ managerRoot, request: { ...run, children, flowchart: children } });
    assert.equal(result.exitCode, 1, JSON.stringify(result));
    assert.equal(result.settlement, "application-settled", JSON.stringify(result));
    assert.equal(result.status, "failed", "a cleanly settled CLI refusal is not a successful process result");
  });
  await t.test("actual main/Pi root and child execute in A and identity is physical", async () => {
    const result = await start({ managerRoot, request: { ...run, children } });
    diagnoseUnexpectedExit("root-A", result.exitCode);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(result.settlement, "application-settled", JSON.stringify(result));
    assert.equal(result.receipt?.root, a.root);
    assert.equal(result.receipt.entry, path.join(a.appRoot, "dist/pi-adapter/managed/driver-entry.js"));
    const events = (await new EventStore(stateRoot, parseRunId(runId(result.stdout))).readAll()).events;
    assert.equal(events.find((event) => event.type === "RUN_CREATED")?.payload.run.engineBinding?.generationId, a.generationId);
    const child = events.find((event) => event.type === "CHILD_RUN_CREATED");
    assert.ok(child);
    assert.equal(child.payload.childRun.engineBinding?.generationId, a.generationId);
    const childEvents = (await new EventStore(stateRoot, child.payload.childRun.id).readAll()).events;
    assert.equal(childEvents.find((event) => event.type === "RUN_CREATED")?.payload.run.engineBinding?.generationId, a.generationId);
    assert.ok(provider.requests.length >= 2, "actual Pi issued a tool turn plus completion on the loopback wire");
  });
  const flowchart = path.join(projectRoot, "flowchart.json");
  await writeFile(flowchart, JSON.stringify({ id: "driver-resume", nodes: ["prepare", "deliver"].map((id, index) => ({
    id, taskId: `tsk_${id}`, role: "actor", objective: id, modelPolicy: { allowedModels: ["loopback/driver-1"] }, confidenceThreshold: 0.7, approvalRequired: index === 1
  })), edges: [{ from: "prepare", to: "deliver", condition: { type: "success", expected: true } }] }), "utf8");
  const waiting = await start({ managerRoot, request: { ...run, flowchart } });
  diagnoseUnexpectedExit("approval-wait", waiting.exitCode);
  assert.equal(waiting.exitCode, 0, JSON.stringify(waiting));
  assert.match(waiting.stdout, /WAITING_FOR_USER/);
  const originalId = runId(waiting.stdout);
  await store.approve(issuedB);
  await t.test("resume chooses authoritative A while separate new roots select B", async () => {
    const resumed = await start({ managerRoot, request: { kind: "resume", stateRoot, runId: originalId, selectedActionIds: ["route:loopback/driver-1"] } });
    assert.equal(resumed.exitCode, 0, JSON.stringify(resumed));
    assert.equal(resumed.receipt?.generationId, a.generationId);
    assert.match(resumed.stdout, /COMPLETED/);
    const events = (await new EventStore(stateRoot, parseRunId(originalId)).readAll()).events;
    assert.ok(events.some((event) => event.type === "CHILD_RUN_CREATED"), "resume uses the actual replacement child path");
    for (const event of events) if (event.type === "CHILD_RUN_CREATED") assert.equal(event.payload.childRun.engineBinding?.generationId, a.generationId);
    const next = await start({ managerRoot, request: run });
    assert.equal(next.exitCode, 0, JSON.stringify(next));
    assert.equal(next.receipt?.generationId, b.generationId);
    const created = (await new EventStore(stateRoot, parseRunId(runId(next.stdout))).readAll()).events.find((event) => event.type === "RUN_CREATED");
    assert.equal(created?.payload.run.engineBinding?.generationId, b.generationId);
  });
  await t.test("missing/corrupt original generation refuses with no provider or B fallback", async () => {
    const count = provider.requests.length;
    const manifest = path.join(a.root, "candidate.json");
    const original = await readFile(manifest, "utf8");
    await writeFile(manifest, JSON.stringify({ generationId: a.generationId, versions: { core: "0.0.0", ai: versions.ai } }), "utf8");
    try { await assert.rejects(start({ managerRoot, request: { kind: "resume", stateRoot, runId: originalId } }), /mismatch/); }
    finally { await writeFile(manifest, original, "utf8"); }
    await rename(a.root, `${a.root}-held`);
    try { await assert.rejects(start({ managerRoot, request: { kind: "resume", stateRoot, runId: originalId } })); }
    finally { await rename(`${a.root}-held`, a.root); }
    const qualification = path.join(managerRoot, "qualifications", `${a.generationId}.json`);
    await rename(qualification, `${qualification}.held`);
    try { await assert.rejects(start({ managerRoot, request: { kind: "resume", stateRoot, runId: originalId } })); }
    finally { await rename(`${qualification}.held`, qualification); }
    assert.equal(provider.requests.length, count);
    assert.equal((await store.readApproved())?.generationId, b.generationId);
  });
  await t.test("active held HTTP cancellation settles actual main/child and makes no later calls", async () => {
    const stop = new AbortController();
    let requests = 0;
    const server = createServer(async (request, _response) => {
      for await (const _chunk of request) { /* consume transport, hold response */ }
      requests++;
      stop.abort();
    });
    await listenOnLoopbackForFetch(server);
    const address = server.address(); assert.ok(address !== null && typeof address !== "string");
    const heldState = path.join(root, "held-state");
    await configure(heldState, `http://127.0.0.1:${address.port}/v1`);
    try {
      const result = await start({ managerRoot, request: { ...run, stateRoot: heldState, children }, signal: stop.signal });
      assert.equal(result.status, "cancelled", JSON.stringify(result));
      assert.equal(result.settlement, "application-settled", JSON.stringify(result));
      assert.equal(result.receipt?.stopped, true);
      assert.equal(requests, 1);
      const events = (await new EventStore(heldState, parseRunId(runId(result.stdout))).readAll()).events;
      assert.equal(events.filter((event) => event.type === "CHILD_RUN_CREATED").length, 1);
      assert.equal(events.filter((event) => event.type === "RUN_CANCEL_REQUESTED").length, 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(requests, 1);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  for (const mode of ["tool", "agent-end"] as const) {
    await t.test(`instrumented actual driver waits for held ${mode} through cancellation`, async () => {
      const heldState = path.join(root, `composition-${mode}`);
      const stop = new AbortController();
      const loopback = await startLoopbackOpenAiProvider({ modelIds: ["driver-1"], scriptedResponse: () =>
        mode === "tool" ? { toolCalls: [{ name: "managed_settlement_hold", arguments: {} }] } : { text: "Listener settlement probe" }
      });
      // Only the private, selected B copy is instrumented. Real SDK Agent/session,
      // CLI and fixed driver entry still own dispatch and settlement.
      const fixture = await installManagedSettlementFixture(b.appRoot, mode).catch(async (error: unknown) => { await loopback.close(); throw error; });
      let running: ReturnType<Driver> | undefined;
      let settled = 0;
      let observed: unknown;
      let failed = false;
      const diagnose = async (phase: string) => {
        t.diagnostic(JSON.stringify({ mode, phase, settled, driver: observed instanceof Error ? observed.stack : observed,
          fixture: await fixture.diagnostics() }));
      };
      const requirePending = () => {
        assert.equal(settled, 0, `driver settled before fixture observation: ${JSON.stringify(observed)}`);
      };
      try {
        await configure(heldState, loopback.baseUrl);
        preserveRoot = true;
        running = start({ managerRoot, request: { ...run, stateRoot: heldState, children }, signal: stop.signal,
          stopGraceMs: 25_000, timeoutMs: 40_000 });
        void running.then((result) => { observed = result; settled++; }, (error: unknown) => { observed = error; settled++; });
        const entered = JSON.parse(await fixture.wait("entered", () => {
          assert.equal(settled, 0, `driver settled before fixture entry: ${JSON.stringify(observed)}`);
        })) as { runId: string };
        const directories = await readdir(path.join(heldState, "runtime/runs"), { withFileTypes: true });
        const ids = directories.filter((entry) => entry.isDirectory() && entry.name.startsWith("run_")).map((entry) => entry.name);
        assert.equal(ids.length, 2, "one actual root and one actual child own this operation");
        assert.ok(ids.includes(entered.runId), "fixture executed inside the recorded child");
        const snapshots = async () => Promise.all(ids.map(async (id) =>
          (await new EventStore(heldState, parseRunId(id)).readAll()).events));
        const terminalTypes = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCEL_REQUESTED"]);
        const assertHeld = async (phase: "before" | "after") => {
          await fixture.mark(`probe-${phase}`);
          await fixture.wait(`held-${phase}`, requirePending);
          assert.equal(settled, 0, `${mode} remains owned until explicit release (${phase} abort)`);
          for (const events of await snapshots()) {
            assert.equal(events.filter((event) => terminalTypes.has(event.type)).length, 0,
              "no terminal run outcome while the owned operation is held");
          }
          assert.equal(loopback.requests.length, 1, "held operation cannot dispatch another provider request");
        };
        if (mode === "tool") {
          const payload = loopback.requests[0]?.body as { tools?: Array<{ type?: string; function?: { name?: string; parameters?: unknown } }> };
          const declared = payload.tools?.filter((tool) => tool.type === "function" && tool.function?.name === "managed_settlement_hold");
          assert.equal(declared?.length, 1, "first real provider request declares the held Agent tool");
          assert.deepEqual(declared![0]!.function!.parameters, { type: "object", properties: {}, required: [] });
        }
        await assertHeld("before");
        stop.abort();
        await fixture.wait("aborted", requirePending);
        await assertHeld("after");
        await fixture.mark("release");
        const result = await boundedSettlement(running, `${mode} driver settlement`);
        assert.equal(result.status, "cancelled", JSON.stringify(result));
        assert.equal(result.settlement, "application-settled", JSON.stringify(result));
        assert.equal(result.receipt?.stopped, true);
        assert.equal(result.receipt?.generationId, b.generationId);
        assert.equal(result.receipt?.root, b.root);
        assert.equal(result.receipt?.entry, path.join(b.appRoot, "dist/pi-adapter/managed/driver-entry.js"));
        assert.equal(settled, 1);
        assert.equal(await fixture.wait("completed"), "completed\n", "operation completed exactly once after release");
        assert.equal(loopback.requests.length, 1, "no provider dispatch after cancellation or release");
        assert.equal(loopback.protocolErrors.length, 0);
        const rootId = runId(result.stdout);
        assert.notEqual(rootId, entered.runId, "held operation belongs to the child, not a synthetic root");
        for (const events of await snapshots()) {
          assert.equal(events.filter((event) => terminalTypes.has(event.type)).length, 1, "exactly one terminal outcome per run");
          assert.equal(events.filter((event) => event.type === "RUN_CANCEL_REQUESTED").length, 1, "root and child cancelled");
          assert.equal(events.find((event) => event.type === "RUN_CREATED")?.payload.run.engineBinding?.generationId, b.generationId);
        }
        const rootEvents = (await new EventStore(heldState, parseRunId(rootId)).readAll()).events;
        const childEvents = rootEvents.filter((event) => event.type === "CHILD_RUN_CREATED");
        assert.equal(childEvents.length, 1);
        assert.equal(childEvents[0]!.payload.childRun.id, entered.runId);
        assert.equal(childEvents[0]!.payload.childRun.engineBinding?.generationId, b.generationId);
      } catch (error) {
        failed = true;
        await diagnose("assertion-failure");
        throw error;
      } finally {
        // Never restore executable bytes while their child still owns work.
        // Failure to settle is reported rather than disguised as clean teardown.
        stop.abort();
        await fixture.mark("release");
        try {
          if (running !== undefined) {
            const cleanup = await boundedSettlement(running, `${mode} cleanup`, 30_000).catch(async (error: unknown) => {
              await diagnose("cleanup-failure");
              throw error;
            });
            if (failed) await diagnose("cleanup-result");
            if (cleanup.settlement === "unknown") await diagnose("cleanup-unknown");
            assert.ok(cleanup.settlement === "application-settled" || cleanup.settlement === "not-started",
              `cannot restore candidate with unresolved child ownership: ${JSON.stringify(cleanup)}`);
          }
          await fixture.restore();
          preserveRoot = false;
        } finally { await loopback.close(); }
      }
    });
    assert.equal(preserveRoot, false, "unresolved child ownership forbids subsequent use of candidate B");
  }
  await t.test("finite forced startup deadline reports unknown effects rather than a retry", async () => {
    const result = await start({ managerRoot, request: run, timeoutMs: 1, stopGraceMs: 1 });
    assert.equal(result.status, "timed_out", JSON.stringify(result));
    assert.equal(result.settlement, "unknown", JSON.stringify(result));
    assert.equal(result.receipt, undefined);
  });
  await t.test("provider retry backoff stops without a later wire request", async () => {
    const stop = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const retryProvider = await startLoopbackOpenAiProvider({ modelIds: ["driver-1"], scriptedResponse: () => {
      timer ??= setTimeout(() => stop.abort(), 100);
      return { httpStatus: 503, errorMessage: "controlled retryable failure" };
    } });
    const retryState = path.join(root, "retry-state");
    await configure(retryState, retryProvider.baseUrl);
    try {
      const result = await start({ managerRoot, request: { ...run, stateRoot: retryState, children }, signal: stop.signal });
      assert.equal(result.status, "cancelled", JSON.stringify(result));
      assert.equal(result.settlement, "application-settled", JSON.stringify(result));
      assert.equal(retryProvider.requests.length, 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(retryProvider.requests.length, 1);
    } finally { if (timer !== undefined) clearTimeout(timer); await retryProvider.close(); }
  });
  await t.test("ambient Node preload injection never evaluates in the selected child", async () => {
    const marker = path.join(root, "preload-evaluated.txt"), preload = path.join(root, "outside-preload.mjs");
    await writeFile(preload, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "evaluated", "utf8");`, "utf8");
    const previousOptions = process.env.NODE_OPTIONS, previousPath = process.env.NODE_PATH;
    process.env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
    process.env.NODE_PATH = path.join(process.cwd(), "node_modules");
    try {
      const result = await start({ managerRoot, request: run });
      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.equal(result.settlement, "application-settled");
      await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
    } finally {
      if (previousOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousOptions;
      if (previousPath === undefined) delete process.env.NODE_PATH; else process.env.NODE_PATH = previousPath;
    }
  });
  await t.test("actual malformed receipt and lost IPC channel cannot claim application settlement", async () => {
    const entry = path.join(b.appRoot, "dist/pi-adapter/managed/driver-entry.js");
    const original = await readFile(entry, "utf8");
    // Deliberate negative-only cooperative-candidate tampering. Qualification
    // is not a byte-integrity promise; restore exact bytes after each case.
    for (const prefix of ['process.send?.({ type: "malformed" });\n', 'process.disconnect?.();\n']) {
      await writeFile(entry, prefix + original, "utf8");
      try {
        const count = provider.requests.length;
        const result = await start({ managerRoot, request: run });
        assert.equal(result.status, "failed", JSON.stringify(result));
        assert.equal(result.settlement, "unknown", JSON.stringify(result));
        assert.equal(provider.requests.length, count, "lost/invalid channel stops before provider entry");
      } finally { await writeFile(entry, original, "utf8"); }
    }
  });
  await t.test("bounded output cannot be accepted as graceful success", async () => {
    const result = await start({ managerRoot, request: { ...run, children, flowchart }, maxOutputBytes: 1 });
    assert.equal(result.status, "output_limit", JSON.stringify(result));
    assert.equal(result.settlement, "unknown", JSON.stringify(result));
    assert.ok(Buffer.byteLength(result.stderr, "utf8") <= 1);
  });
  await t.test("stop during startup is latched before provider dispatch", async () => {
    const stop = new AbortController();
    const count = provider.requests.length;
    const timer = setTimeout(() => stop.abort(), 50);
    try {
      const result = await start({ managerRoot, request: run, signal: stop.signal, stopGraceMs: 10_000 });
      assert.equal(result.status, "cancelled", JSON.stringify(result));
      assert.equal(provider.requests.length, count);
      assert.ok(result.settlement === "not-started" || result.settlement === "application-settled", JSON.stringify(result));
    } finally { clearTimeout(timer); }
  });
  await t.test("fixed entry refuses workspace loading and parent disconnect before startup dispatch", async () => {
    const entry = path.join(b.appRoot, "dist/pi-adapter/managed/driver-entry.js");
    const args = [entry, managerRoot, b.root, b.generationId, versions.core, versions.ai, JSON.stringify(["run", "--project", projectRoot, "--objective", "disconnect", "--state-root", stateRoot, "--executor", "pi"])];
    const count = provider.requests.length;
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, args, { windowsHide: true, env: { ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }), NODE_OPTIONS: "", NODE_PATH: "", PATH: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("disconnect fixture deadline")); }, 10_000);
      child.once("spawn", () => child.disconnect());
      child.stderr?.resume();
      child.once("error", reject);
      child.once("exit", (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    });
    assert.equal(code, 1);
    assert.equal(provider.requests.length, count);
    const outside = spawnSync(process.execPath, [path.join(process.cwd(), "dist/pi-adapter/managed/driver-entry.js"), ...args.slice(1)], { windowsHide: true, encoding: "utf8", timeout: 10_000 });
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /identity mismatch/);
  });
  assert.equal(provider.protocolErrors.length, 0, provider.protocolErrors.join("\n"));
});
