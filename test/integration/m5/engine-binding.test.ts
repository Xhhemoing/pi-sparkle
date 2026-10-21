import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createMessageId, createTaskId } from "../../../src/domain/ids.js";
import { validateConfidenceScore, type Flowchart } from "../../../src/domain/flowchart.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { startRun, startParentRun } from "../../../src/run/coordinator.js";
import { startSupervisedRun, resumeSupervisedRun } from "../../../src/run/supervisor.js";
import { startFlowchartRun, resumeFlowchartRun, pauseFlowchartRun, injectFlowchartRun, unblockFlowchartRun } from "../../../src/run/flowchart-run.js";
import { startTrackedRun } from "../../../src/track/loop.js";
import { EventStore } from "../../../src/run/event-store.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { materializeCheckpoint, replayRun, validateCheckpoint } from "../../../src/run/replay.js";
import { replayFromCheckpointOffset } from "../../../src/run/incremental-replay.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { TaskNode } from "../../../src/domain/task.js";

const A = { kind: "managed-pi" as const, generationId: "11111111-1111-4111-8111-111111111111" };
const B = { kind: "managed-pi" as const, generationId: "22222222-2222-4222-8222-222222222222" };
const registry = createAgentProfileRegistry(defaultAgentProfiles());
const router = () => createModelRouter({ policyVersion: "binding-test", models: [{ id: "cheap", version: "1", roles: ["actor", "critic", "judge", "router"], maxComplexity: "HIGH", estimatedCostUsd: 0.1, estimatedDurationMs: 1 }] });
const flowchart = (approvalRequired = false): Flowchart => ({ id: "binding", nodes: [{ id: "work", taskId: createTaskId(() => "work"), role: "actor", objective: "do work", modelPolicy: { allowedModels: ["cheap"] }, confidenceThreshold: validateConfidenceScore(0.7), approvalRequired }], edges: [] });
const child = (): ChildTaskInput => ({ taskId: createTaskId(() => "work"), role: "worker", objective: "do work", profile: registry.resolve("worker"), inputArtifactIds: [], acceptanceCriteria: [], limits: { maxAttempts: 2, timeoutMs: 1000, maxWallTimeMs: 5000 } });
const task = (id = "work", dependencies: string[] = []): TaskNode => ({ id: createTaskId(() => id), title: id, objective: id, role: "worker", dependencies: dependencies.map((dep) => createTaskId(() => dep)), acceptanceCriteria: [], status: "PENDING", attempt: 0, maxAttempts: 2, timeoutMs: 1000, artifactIds: [], evidenceIds: [] });
function executor(onExecute: (request: AgentExecutionRequest) => void = () => {}): AgentExecutor {
  return { async *execute(request): AsyncIterable<ExecutionEvent> {
    onExecute(request);
    yield { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: new Date().toISOString() as never, runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: SUPERVISOR, type: "TASK_RESULT", outcome: "SUCCESS", summary: "done", artifactIds: [], evidenceIds: [], verification: { kind: "PASSED", evidenceIds: [] } } };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  } };
}
function context(binding = A) { return { binding: { ...binding }, assertQualifiedGeneration: async (_binding: typeof A) => {} }; }
async function roots(body: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const directory = fileURLToPath(new URL("../../../.agent_workspace/staged-continuation/", import.meta.url));
  await mkdir(directory, { recursive: true });
  const base = await mkdtemp(join(directory, "m5-binding-case-"));
  const stateRoot = join(base, "state");
  try { await body(stateRoot, base); } finally { await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}
const starts = {
  plain: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startRun({ stateRoot, executor: exec, engineContext }, { projectRoot, objective: "binding" }).done,
  parent: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startParentRun({ stateRoot, executor: exec, engineContext }, { projectRoot, objective: "binding", children: [child()] }).done,
  supervised: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startSupervisedRun({ stateRoot, executor: exec, registry, engineContext }, { projectRoot, objective: "binding", tasks: [task("first"), task("work", ["first"])] }).done,
  thin: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startFlowchartRun({ stateRoot, executor: exec, router: router(), engineContext }, { projectRoot, flowchart: flowchart() }),
  flowchartChild: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startFlowchartRun({ stateRoot, executor: exec, router: router(), engineContext }, { projectRoot, flowchart: flowchart(), childTasks: [child()] }),
  clarification: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startTrackedRun({ stateRoot, projectRoot, executor: exec, objective: "Build a feature", primaryModelId: "cheap", engineContext }),
  tracked: (stateRoot: string, projectRoot: string, exec: AgentExecutor, engineContext: ReturnType<typeof context>) => startTrackedRun({ stateRoot, projectRoot, executor: exec, objective: "Build a feature", primaryModelId: "cheap", assumeDefaults: true, engineContext })
};
for (const [name, start] of Object.entries(starts)) {
  test(`${name} persists the captured A binding on root and children`, async () => roots(async (stateRoot, projectRoot) => {
    let checks = 0;
    const engineContext = context();
    engineContext.assertQualifiedGeneration = async (binding) => { assert.deepEqual(binding, A); checks++; };
    const outcome = await start(stateRoot, projectRoot, executor(() => { engineContext.binding.generationId = B.generationId; }), engineContext);
    assert.ok(checks > 0);
    assert.deepEqual(outcome.checkpoint.run?.engineBinding, A);
    const created = outcome.events.filter((event) => event.type === "CHILD_RUN_CREATED");
    for (const event of created) {
      if (event.type !== "CHILD_RUN_CREATED") continue;
      assert.deepEqual(event.payload.childRun.engineBinding, A);
      const own = (await new EventStore(stateRoot, event.payload.childRun.id).readAll()).events.find((row) => row.type === "RUN_CREATED");
      assert.equal(own?.type, "RUN_CREATED");
      if (own?.type === "RUN_CREATED") assert.deepEqual(own.payload.run.engineBinding, A);
    }
    if (["parent", "supervised", "flowchartChild", "tracked"].includes(name)) assert.ok(created.length > 0);
  }));
  test(`${name} refuses failed qualification before any persistent root or execution`, async () => roots(async (stateRoot, projectRoot) => {
    let executions = 0;
    const engineContext = context();
    engineContext.assertQualifiedGeneration = async () => { throw new Error("generation A missing"); };
    await assert.rejects(() => start(stateRoot, projectRoot, executor(() => { executions++; }), engineContext), /generation A missing/);
    assert.equal(executions, 0);
    assert.deepEqual(await readdir(stateRoot).catch(() => []), []);
  }));
}

test("pending availability captures binding and callback before await and leaves no records", async () => roots(async (stateRoot, projectRoot) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ctx = context();
  ctx.assertQualifiedGeneration = async (binding) => { assert.deepEqual(binding, A); await held; };
  const handle = startParentRun({ stateRoot, executor: executor(), engineContext: ctx }, { projectRoot, objective: "held", children: [child()] });
  ctx.binding.generationId = B.generationId;
  ctx.assertQualifiedGeneration = async () => { throw new Error("mutable callback used"); };
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(await readdir(stateRoot).catch(() => []), []);
  } finally { release(); }
  assert.deepEqual((await handle.done).checkpoint.run?.engineBinding, A);
}));

test("EventStore replay checkpoint reload and incremental replay retain binding and absent legacy", async () => roots(async (stateRoot, projectRoot) => {
  for (const engineContext of [context(), undefined]) {
    const outcome = await startRun({ stateRoot, executor: executor(), ...(engineContext === undefined ? {} : { engineContext }) }, { projectRoot, objective: "round trip" }).done;
    const events = (await new EventStore(stateRoot, outcome.runId).readAll()).events;
    const replayed = replayRun(events);
    await new CheckpointStore(stateRoot, outcome.runId).write(materializeCheckpoint(replayed, new Date().toISOString() as never));
    const checkpoint = validateCheckpoint(await new CheckpointStore(stateRoot, outcome.runId).read());
    assert.deepEqual(checkpoint.run?.engineBinding, engineContext?.binding);
    assert.equal(Object.hasOwn(checkpoint.run!, "engineBinding"), engineContext !== undefined);
    assert.deepEqual(replayFromCheckpointOffset(events, checkpoint.lastEventId).state.run?.engineBinding, engineContext?.binding);
  }
}));

test("flowchart executable resumes refuse mismatched or missing availability before restore writes", async () => roots(async (stateRoot, projectRoot) => {
  const first = await startFlowchartRun({ stateRoot, router: router(), engineContext: context() }, { projectRoot, flowchart: flowchart(true) });
  const checkpointStore = new CheckpointStore(stateRoot, first.runId);
  const before = await checkpointStore.read();
  const eventsBefore = (await new EventStore(stateRoot, first.runId).readAll()).events;
  for (const engineContext of [undefined, context(B), { ...context(), assertQualifiedGeneration: async () => { throw new Error("generation A missing"); } }]) {
    await assert.rejects(() => resumeFlowchartRun({ stateRoot, router: router(), ...(engineContext === undefined ? {} : { engineContext }) }, first.runId, { unpause: true }), /engine|generation/i);
    assert.deepEqual(await checkpointStore.read(), before);
    assert.deepEqual((await new EventStore(stateRoot, first.runId).readAll()).events, eventsBefore);
  }
}));

async function seedSupervised(stateRoot: string, projectRoot: string, managed = true) {
  const source = await startSupervisedRun({ stateRoot: join(stateRoot, "source"), executor: executor(), registry, ...(managed ? { engineContext: context() } : {}) }, { projectRoot, objective: "seed resume", tasks: [task()] }).done;
  const graphAt = source.events.findIndex((event) => event.type === "TASK_GRAPH_ACCEPTED");
  assert.ok(graphAt >= 0);
  const store = new EventStore(stateRoot, source.runId);
  for (const event of source.events.slice(0, graphAt + 1)) await store.append(event);
  return source.runId;
}

test("supervised executable resume refuses engine mismatch and missing generation before new records", async () => roots(async (stateRoot, projectRoot) => {
  const runId = await seedSupervised(stateRoot, projectRoot);
  const store = new EventStore(stateRoot, runId);
  const before = (await store.readAll()).events;
  for (const engineContext of [undefined, context(B), { ...context(), assertQualifiedGeneration: async () => { throw new Error("generation A missing"); } }]) {
    let executions = 0;
    await assert.rejects(resumeSupervisedRun({ stateRoot, registry, executor: executor(() => { executions++; }), ...(engineContext === undefined ? {} : { engineContext }) }, runId).done, /engine|generation/i);
    assert.equal(executions, 0);
    assert.deepEqual((await store.readAll()).events, before);
    assert.equal(await new CheckpointStore(stateRoot, runId).read(), undefined);
  }
}));

test("supervised resumed children use event A despite checkpoint B", async () => roots(async (stateRoot, projectRoot) => {
  const runId = await seedSupervised(stateRoot, projectRoot);
  const checkpoint = materializeCheckpoint(replayRun((await new EventStore(stateRoot, runId).readAll()).events), new Date().toISOString() as never);
  await new CheckpointStore(stateRoot, runId).write({ ...checkpoint, run: { ...checkpoint.run, engineBinding: B } });
  const checked: string[] = [];
  const outcome = await resumeSupervisedRun({ stateRoot, registry, executor: executor(), engineContext: { binding: A, assertQualifiedGeneration: async (binding) => { checked.push(binding.generationId); } } }, runId).done;
  assert.deepEqual(checked, [A.generationId]);
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.checkpoint.run?.engineBinding, A);
  const created = outcome.events.filter((event) => event.type === "CHILD_RUN_CREATED");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]!.payload.childRun.engineBinding, A);
}));

test("supervised terminal metadata return preserves A without context or qualification", async () => roots(async (stateRoot, projectRoot) => {
  const first = await startSupervisedRun({ stateRoot, registry, executor: executor(), engineContext: context() }, { projectRoot, objective: "terminal", tasks: [task()] }).done;
  for (const engineContext of [undefined, { binding: B, assertQualifiedGeneration: async () => { throw new Error("must not qualify metadata"); } }]) {
    const result = await resumeSupervisedRun({ stateRoot, registry, executor: executor(() => { assert.fail("metadata dispatched"); }), ...(engineContext === undefined ? {} : { engineContext }) }, first.runId).done;
    assert.deepEqual(result.checkpoint.run?.engineBinding, A);
    assert.equal(result.events.length, first.events.length);
  }
  assert.throws(() => resumeSupervisedRun({ stateRoot, registry, executor: executor(), engineContext: { binding: A } as never }, first.runId), /QualifiedGeneration/);
}));

test("legacy supervised and flowchart resumes remain absent and reject managed adoption", async () => roots(async (stateRoot, projectRoot) => {
  const runId = await seedSupervised(stateRoot, projectRoot, false);
  await assert.rejects(resumeSupervisedRun({ stateRoot, registry, executor: executor(), engineContext: context() }, runId).done, /legacy/);
  const legacy = await resumeSupervisedRun({ stateRoot, registry, executor: executor() }, runId).done;
  assert.equal(Object.hasOwn(legacy.checkpoint.run!, "engineBinding"), false);
  const first = await startFlowchartRun({ stateRoot, router: router() }, { projectRoot, flowchart: flowchart(true) });
  await assert.rejects(() => resumeFlowchartRun({ stateRoot, router: router(), engineContext: context() }, first.runId), /legacy/);
  const resumed = await resumeFlowchartRun({ stateRoot, router: router() }, first.runId);
  assert.equal(Object.hasOwn(resumed.checkpoint.run!, "engineBinding"), false);
}));

test("flowchart replacement child and rewritten checkpoint retain event A over edited checkpoint B", async () => roots(async (stateRoot, projectRoot) => {
  let paused = false;
  const pause = { token: async () => ({ paused }), requestPause: async () => ({ paused: true }), clearPause: async () => { paused = false; } };
  const firstChild = { ...child(), taskId: createTaskId(() => "first") };
  const secondChild = { ...child(), taskId: createTaskId(() => "second") };
  const definition = compileChildrenToFlowchart([
    { taskId: firstChild.taskId, role: "worker", objective: "first" },
    { taskId: secondChild.taskId, role: "worker", objective: "second", dependsOn: [firstChild.taskId] }
  ], { allowedModels: ["cheap"], preferredModel: "cheap" });
  const first = await startFlowchartRun({ stateRoot, router: router(), engineContext: context(), pause, executor: executor(() => { paused = true; }) }, { projectRoot, flowchart: definition, childTasks: [firstChild, secondChild] });
  assert.equal(first.status, "PAUSED");
  const checkpointStore = new CheckpointStore(stateRoot, first.runId);
  const checkpoint = validateCheckpoint(await checkpointStore.read());
  await checkpointStore.write({ ...checkpoint, run: { ...checkpoint.run, engineBinding: B } });
  const checks: string[] = [];
  const resumed = await resumeFlowchartRun({ stateRoot, router: router(), pause, executor: executor(), engineContext: { binding: A, assertQualifiedGeneration: async (binding) => { checks.push(binding.generationId); } } }, first.runId, { unpause: true });
  assert.equal(resumed.status, "COMPLETED");
  assert.deepEqual(checks, [A.generationId]);
  const children = resumed.events.filter((event) => event.type === "CHILD_RUN_CREATED");
  assert.equal(children.length, 2);
  for (const event of children) assert.deepEqual(event.payload.childRun.engineBinding, A);
  assert.deepEqual(resumed.checkpoint.run?.engineBinding, A);
  assert.deepEqual(validateCheckpoint(await checkpointStore.read()).run?.engineBinding, A);
}));

test("flowchart pause and inject controls retain managed binding without loading engine", async () => roots(async (stateRoot, projectRoot) => {
  const first = await startFlowchartRun({ stateRoot, router: router(), engineContext: context() }, { projectRoot, flowchart: flowchart(true) });
  const paused = await pauseFlowchartRun({ stateRoot, router: router() }, first.runId, "hold");
  assert.deepEqual(paused.checkpoint.run?.engineBinding, A);
  const injected = await injectFlowchartRun({ stateRoot, router: router() }, first.runId, { kind: "fact", key: "binding-check", value: "metadata" });
  assert.deepEqual(injected.checkpoint.run?.engineBinding, A);
}));

test("parent retry cascade and cluster spawn retain A after caller context changes B", async () => roots(async (stateRoot, projectRoot) => {
  const ctx = context();
  let checks = 0;
  ctx.assertQualifiedGeneration = async () => { checks++; };
  const models: string[] = [];
  let spawned = false;
  const exec: AgentExecutor = { async *execute(request): AsyncIterable<ExecutionEvent> {
    ctx.binding.generationId = B.generationId;
    if (!spawned) {
      spawned = true;
      assert.ok(request.cluster);
      request.cluster.spawn({ role: "worker", objective: "spawned" });
    }
    if (request.taskId === createTaskId(() => "work")) models.push(request.modelId ?? "");
    const fail = request.taskId === createTaskId(() => "work") && models.length === 1;
    yield { type: "MESSAGE", message: { protocolVersion: 1, id: createMessageId(), occurredAt: new Date().toISOString() as never, runId: request.runId, taskId: request.taskId, from: request.agentInstanceId, to: SUPERVISOR, type: "TASK_RESULT", outcome: fail ? "FAILURE" : "SUCCESS", summary: "fixture", artifactIds: [], evidenceIds: [], verification: { kind: fail ? "FAILED" : "PASSED", evidenceIds: [] }, ...(fail ? { failure: { category: "MODEL_ERROR" as const, detail: "quality" } } : {}) } };
    yield { type: "EXECUTION_FINISHED", outcome: fail ? "FAILURE" : "SUCCESS" };
  } };
  const input: ChildTaskInput = { ...child(), role: "planner", profile: registry.resolve("planner"), assignedModel: "cheap", cascade: { highRisk: false, tiers: [{ modelId: "cheap", version: "1" }, { modelId: "premium", version: "1" }] } };
  const result = await startParentRun({ stateRoot, executor: exec, cluster: true, engineContext: ctx }, { projectRoot, objective: "retry and spawn", children: [input] }).done;
  assert.equal(result.status, "COMPLETED");
  assert.equal(checks, 1);
  assert.deepEqual(models, ["cheap", "premium"]);
  assert.ok(result.events.some((event) => event.type === "TASK_RETRY"));
  const children = result.events.filter((event) => event.type === "CHILD_RUN_CREATED");
  assert.equal(children.length, 2);
  for (const event of children) assert.deepEqual(event.payload.childRun.engineBinding, A);
}));

test("flowchart unblock retains event binding without an engine context", async () => roots(async (stateRoot, projectRoot) => {
  const blocked = await startFlowchartRun({ stateRoot, router: router(), engineContext: context() }, { projectRoot, flowchart: flowchart() });
  assert.equal(blocked.status, "BLOCKED");
  const reopened = await unblockFlowchartRun({ stateRoot, router: router() }, blocked.runId, { reason: "operator provided missing result" });
  assert.equal(reopened.status, "RUNNING");
  assert.deepEqual(reopened.checkpoint.run?.engineBinding, A);
}));

test("completed flowchart execution resume still requires its recorded engine", async () => roots(async (stateRoot, projectRoot) => {
  const first = await startFlowchartRun({ stateRoot, router: router(), executor: executor(), engineContext: context() }, { projectRoot, flowchart: flowchart() });
  assert.equal(first.status, "COMPLETED");
  await assert.rejects(() => resumeFlowchartRun({ stateRoot, router: router() }, first.runId), /original engine/);
}));
