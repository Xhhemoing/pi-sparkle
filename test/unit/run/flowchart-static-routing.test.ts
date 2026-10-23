import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateConfidenceScore, type Flowchart } from "../../../src/domain/flowchart.js";
import { createTaskId } from "../../../src/domain/ids.js";
import { startFlowchartRun, resumeFlowchartRun, injectFlowchartRun } from "../../../src/run/flowchart-run.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";

function router() {
  return createModelRouter({ policyVersion: "static-test", models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1 },
    { id: "premium", version: "premium-v1", roles: ["actor"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 1 }
  ] });
}
function flowchart(wait = false): Flowchart {
  const nodes = ["first", "second"].map((id) => ({ id, taskId: createTaskId(() => id), role: "actor" as const,
    objective: "Inspect parser", modelPolicy: { allowedModels: ["cheap", "premium"] },
    confidenceThreshold: validateConfidenceScore(0.7), approvalRequired: wait && id === "first" }));
  return { id: "static-default", nodes, edges: [{ from: "first", to: "second", condition: { type: "success", expected: true } }] };
}
const result = () => ({ outcome: "SUCCESS" as const, confidence: validateConfidenceScore(0.9), evidenceIds: ["evd_static"], facts: [] });
async function fixture(body: (root: string, stateRoot: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "sparkle-static-flow-"));
  try { await body(root, join(root, "state")); } finally { await rm(root, { recursive: true, force: true }); }
}
async function corrupt(stateRoot: string) {
  await mkdir(join(stateRoot, "adaptation"), { recursive: true });
  await writeFile(join(stateRoot, "adaptation", "registry.json"), "CORRUPT_RESEARCH_STATE", "utf8");
}
function routedModels(outcome: Awaited<ReturnType<typeof startFlowchartRun>>) {
  return outcome.events.flatMap((event) => event.type === "MODEL_ROUTED" ? [event.payload.model] : []);
}

test("default flowchart start ignores corrupt research state and retains static multi-model routing", async () => {
  await fixture(async (root, stateRoot) => {
    await corrupt(stateRoot);
    const outcome = await startFlowchartRun({ stateRoot, router: router() }, { projectRoot: root, objective: "Inspect parser",
      flowchart: flowchart(), childResults: { first: result(), second: result() } });
    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(routedModels(outcome), ["cheap", "cheap"]);
    assert.equal(await readFile(join(stateRoot, "adaptation", "registry.json"), "utf8"), "CORRUPT_RESEARCH_STATE");
  });
});

test("default flowchart continuation ignores research state added after start", async () => {
  await fixture(async (root, stateRoot) => {
    const deps = { stateRoot, router: router() };
    const first = await startFlowchartRun(deps, { projectRoot: root, objective: "Inspect parser", flowchart: flowchart(true) });
    assert.equal(first.status, "WAITING_FOR_USER");
    const pending = first.pendingApproval!;
    await corrupt(stateRoot);
    const outcome = await resumeFlowchartRun(deps, first.runId, {
      approvalReply: { approvalPlanId: pending.plan.id, selectedActionIds: [pending.plan.items[0]!.id] },
      childResults: { first: result(), second: result() }
    });
    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(routedModels(outcome), ["cheap", "cheap"]);
    assert.equal(await readFile(join(stateRoot, "adaptation", "registry.json"), "utf8"), "CORRUPT_RESEARCH_STATE");
  });
});

test("default idle control restoration ignores corrupt learned state without losing pending approval", async () => {
  await fixture(async (root, stateRoot) => {
    const deps = { stateRoot, router: router() };
    const first = await startFlowchartRun(deps, { projectRoot: root, objective: "Inspect parser", flowchart: flowchart(true) });
    assert.equal(first.status, "WAITING_FOR_USER");
    await corrupt(stateRoot);
    const injected = await injectFlowchartRun(deps, first.runId, { actor: "operator", kind: "fact", key: "context", value: "retained" });
    assert.equal(injected.status, "WAITING_FOR_USER");
    assert.deepEqual(injected.pendingApproval, first.pendingApproval);
    assert.ok(injected.events.some((event) => event.type === "INJECTION_REQUESTED"));
    assert.equal(await readFile(join(stateRoot, "adaptation", "registry.json"), "utf8"), "CORRUPT_RESEARCH_STATE");
  });
});

test("a trusted policy transform cannot replace graph identity or mutate the stored definition", async () => {
  await fixture(async (root, stateRoot) => {
    const definition = flowchart();
    const outcome = await startFlowchartRun({ stateRoot, router: router(), loadModelPolicyTransform: async () => (node) => {
      assert.deepEqual(Object.keys(node).sort(), ["modelPolicy", "objective", "role"]);
      Object.assign(node, { id: "REPLACED", objective: "REPLACED", role: "human" });
      (node.modelPolicy.allowedModels as string[])[0] = "unknown";
      return { allowedModels: ["premium"], preferredModel: "premium", id: "REPLACED", objective: "REPLACED" };
    } }, { projectRoot: root, objective: "Inspect parser", flowchart: definition,
      childResults: { first: result(), second: result() } });
    assert.equal(outcome.status, "COMPLETED");
    assert.deepEqual(routedModels(outcome), ["premium", "premium"]);
    assert.deepEqual(outcome.checkpoint.flowchart!.definition, definition);
    assert.deepEqual(definition.nodes.map((node) => node.id), ["first", "second"]);
    assert.ok(definition.nodes.every((node) => node.objective === "Inspect parser" && node.role === "actor"));
    assert.ok(definition.nodes.every((node) => node.modelPolicy.allowedModels.join(",") === "cheap,premium"));
  });
});
