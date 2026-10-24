import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CoreNativeSession, type NativeCoreDelegateInput } from "../../../src/native/core-session.js";
import { GatedExecutor, ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";
import { assignHostPinnedTasks } from "../../../src/native/host-assignment.js";
import { buildNativeRoutingCatalog } from "../../../src/native/routing-catalog.js";
import { EventStore } from "../../../src/run/event-store.js";
import { createTaskId } from "../../../src/domain/ids.js";

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function fixture(body: (session: CoreNativeSession, input: NativeCoreDelegateInput) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-core-"));
  const session = new CoreNativeSession();
  try {
    await body(session, { projectRoot: root, stateRoot: join(root, "state"), model: { provider: "fixture", id: "model" },
      tasks: [{ role: "scout", objective: "Inspect parser" }], executor: new ProtocolChildExecutor() });
  } finally { await session.shutdown(); await rm(root, { recursive: true, force: true }); }
}

test("shutdown waits for already-started post-run analysis to settle", async () => {
  await fixture(async (session, input) => {
    const entered = latch(), release = latch();
    let closed = false;
    const pending = session.delegate(input, { analyze: async () => { entered.release(); await release.promise; return "analysis finished"; } });
    await entered.promise;
    const closing = session.shutdown().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(closed, false, "shutdown must retain ownership of in-flight analysis after running.done");
      assert.equal(session.activeCount, 1);
    } finally { release.release(); await closing; await pending; }
    const result = await pending;
    assert.equal(result.analysis, "analysis finished");
    assert.equal(session.activeCount, 0);
    await assert.rejects(session.delegate(input), /shut down/);
  });
});

test("core without an analysis callback retains results and creates no adaptation output", async () => {
  await fixture(async (session, input) => {
    const result = await session.delegate(input);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.analysis, "skipped");
    assert.equal(result.independentVerification, "UNOBSERVED");
    assert.equal(result.results.length, 1);
    assert.match(result.text, /not independently verified/);
    await assert.rejects(readdir(join(input.stateRoot, "adaptation")), { code: "ENOENT" });
  });
});

test("post-run analysis errors retain the completed execution evidence", async () => {
  await fixture(async (session, input) => {
    const result = await session.delegate(input, { analyze: async () => { throw new Error("analysis unavailable"); } });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.results.length, 1);
    assert.equal(result.analysis, "post-run analysis failed; execution evidence retained");
  });
});

for (const trigger of ["abort", "shutdown"] as const) test(`${trigger} drains children and skips analysis that has not started`, async () => {
  await fixture(async (session, input) => {
    const executor = new GatedExecutor(), controller = new AbortController();
    let analyzed = false;
    const pending = session.delegate({ ...input, executor, signal: controller.signal }, { analyze: async () => { analyzed = true; return "unexpected"; } });
    await executor.started;
    if (trigger === "abort") controller.abort();
    else await session.shutdown();
    const result = await pending;
    assert.equal(result.status, "CANCELLED");
    assert.equal(result.analysis, "skipped");
    assert.equal(analyzed, false);
    assert.equal(session.activeCount, 0);
  });
});

test("all contracts validate before a plan sees copied original objectives and positional ids", async () => {
  await fixture(async (session, input) => {
    let planned = false;
    const task = { role: "scout" as const, objective: "Inspect parser", contract: { scope: ["src/parser.ts"] } };
    await assert.rejects(session.delegate({ ...input, tasks: [task, { ...task, contract: { command: "forbidden" } } as never] }, {
      plan: () => { planned = true; throw new Error("plan should not run"); }
    }), /contract/);
    assert.equal(planned, false);
    await assert.rejects(readdir(input.stateRoot), { code: "ENOENT" });
    await assert.rejects(session.delegate({ ...input, tasks: [task] }, { plan: (tasks) => {
      task.objective = "mutated original";
      assert.deepEqual(tasks, [{ taskId: "tsk_route_0", role: "scout", objective: "Inspect parser" }]);
      throw new Error("planning refused");
    } }), /planning refused/);
    await assert.rejects(readdir(input.stateRoot), { code: "ENOENT" });
  });
});

test("an ineligible second sibling refuses the whole batch before persistence or execution", async () => {
  await fixture(async (session, input) => {
    let executed = false;
    const catalog = buildNativeRoutingCatalog([{ ref: "fixture/model", preferred: true }], {});
    await assert.rejects(session.delegate({ ...input,
      tasks: [{ role: "scout", objective: "Inspect parser" }, { role: "reviewer", objective: "Review parser; must stay local" }],
      executor: { supportedModelIds: ["fixture/model"], execute() { executed = true; throw new Error("must not start"); } }
    }, { plan: (tasks) => assignHostPinnedTasks({ tasks, catalog, pinnedModelId: "fixture/model" }) }), /privacy|eligible/i);
    assert.equal(executed, false);
    assert.equal(session.activeCount, 0);
    await assert.rejects(readdir(input.stateRoot), { code: "ENOENT" });
  });
});

test("core capability and complete-plan checks refuse before any run is persisted", async () => {
  await fixture(async (session, input) => {
    const catalog = buildNativeRoutingCatalog([{ ref: "fixture/model", preferred: true }], {});
    for (const supportedModelIds of [undefined, []]) {
      await assert.rejects(session.delegate({ ...input, executor: {
        ...(supportedModelIds !== undefined ? { supportedModelIds } : {}),
        execute() { throw new Error("must not start"); }
      } }, { plan: (tasks) => assignHostPinnedTasks({ tasks, catalog, pinnedModelId: "fixture/model" }) }), /capability|supportedModelIds/);
      await assert.rejects(readdir(input.stateRoot), { code: "ENOENT" });
    }
    await assert.rejects(session.delegate(input, { plan: () => ({ assignments: [], requiredModelIds: [] }) }), /every task exactly once/);
    await assert.rejects(readdir(input.stateRoot), { code: "ENOENT" });
  });
});

test("caller plan mutation cannot change admitted dispatch, nested routing evidence or reported models", async () => {
  await fixture(async (session, input) => {
    const selected = "fixture/model", other = "fixture/other";
    const catalog = buildNativeRoutingCatalog([{ ref: selected, preferred: true }], {});
    const actualModels: string[] = [];
    const base = assignHostPinnedTasks({ tasks: [{ taskId: createTaskId(() => "route_0"), role: "scout", objective: "Inspect parser" }],
      catalog, pinnedModelId: selected }).assignments[0]!;
    const assignment = { ...base, allowedModels: [...base.allowedModels],
      analysis: { ...base.analysis, requiredCapabilities: [...base.analysis.requiredCapabilities] },
      decision: { ...base.decision, eligibleModels: [...base.decision.eligibleModels],
        behaviorDistribution: { ...base.decision.behaviorDistribution },
        rejections: [{ modelId: other, constraint: "capability", detail: "original refusal" }],
        approvalPlan: { ...base.decision.approvalPlan, items: base.decision.approvalPlan.items.map((item) => ({ ...item })) }
      }
    };
    const plan = { assignments: [assignment], requiredModelIds: [selected] };
    const pending = session.delegate({ ...input, executor: { supportedModelIds: [selected], execute(request, signal) {
      actualModels.push(`${request.providerId}/${request.modelId}`);
      return new ProtocolChildExecutor().execute(request, signal);
    } } }, { plan: () => plan });
    assignment.decision.model = other;
    assignment.decision.eligibleModels[0] = other;
    delete assignment.decision.behaviorDistribution[selected];
    assignment.decision.behaviorDistribution[other] = 1;
    assignment.decision.rejections[0]!.detail = "mutated refusal";
    assignment.decision.approvalPlan.id = "mutated-plan";
    assignment.decision.approvalPlan.items[0]!.label = "mutated label";
    assignment.allowedModels[0] = other;
    assignment.analysis.requiredCapabilities[0] = "mutated capability";
    plan.requiredModelIds[0] = other;
    const result = await pending;
    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(actualModels, [selected]);
    assert.match(result.text, /Models: fixture\/model/);
    assert.doesNotMatch(result.text, /fixture\/other/);
    const events = (await new EventStore(input.stateRoot, result.runId).readAll()).events;
    const routed = events.find((event) => event.type === "MODEL_ROUTED");
    assert.ok(routed?.type === "MODEL_ROUTED");
    assert.equal(routed.payload.model, selected);
    assert.deepEqual(routed.payload.eligibleModels, [selected]);
    assert.deepEqual(routed.payload.behaviorDistribution, { [selected]: 1 });
    assert.deepEqual(routed.payload.rejections, [{ modelId: other, constraint: "capability", detail: "original refusal" }]);
    assert.equal(routed.payload.approvalPlan.id, base.decision.approvalPlan.id);
    assert.equal(routed.payload.approvalPlan.items[0]!.label, `Use ${selected}`);
  });
});
