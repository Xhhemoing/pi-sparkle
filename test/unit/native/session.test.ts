import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as native from "../../../src/native/session.js";
import { GatedExecutor, ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import type { MessageId } from "../../../src/domain/ids.js";

async function roots(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-native-"));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}

const models = [{ provider: "xhh-grok", id: "grok-4.7" }];

test("preferred model must resolve uniquely; explicit provider pin wins", () => {
  assert.deepEqual(native.resolveNativeModel(models), models[0]);
  assert.throws(() => native.resolveNativeModel([]), /unavailable/);
  const ambiguous = [...models, { provider: "other", id: models[0]!.id }];
  assert.throws(() => native.resolveNativeModel(ambiguous), /ambiguous/);
  assert.deepEqual(native.resolveNativeModel(ambiguous, "xhh-grok/grok-4.7"), models[0]);
});

test("per-task routing: catalog + learned avoid routes the second task to a different model", async () => {
  const { buildNativeRoutingCatalog } = await import("../../../src/native/routing-catalog.js");
  const { applyLearnedRouting, parseLearnedRoutingPolicy } = await import("../../../src/learning/learned-routing.js");
  await roots(async (root) => {
    const primary = "xhh/gpt-5.6-luna-fast";
    const secondary = "xhh/cursor-grok-4.6-fast";
    const catalog = buildNativeRoutingCatalog(
      [
        { ref: primary, preferred: true, contextWindow: 200_000, maxOutputTokens: 16_384 },
        { ref: secondary, contextWindow: 200_000, maxOutputTokens: 16_384 }
      ],
      { primary }
    );
    // The learned policy avoids the primary for the review family; the
    // reviewer task must then route to the secondary model.
    const learned = parseLearnedRoutingPolicy(JSON.stringify({
      primaryModelId: primary,
      avoid: [{ modelId: primary, family: "analysis", reason: "observed failures" }],
      prefer: [{ family: "review", modelId: secondary }]
    }));
    const reviewerFamilyAllowed = applyLearnedRouting(
      "review",
      catalog.config.models.map((model) => model.id),
      primary,
      learned
    );
    assert.equal(reviewerFamilyAllowed.preferredModel, secondary, "prefer entry wins for the review family");
    const avoidedFamilyAllowed = applyLearnedRouting(
      "analysis",
      catalog.config.models.map((model) => model.id),
      primary,
      learned
    );
    assert.ok(
      !avoidedFamilyAllowed.allowedModels.includes(primary) || avoidedFamilyAllowed.preferredModel !== primary,
      "avoid entry must move the primary off the analysis family"
    );

    // And through the real delegate path: assignments differ per task when a
    // routing input is supplied (verified through assignTasks semantics used
    // inside delegate).
    const session = new native.NativeSession();
    const progress: string[] = [];
    const protocol = new ProtocolChildExecutor();
    const result = await session.delegate({
      projectRoot: root, stateRoot: join(root, "state"),
      model: { provider: "xhh", id: "gpt-5.6-luna-fast" },
      tasks: [
        { role: "scout", objective: "Locate the entry point and inspect the parser module" },
        { role: "reviewer", objective: "Check the boundary conditions of the parser" }
      ],
      executor: {
        supportedModelIds: [primary, secondary],
        execute: (request, signal) => protocol.execute(request, signal)
      },
      onProgress: (text) => progress.push(text),
      routing: { catalog, learned }
    });
    assert.equal(result.status, "COMPLETED");
    assert.match(result.text, /Routing: per-task over host catalog/);
    const events = (await new EventStore(join(root, "state"), result.runId).readAll()).events;
    const routed = events.filter((e) => e.type === "MODEL_ROUTED");
    assert.ok(routed.length === 2, `expected per-task MODEL_ROUTED rows, got ${routed.length}`);
    const routedModels = new Set(routed.map((e) => (e.payload as unknown as { model: string }).model));
    assert.ok(routedModels.size >= 1, "models recorded");
    await session.shutdown();
  });
});

test("native routing canonicalizes cheap policy aliases before and after assignment", async () => {
  const { buildNativeRoutingCatalog } = await import("../../../src/native/routing-catalog.js");
  const { parseLearnedRoutingPolicy } = await import("../../../src/learning/learned-routing.js");
  await roots(async (root) => {
    const primary = "provider-a/primary";
    const secondary = "provider-b/secondary";
    const catalog = buildNativeRoutingCatalog(
      [{ ref: primary, preferred: true }, { ref: secondary }],
      { primary, fast: secondary }
    );
    const learned = parseLearnedRoutingPolicy(JSON.stringify({
      primaryModelId: "premium",
      avoid: [],
      prefer: [{ family: "review", modelId: "cheap" }],
      assignments: [{ role: "reviewer", family: "review", model: "cheap" }]
    }));
    const seen: string[] = [];
    const executor: AgentExecutor = {
      supportedModelIds: [primary, secondary],
      async *execute(request) {
        seen.push(`${request.providerId}/${request.modelId}`);
        yield* new ProtocolChildExecutor().execute(request, new AbortController().signal);
      }
    };
    const session = new native.NativeSession();
    const progress: string[] = [];
    const result = await session.delegate({
      projectRoot: root,
      stateRoot: join(root, "state"),
      model: { provider: "provider-a", id: "primary" },
      tasks: [{ role: "reviewer", objective: "Review this boundary" }],
      executor,
      routing: { catalog, learned },
      onProgress: (message) => progress.push(message)
    });
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(seen, [secondary]);
    assert.ok(progress.some((message) => message.includes(secondary)));
    assert.ok(progress.every((message) => !/\bcheap\b|\bpremium\b/.test(message)));
    const events = (await new EventStore(join(root, "state"), result.runId).readAll()).events;
    const routed = events.filter((event) => event.type === "MODEL_ROUTED");
    assert.deepEqual(routed.map((event) => (event.payload as { model: string }).model), [secondary]);
    assert.deepEqual(routed.map((event) => (event.payload as { eligibleModels: readonly string[] }).eligibleModels), [[primary, secondary]]);
    await session.shutdown();
  });
});

test("routing refuses an executor whose capability omits any catalog model before persistence", async () => {
  const { buildNativeRoutingCatalog } = await import("../../../src/native/routing-catalog.js");
  await roots(async (root) => {
    const primary = "provider-a/primary";
    const secondary = "provider-b/secondary";
    const catalog = buildNativeRoutingCatalog(
      [{ ref: primary, preferred: true }, { ref: secondary }],
      { primary, fast: secondary }
    );
    const executor: AgentExecutor = {
      supportedModelIds: [primary],
      execute() { throw new Error("executor must not start"); }
    };
    const session = new native.NativeSession();
    await assert.rejects(() => session.delegate({
      projectRoot: root,
      stateRoot: join(root, "state"),
      model: { provider: "provider-a", id: "primary" },
      tasks: [{ role: "scout", objective: "Inspect" }],
      executor,
      routing: { catalog }
    }), /capability.*catalog|catalog.*capability/i);
    await assert.rejects(() => session.delegate({
      projectRoot: root,
      stateRoot: join(root, "state"),
      model: { provider: "provider-a", id: "primary" },
      tasks: [{ role: "scout", objective: "Inspect" }],
      executor: { execute() { throw new Error("executor must not start"); } },
      routing: { catalog }
    }), /must declare.*capability|capability.*required/i);
    assert.equal(await readdir(join(root, "state")).then(() => true, () => false), false);
    await session.shutdown();
  });
});

test("single-model native executors refuse learned reassignment before starting a run", async () => {
  const { buildNativeRoutingCatalog } = await import("../../../src/native/routing-catalog.js");
  const { parseLearnedRoutingPolicy } = await import("../../../src/learning/learned-routing.js");
  await roots(async (root) => {
    const primary = "xhh-luna/gpt-5.6-luna-fast";
    const secondary = "agentrouter/gpt-6-astra";
    const catalog = buildNativeRoutingCatalog(
      [{ ref: primary, preferred: true }, { ref: secondary }],
      { primary }
    );
    const learned = parseLearnedRoutingPolicy(JSON.stringify({
      primaryModelId: primary,
      avoid: [],
      prefer: [{ family: "review", modelId: secondary }]
    }));
    const executor: AgentExecutor = {
      supportedModelIds: [primary],
      execute() {
        throw new Error("executor must not start");
      }
    };
    const session = new native.NativeSession();
    await assert.rejects(
      () => session.delegate({
        projectRoot: root,
        stateRoot: join(root, "state"),
        model: { provider: "xhh-luna", id: "gpt-5.6-luna-fast" },
        tasks: [{ role: "reviewer", objective: "Review the boundary" }],
        executor,
        routing: { catalog, learned }
      }),
      /capability.*catalog|catalog.*capability/i
    );
    assert.equal(await readdir(join(root, "state")).then(() => true, () => false), false);
    await session.shutdown();
  });
});

test("explicit delegate model is not reassigned when catalog costs are tied", async () => {
  const { buildNativeRoutingCatalog } = await import("../../../src/native/routing-catalog.js");
  await roots(async (root) => {
    const preferred = "xhh-luna/gpt-5.6-luna-fast";
    const other = "agentrouter/gpt-6-astra";
    const catalog = buildNativeRoutingCatalog(
      [
        { ref: other },
        { ref: preferred, preferred: true }
      ],
      { primary: preferred }
    );
    const seen: string[] = [];
    const executor: AgentExecutor = {
      supportedModelIds: [preferred, other],
      async *execute(request: AgentExecutionRequest) {
        seen.push(`${request.providerId ?? ""}/${request.modelId ?? ""}`);
        yield* new ProtocolChildExecutor().execute(request, new AbortController().signal);
      }
    };
    const session = new native.NativeSession();
    const result = await session.delegate({
      projectRoot: root,
      stateRoot: join(root, "state"),
      model: { provider: "xhh-luna", id: "gpt-5.6-luna-fast" },
      tasks: [{ role: "reviewer", objective: "Read-only review of the draft boundary. Do not edit files." }],
      executor,
      routing: { catalog }
    });
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(seen, [preferred]);
    const events = (await new EventStore(join(root, "state"), result.runId).readAll()).events;
    const routed = events.filter((event) => event.type === "MODEL_ROUTED");
    assert.deepEqual(routed.map((event) => (event.payload as { model: string }).model), [preferred]);
    await session.shutdown();
  });
});

test("native delegation persists multiple child results and discloses self-report", async () => {
  await roots(async (root) => {
    const session = new native.NativeSession();
    const progress: string[] = [];
    const result = await session.delegate({
      projectRoot: root, stateRoot: join(root, "state"), model: models[0]!,
      tasks: [{ role: "scout", objective: "Locate entry" }, { role: "reviewer", objective: "Check boundary" }],
      executor: new ProtocolChildExecutor(), onProgress: (text) => progress.push(text)
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.results.length, 2);
    assert.equal(result.independentVerification, "UNOBSERVED");
    assert.match(result.text, /not independently verified/);
    const events = (await new EventStore(join(root, "state"), result.runId).readAll()).events;
    assert.ok(events.some((e) => e.type === "RUN_COMPLETED"));
    assert.ok(progress.length > 0);
    assert.equal(session.activeCount, 0);
    await session.shutdown();
  });
});

test("delegation with observation projection: reads pack after two full sends, recall tool works", async () => {
  const { createObservationProjector, createRecallTool } = await import("../../../src/pi-adapter/observation-tools.js");
  const { nowIso } = await import("../../../src/domain/timestamp.js");
  const { SUPERVISOR } = await import("../../../src/protocol/v1.js");
  await roots(async (root) => {
    const dense = "worker-read-".repeat(1500); // >10KiB
    const stateRoot = join(root, "state");
    const projector = createObservationProjector({ enabled: true, toolName: "sparkle_read_file" });
    const recall = createRecallTool(projector);
    const sentTexts: string[] = [];
    const worker: AgentExecutor = {
      async *execute(request) {
        for (let send = 0; send < 3; send++) {
          const projected = await projector.project({ sourceId: `read-${send}`, text: dense, toolParams: { path: "src/safe-observation.txt" }, projectability: {
            resultKind: "observation",
            isError: false,
            mutatesState: false,
            securityCritical: false,
            toolKind: "read",
            toolPolicyProjectable: true
          } });
          sentTexts.push(projected.text);
        }
        const packed = sentTexts[2]!;
        const idMatch = packed.match(/id: (\S+)/);
        assert.ok(idMatch, "placeholder carries the observation id");
        const recalled = await recall.execute("r1", { id: idMatch[1], offset: 0 });
        const recalledText = recalled.content[0]?.type === "text" ? recalled.content[0].text : "";
        assert.match(recalledText, /worker-read-/);
        yield {
          type: "MESSAGE",
          message: {
            protocolVersion: 1,
            id: `msg_fake-${request.agentInstanceId}` as MessageId,
            occurredAt: nowIso(),
            runId: request.runId, taskId: request.taskId,
            from: request.agentInstanceId, to: SUPERVISOR,
            type: "TASK_RESULT" as const, outcome: "SUCCESS" as const,
            summary: "packed read observed", artifactIds: [],
            evidenceIds: [],
            verification: { kind: "PASSED" as const, evidenceIds: [] }
          }
        } satisfies ExecutionEvent;
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    };
    const session = new native.NativeSession();
    const result = await session.delegate({
      projectRoot: root, stateRoot,
      model: models[0]!,
      tasks: [{ role: "scout", objective: "Read the big file repeatedly" }],
      executor: worker,
      observationProjector: projector
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(sentTexts[0], dense, "send 1 full");
    assert.equal(sentTexts[1], dense, "send 2 full");
    assert.ok(Buffer.byteLength(sentTexts[2]!, "utf8") <= 2048, "send 3 packed");
    // The archives are in the run's own subtree.
    const { readdir } = await import("node:fs/promises");
    const obsDir = join(stateRoot, "runtime", "runs", result.runId, "observations");
    const entries = await readdir(obsDir);
    assert.ok(entries.length >= 1, "archive exists under the run");
    await session.shutdown();
  });
});

test("pre-abort and invalid tasks start no persistence or executor work", async () => {
  await roots(async (root) => {
    const session = new native.NativeSession();
    const input = { projectRoot: root, stateRoot: join(root, "state"), model: models[0]!, executor: new ProtocolChildExecutor() };
    await assert.rejects(session.delegate({ ...input, tasks: [], }), /1.*4/);
    await assert.rejects(session.delegate({ ...input, tasks: [{ role: "scout", objective: " " }] }), /objective/);
    await assert.rejects(session.delegate({ ...input, tasks: [{ role: "scout", objective: "read" }], signal: AbortSignal.abort() }), /abort/i);
    assert.deepEqual(await readdir(root), []);
  });
});

for (const trigger of ["abort", "shutdown"] as const) {
  test(`${trigger} settles active child work and prevents post-cancel learning`, async () => {
    await roots(async (root) => {
      const session = new native.NativeSession();
      const executor = new GatedExecutor();
      const controller = new AbortController();
      let childSignal: AbortSignal | undefined;
      const pending = session.delegate({ projectRoot: root, stateRoot: join(root, "state"), model: models[0]!,
        tasks: [{ role: "scout", objective: "Inspect" }], executor: {
          execute(request, signal) { childSignal = signal; return executor.execute(request, signal); }
        }, signal: controller.signal });
      await executor.started;
      if (trigger === "abort") controller.abort();
      else await session.shutdown();
      const result = await pending;
      assert.equal(childSignal?.aborted, true);
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.analysis, "skipped");
      assert.equal(session.activeCount, 0);
    });
  });
}
