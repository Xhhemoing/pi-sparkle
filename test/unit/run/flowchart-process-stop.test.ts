import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getEventListeners } from "node:events";
import { main, type CliIo } from "../../../src/cli/main.js";
import type { Flowchart } from "../../../src/domain/flowchart.js";
import { createTaskId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { EventStore } from "../../../src/run/event-store.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { validateCheckpoint } from "../../../src/run/replay.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve: () => resolve() };
}

test("external process stop aborts the active flowchart and awaits actual settlement before admitting another node", async () => {
  const root = await mkdtemp(join(tmpdir(), "sparkle-process-stop-"));
  const entered = deferred(), release = deferred();
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  let settled = false;
  const executor: AgentExecutor = {
    async *execute(_request, signal): AsyncIterable<ExecutionEvent> {
      signals.push(signal);
      entered.resolve();
      await release.promise;
      yield { type: "EXECUTION_FINISHED", outcome: signal.aborted ? "CANCELLED" : "SUCCESS" };
    }
  };
  const flowchart: Flowchart = {
    id: "stop",
    nodes: ["first", "second"].map((id) => ({ id, taskId: createTaskId(() => id), role: "actor", objective: id,
      modelPolicy: { allowedModels: ["local"] }, confidenceThreshold: 0.7, approvalRequired: false })),
    edges: [{ from: "first", to: "second", condition: { type: "success", expected: true } }]
  };
  await writeFile(join(root, "package.json"), "{}\n", "utf8");
  const deps = { stateRoot: join(root, "state"), executor, signal: controller.signal,
    router: createModelRouter({ policyVersion: "test", models: [{ id: "local", version: "v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] }) };
  const running = startFlowchartRun(deps, { projectRoot: root, objective: "stop", flowchart });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered.promise;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(signals[0]?.aborted, true, "external stop must reach the active executor");
    assert.equal(settled, false, "a stop request is not actual completion");
    release.resolve();
    const result = await running;
    assert.equal(result.status, "CANCELLED");
    assert.equal(signals.length, 1, "no next node can dispatch after stop");
    assert.equal(result.events.filter((event) => event.type === "RUN_CANCEL_REQUESTED").length, 1);
    assert.equal(result.events.some((event) => event.type === "RUN_FAILED"), false);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("a stopped CLI child flowchart does not start adaptation after owned execution settles", async () => withIsolatedPiEnv(async () => {
  const root = await mkdtemp(join(tmpdir(), "sparkle-stop-adapt-"));
  const stop = new AbortController();
  const output: string[] = [];
  try {
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    const children = join(root, "children.json");
    await writeFile(children, JSON.stringify({ tasks: [{ id: "tsk_one", role: "worker", objective: "Stop before dispatch" }] }), "utf8");
    await main(["run", "--project", root, "--objective", "stop", "--children", children, "--state-root", join(root, "state")], {
      stdout: (value) => { output.push(value); if (value.includes(": started")) stop.abort(); }, stderr: () => undefined
    }, { signal: stop.signal });
    assert.match(output.join(""), /CANCELLED/);
    assert.doesNotMatch(output.join(""), / {2}adapt:/, "process stop cannot start new adaptation work");
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}));

test("initial checkpoint failure removes the external stop listener", async () => {
  const root = await mkdtemp(join(tmpdir(), "sparkle-stop-listener-"));
  const stop = new AbortController();
  const flowchart: Flowchart = { id: "failure", nodes: [{ id: "one", taskId: createTaskId(() => "one"), role: "actor", objective: "one",
    modelPolicy: { allowedModels: ["local"] }, confidenceThreshold: 0.7, approvalRequired: false }], edges: [] };
  const error = new Error("injected initial checkpoint failure");
  try {
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    await assert.rejects(startFlowchartRun({ stateRoot: join(root, "state"), signal: stop.signal,
      now: () => { if (getEventListeners(stop.signal, "abort").length > 0) throw error; return nowIso(); },
      router: createModelRouter({ policyVersion: "test", models: [{ id: "local", version: "v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] })
    }, { projectRoot: root, objective: "failure", flowchart }), /injected initial checkpoint failure/);
    assert.equal(getEventListeners(stop.signal, "abort").length, 0);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("stop latched while an approval lease is persisted wins over waiting projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "sparkle-stop-lease-"));
  const stop = new AbortController(), routed = deferred();
  const base = createModelRouter({ policyVersion: "test", models: [{ id: "local", version: "v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] });
  try {
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    const running = startFlowchartRun({ stateRoot: join(root, "state"), signal: stop.signal,
      router: { config: base.config, route: (input) => { const decision = base.route(input); routed.resolve(); return decision; } }
    }, { projectRoot: root, objective: "stop approval", flowchart: { id: "approval", nodes: [{ id: "one", taskId: createTaskId(() => "one"), role: "actor", objective: "one",
      modelPolicy: { allowedModels: ["local"] }, confidenceThreshold: 0.7, approvalRequired: true }], edges: [] } });
    await routed.promise; // The loop's MODEL_ROUTED append is the next owned await.
    stop.abort();
    const result = await running;
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.events.filter((event) => event.type === "RUN_CANCEL_REQUESTED").length, 1);
    assert.equal(result.events.some((event) => event.type === "RUN_WAITING_FOR_USER"), false);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test("main local runtime preabort refuses before creating a run while ordinary main remains usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "sparkle-cli-stop-"));
  const controller = new AbortController(); controller.abort();
  const io: CliIo = { stdout: () => undefined, stderr: () => undefined };
  const invoke = main as (argv: string[], io: CliIo, runtime: { signal: AbortSignal }) => Promise<number>;
  try {
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    assert.notEqual(await invoke(["run", "--project", root, "--objective", "stop", "--state-root", join(root, "state")], io, { signal: controller.signal }), 0);
    await assert.rejects(readFile(join(root, "state/runtime/runs"), "utf8"), { code: "ENOENT" });
    assert.equal(await main(["--version"], io), 0);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

for (const boundary of ["persistWaiting", "finish-checkpoint", "finish-episode"] as const) {
  test(`external stop during ${boundary} is reconciled before returning the final nonterminal projection`, async () => {
    const root = await mkdtemp(join(tmpdir(), "sparkle-stop-final-"));
    const stateRoot = join(root, "state"), stop = new AbortController();
    let triggered = false;
    try {
      await writeFile(join(root, "package.json"), "{}\n", "utf8");
      const result = await startFlowchartRun({ stateRoot, signal: stop.signal,
        now: () => {
          const stack = new Error().stack ?? "";
          const atBoundary = boundary === "persistWaiting" ? stack.includes("persistWaiting")
            : boundary === "finish-checkpoint" ? /at (?:async )?finish\s/.test(stack) && stack.includes("persistCheckpoint")
              : /at (?:async )?finish\s/.test(stack) && stack.includes("settleLockedEpisode");
          if (!triggered && atBoundary) { triggered = true; stop.abort(); }
          return nowIso();
        },
        router: createModelRouter({ policyVersion: "test", models: [{ id: "local", version: "v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] })
      }, { projectRoot: root, objective: "stop final waiting boundary", flowchart: { id: "wait-final", nodes: [{ id: "one", taskId: createTaskId(() => "one"), role: "actor", objective: "one",
        modelPolicy: { allowedModels: ["local"] }, confidenceThreshold: 0.7, approvalRequired: true }], edges: [] } });
      assert.equal(triggered, true, `must actually reach ${boundary}`);
      assert.equal(stop.signal.aborted, true);
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.checkpoint.status, "CANCELLED");
      const events = (await new EventStore(stateRoot, result.runId).readAll()).events;
      assert.equal(events.filter((event) => event.type === "RUN_CANCEL_REQUESTED").length, 1);
      assert.equal(events.filter((event) => event.type === "RUN_WAITING_FOR_USER").length, 1);
      assert.equal(events.some((event) => event.type === "RUN_FAILED"), false);
      assert.equal(events.some((event) => event.type === "EPISODE_CLOSED"), true);
      assert.equal(validateCheckpoint(await new CheckpointStore(stateRoot, result.runId).read()).status, "CANCELLED");
      assert.equal(getEventListeners(stop.signal, "abort").length, 0);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });
}

for (const expected of ["WAITING_FOR_USER", "PAUSED", "COMPLETED", "FAILED", "BLOCKED"] as const) {
  test(`final stop reconciliation preserves ${expected === "WAITING_FOR_USER" || expected === "PAUSED" ? "ordinary" : "already persisted"} ${expected}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "sparkle-stop-precedence-"));
    const stop = new AbortController();
    const terminal = expected === "COMPLETED" || expected === "FAILED" || expected === "BLOCKED";
    let triggered = false;
    try {
      await writeFile(join(root, "package.json"), "{}\n", "utf8");
      const result = await startFlowchartRun({ stateRoot: join(root, "state"), signal: stop.signal,
        now: () => {
          const stack = new Error().stack ?? "";
          if (terminal && !triggered && /at (?:async )?finish\s/.test(stack) && stack.includes("persistCheckpoint")) { triggered = true; stop.abort(); }
          return nowIso();
        },
        ...(expected === "PAUSED" ? { pause: { token: async () => ({ paused: true as const, requestedAt: nowIso() }),
          requestPause: async () => ({ paused: true as const, requestedAt: nowIso() }), clearPause: async () => undefined } } : {}),
        router: createModelRouter({ policyVersion: "test", models: [{ id: "local", version: "v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] })
      }, { projectRoot: root, objective: "preserve status", limits: { maxConsecutiveStalls: expected === "BLOCKED" ? 1 : 3, maxRounds: 2 },
        ...(expected === "COMPLETED" ? { childResults: { one: { outcome: "SUCCESS" as const, confidence: 1 } } }
          : expected === "FAILED" ? { childResults: { one: { outcome: "FAILURE" as const } } } : {}),
        flowchart: { id: "precedence", nodes: [{ id: "one", taskId: createTaskId(() => "one"), role: "actor", objective: "one",
          modelPolicy: { allowedModels: ["local"] }, confidenceThreshold: 0.7, approvalRequired: expected === "WAITING_FOR_USER" }], edges: [] } });
      assert.equal(triggered, terminal);
      assert.equal(stop.signal.aborted, terminal);
      assert.equal(result.status, expected);
      assert.equal(result.checkpoint.status, expected);
      assert.equal(result.events.filter((event) => event.type === "RUN_CANCEL_REQUESTED").length, 0);
      assert.equal(getEventListeners(stop.signal, "abort").length, 0);
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  });
}
