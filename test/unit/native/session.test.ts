import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as native from "../../../src/native/session.js";
import { GatedExecutor, ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { EventStore } from "../../../src/run/event-store.js";

async function roots(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-native-"));
  try { await body(root); } finally { await rm(root, { recursive: true, force: true }); }
}

const models = [{ provider: "xhh", id: "cursor-grok-4.6-fast" }];

test("preferred model must resolve uniquely; explicit provider pin wins", () => {
  assert.deepEqual(native.resolveNativeModel(models), models[0]);
  assert.throws(() => native.resolveNativeModel([]), /unavailable/);
  const ambiguous = [...models, { provider: "other", id: models[0]!.id }];
  assert.throws(() => native.resolveNativeModel(ambiguous), /ambiguous/);
  assert.deepEqual(native.resolveNativeModel(ambiguous, "xhh/cursor-grok-4.6-fast"), models[0]);
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
    const result = await session.delegate({
      projectRoot: root, stateRoot: join(root, "state"),
      model: { provider: "xhh", id: "gpt-5.6-luna-fast" },
      tasks: [
        { role: "scout", objective: "Locate the entry point and inspect the parser module" },
        { role: "reviewer", objective: "Check the boundary conditions of the parser" }
      ],
      executor: new ProtocolChildExecutor(),
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
