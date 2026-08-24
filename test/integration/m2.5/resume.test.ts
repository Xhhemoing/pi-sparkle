import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createTaskId, parseTaskId, type ArtifactId, type EvidenceId, type MessageId, type RunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import type { RequirementContract } from "../../../src/domain/contract.js";
import type { AcceptanceCriterion } from "../../../src/domain/task.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowNode,
  type JoinPolicy
} from "../../../src/domain/flowchart.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { cheapFirstTiers, liveCascadePlanFromAssignment } from "../../../src/routing/live-cascade.js";
import { main, type CliIo } from "../../../src/cli/main.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { Event } from "../../../src/run/events.js";
import { EventStore } from "../../../src/run/event-store.js";
import {
  resumeFlowchartRun,
  startFlowchartRun,
  unblockFlowchartRun
} from "../../../src/run/flowchart-run.js";
import type { PauseController, PauseToken } from "../../../src/run/pause-controller.js";
import { CheckpointStore } from "../../../src/run/checkpoint-store.js";
import { validateCheckpoint } from "../../../src/run/replay.js";
import { withIsolatedPiEnv } from "../../helpers/pi-env.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", version: "cheap-v1", roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as const, estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", version: "premium-v1", roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as const, estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};

interface NodeOpts {
  role?: FlowNode["role"];
  models?: readonly string[];
  preferred?: string;
  threshold?: number;
  approvalRequired?: boolean;
  parallelGroup?: string;
  joinPolicy?: JoinPolicy;
}

function node(id: string, opts: NodeOpts = {}): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: opts.role ?? "actor",
    objective: `Do ${id}`,
    modelPolicy: {
      allowedModels: opts.models ?? ["cheap", "premium"],
      ...(opts.preferred !== undefined ? { preferredModel: opts.preferred } : {})
    },
    confidenceThreshold: validateConfidenceScore(opts.threshold ?? 0.7),
    approvalRequired: opts.approvalRequired ?? false,
    ...(opts.parallelGroup !== undefined ? { parallelGroup: opts.parallelGroup } : {}),
    ...(opts.joinPolicy !== undefined ? { joinPolicy: opts.joinPolicy } : {})
  };
}

const successEdge = (from: string, to: string): FlowEdge => ({
  from,
  to,
  condition: { type: "success", expected: true }
});

function router(): ModelRouter {
  return createModelRouter(routerConfig);
}

function fakeResult(confidence: number, evidence: string): ChildNodeResult {
  return {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(confidence),
    evidenceIds: [evidence],
    facts: [{ key: "coverage", value: "green", confidence: validateConfidenceScore(confidence) }]
  };
}

function selectiveFlowchart(): Flowchart {
  return {
    id: "crash-selective",
    nodes: [
      node("start"),
      node("cheapSpec", { models: ["cheap"], parallelGroup: "specialists" }),
      node("premiumSpec", { models: ["premium"], preferred: "premium", parallelGroup: "specialists" }),
      node("merge", {
        role: "critic",
        models: ["cheap", "premium"],
        joinPolicy: { mode: "all", requiredNodeIds: ["cheapSpec", "premiumSpec"] }
      }),
      node("selector", { role: "router", models: ["premium"], approvalRequired: true }),
      node("pathA", { models: ["cheap"] }),
      node("pathB", { models: ["premium"], preferred: "premium" })
    ],
    edges: [
      successEdge("start", "cheapSpec"),
      successEdge("start", "premiumSpec"),
      {
        from: "cheapSpec",
        to: "merge",
        condition: { type: "confidence", operator: "gte", value: validateConfidenceScore(0.8) }
      },
      successEdge("premiumSpec", "merge"),
      successEdge("merge", "selector"),
      successEdge("selector", "pathA"),
      successEdge("selector", "pathB")
    ]
  };
}

const specialistResults: Readonly<Record<string, ChildNodeResult>> = {
  start: fakeResult(0.9, "evd_start"),
  cheapSpec: fakeResult(0.91, "evd_cheap"),
  premiumSpec: fakeResult(0.88, "evd_premium"),
  merge: fakeResult(0.86, "evd_merge")
};

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-resume-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m25-resume-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function deps(stateRoot: string) {
  return {
    stateRoot,
    router: router(),
    now: () => parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
    generateId: sequenceGenerator()
  };
}

function routedCount(events: readonly { type: string }[]): number {
  return events.filter((event) => event.type === "MODEL_ROUTED").length;
}

test("crash after WAITING_FOR_USER restores pending plan and decisions from disk", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      objective: "Crash mid-approval",
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    const firstRouted = routedCount(first.events);
    const pendingPlan = first.pendingApproval?.plan;
    assert.ok(pendingPlan);
    const firstDecisions = first.snapshot.decisions.map((decision) => decision.model);

    // Fresh process: new router, stores, and supervisor loaded only from stateRoot+runId.
    const restored = await resumeFlowchartRun(deps(stateRoot), first.runId);
    assert.equal(restored.status, "WAITING_FOR_USER");
    assert.ok(restored.pendingApproval);
    assert.deepEqual(restored.pendingApproval.plan, pendingPlan);
    assert.deepEqual(
      restored.snapshot.decisions.map((decision) => decision.model),
      firstDecisions
    );
    assert.equal(restored.snapshot.nodes["start"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["cheapSpec"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["premiumSpec"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["merge"]?.state, "COMPLETED");
    assert.equal(restored.snapshot.nodes["selector"]?.state, "WAITING_FOR_USER");
    assert.ok(restored.snapshot.activeRoutes["selector"], "waiting selector keeps its active route");
    assert.equal(restored.snapshot.activeRoutes["selector"]?.model, first.snapshot.activeRoutes["selector"]?.model);
    assert.deepEqual(restored.snapshot.activeRoutes, first.snapshot.activeRoutes);
    assert.equal(routedCount(restored.events), firstRouted, "completed work must not be rerouted");

    const continued = await resumeFlowchartRun(deps(stateRoot), first.runId, {
      approvalReply: { approvalPlanId: pendingPlan.id, selectedActionIds: ["pathA"] },
      childResults: { pathA: fakeResult(0.84, "evd_pathA") }
    });
    assert.equal(continued.status, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathA"]?.state, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathB"]?.state, "SKIPPED");
    assert.equal(continued.snapshot.nodes["start"]?.state, "COMPLETED");
    const pathARoutes = continued.events.filter(
      (event) => event.type === "MODEL_ROUTED" && (event.payload as { taskId: string }).taskId === "tsk_pathA"
    );
    assert.equal(pathARoutes.length, 1);
    assert.equal(
      continued.events.filter(
        (event) => event.type === "MODEL_ROUTED" && (event.payload as { taskId: string }).taskId === "tsk_start"
      ).length,
      1,
      "completed start node is not rerun"
    );
  });
});

/**
 * R5-5's investigation asked whether resume should adopt a child result the
 * parent log already carries but the supervisor never accepted. The answer
 * turns on *which* seam an adoption would go through, so both seams are pinned
 * here.
 *
 * This one is the seam that already exists: caller-supplied `childResults` are
 * applied straight to the supervisor, with no three-line gate. It is the right
 * shape for results the caller vouches for and the wrong shape for results
 * reconstructed from a log, which is why a future log adoption must go through
 * `applyChildThreeLine` instead of reusing this path.
 */
test("caller-supplied childResults are applied without a three-line gate", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    const pendingPlan = first.pendingApproval?.plan;
    assert.ok(pendingPlan);

    const continued = await resumeFlowchartRun(deps(stateRoot), first.runId, {
      approvalReply: { approvalPlanId: pendingPlan.id, selectedActionIds: ["pathA"] },
      childResults: { pathA: fakeResult(0.84, "evd_pathA") }
    });

    // The supplied results really were applied...
    assert.equal(continued.status, "COMPLETED");
    assert.equal(continued.snapshot.nodes["pathA"]?.state, "COMPLETED");
    assert.equal(continued.snapshot.nodes["merge"]?.state, "COMPLETED");

    // ...and nothing gated them. No assessment, no transition, on either leg.
    for (const events of [first.events, continued.events]) {
      assert.equal(
        events.some((event) => event.type === "TRACKING_ASSESSMENT" || event.type === "GATE_TRANSITION"),
        false,
        "childResults bypass the acceptance gate entirely"
      );
    }
  });
});

test("resume fails closed when the checkpoint is missing", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    await rm(join(stateRoot, "runtime", "runs", first.runId, "checkpoint.json"));
    await assert.rejects(
      () => resumeFlowchartRun(deps(stateRoot), first.runId),
      /no durable checkpoint|refusing to invent/
    );
  });
});

/**
 * R6-2 measured what a resume lost; R7-1 stopped losing most of it.
 * `childTasksFromLog` rebuilds each resumed child from the parent log, so the
 * caller's objective, artifacts, criteria and budget come back for any node the
 * log has seen run. The tests below pin what is left: the substitution a node
 * that never ran gets, the contract seam, and the premise the whole rebuild
 * rests on — that the log really does carry every field.
 */

/**
 * R8-2 landed three tripwires recording that no run contract was durable.
 * These are their positive replacements: same four seams, now asserting the
 * field is written, validated, restored and projected rather than absent. The
 * one clause that did not flip is the episode rule — the contract must still
 * never be reconstructed from the episode's acceptance criteria.
 */
test("the flowchart checkpoint, its validator, its writer and both restorers carry the run contract", async () => {
  const [replay, checkpointStore, flowchartRun] = await Promise.all([
    readFile(new URL("../../../src/run/replay.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../src/run/checkpoint-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../src/run/flowchart-run.ts", import.meta.url), "utf8")
  ]);
  const checkpointState = replay.match(/export interface FlowchartCheckpointState \{[\s\S]*?^\}$/m)?.[0];
  const checkpointValidator = replay.match(
    /export function validateFlowchartCheckpointState[\s\S]*?^\}$/m
  )?.[0];
  const checkpointWriter = flowchartRun.match(/async function persistCheckpoint[\s\S]*?^\}$/m)?.[0];
  const sessionRestorer = flowchartRun.match(/async function restoreFlowchartSession[\s\S]*?^\}$/m)?.[0];
  const resumeRestorer = flowchartRun.match(/async function resumeLockedFlowchartRun[\s\S]*?^\}$/m)?.[0];
  const unblockWriter = flowchartRun.match(/async function unblockLockedFlowchartRun[\s\S]*?^\}$/m)?.[0];

  assert.ok(checkpointState, "FlowchartCheckpointState remains structurally inspectable");
  assert.ok(checkpointValidator, "the flowchart checkpoint validator remains structurally inspectable");
  assert.ok(checkpointWriter, "the flowchart checkpoint writer remains structurally inspectable");
  assert.ok(sessionRestorer, "the pause/inject checkpoint restore remains structurally inspectable");
  assert.ok(resumeRestorer, "the resume restore remains structurally inspectable");
  assert.ok(unblockWriter, "the unblock checkpoint writer remains structurally inspectable");

  assert.match(checkpointState, /contract\?: RequirementContract/);
  assert.match(checkpointValidator, /validateRequirementContract/);
  assert.match(checkpointValidator, /Invalid RunCheckpoint: flowchart\.contract/);
  assert.match(checkpointWriter, /ctx\.contract !== undefined \? \{ contract: ctx\.contract \}/);
  assert.match(sessionRestorer, /checkpoint\.flowchart\.contract/);
  assert.match(
    resumeRestorer,
    /continuation\.contract \?\? checkpoint\.flowchart\.contract/,
    "an explicit continuation stays authoritative over the run's durable value"
  );
  // The unblock is the one writer that rebuilds the flowchart payload from
  // parts instead of from `ctx`, so it is the one that could silently drop the
  // field. Authorizing a blocked run must not change what it was asked to honour.
  assert.match(unblockWriter, /\.\.\.\(contract !== undefined \? \{ contract \} : \{\}\)/);

  // The store is a crash-atomic JSON byte store and stays schema-agnostic: it
  // learned nothing about this field, which is why no store change was needed.
  assert.doesNotMatch(checkpointStore, /\bcontract\b/);

  // R8-4 §5.3 wants per-task acceptance criteria on this same seam later. The
  // seam is reserved in prose only; implementing the field is option (a)'s own
  // signed-off diff, so the type must not have grown it here.
  assert.match(checkpointState, /Reserved: per-task acceptance criteria/);
  assert.doesNotMatch(
    checkpointState,
    /acceptanceCriteria\??:/,
    "the reserved sibling field stays reserved, not implemented"
  );
});

test("episode binding still retains acceptance criteria, and never the run contract", async () => {
  const source = await readFile(new URL("../../../src/run/episode-bind.ts", import.meta.url), "utf8");
  const openedEpisode = source.match(/const opened = openEpisode\(\{[\s\S]*?^ {2}\}\);/m)?.[0];

  assert.ok(openedEpisode, "the episode projection remains structurally inspectable");
  assert.match(openedEpisode, /acceptance: contract\.acceptanceCriteria/);
  // Unchanged by the durable contract, and load-bearing because of it: the
  // episode is a lossy projection, so a resume that read its constraints back
  // from here would present an empty list as the run's own.
  assert.doesNotMatch(
    openedEpisode,
    /\b(?:contract|constraints)\s*:/,
    "neither the full contract nor its constraints are projected onto the episode"
  );
});

test("the CLI flowchart continuation recovers the run contract from the checkpoint", async () => {
  const source = await readFile(new URL("../../../src/cli/main.ts", import.meta.url), "utf8");
  const continuationBuilder = source.match(/function flowchartContinuation[\s\S]*?^\}$/m)?.[0];
  // R8-2's version anchored the end of this region on `const PREFERENCE_SCOPES`,
  // which R8-1's `unblockCommand` then slipped inside. The function's own
  // column-zero closing brace is the boundary; the guard below keeps it one.
  const resumeCommand = source.match(/async function resumeCommand\b[\s\S]*?^\}$/m)?.[0];
  const answerCommand = source.match(/async function answerCommand\b[\s\S]*?^\}$/m)?.[0];

  assert.ok(continuationBuilder, "flowchartContinuation remains structurally inspectable");
  assert.ok(resumeCommand, "resumeCommand remains structurally inspectable");
  assert.ok(answerCommand, "answerCommand remains structurally inspectable");
  assert.doesNotMatch(
    resumeCommand,
    /\bunblockCommand\b/,
    "the captured region is resumeCommand alone; a neighbouring command must not drift into it"
  );

  assert.match(continuationBuilder, /checkpoint\?: RunCheckpoint/);
  assert.match(
    continuationBuilder,
    /const contract = opts\.checkpoint\?\.flowchart\?\.contract;/,
    "the continuation projects the checkpoint's contract and reconstructs nothing"
  );
  assert.match(continuationBuilder, /\.\.\.\(contract !== undefined \? \{ contract \} : \{\}\)/);

  // One projection, both production continuation paths.
  for (const [name, region] of [
    ["resumeCommand", resumeCommand],
    ["answerCommand", answerCommand]
  ] as const) {
    assert.match(
      region,
      /resumeFlowchartRun\([\s\S]*?flowchartContinuation\(\{\s*checkpoint,/,
      `${name} supplies its validated checkpoint to the continuation builder`
    );
  }
});

const CONTRACT_CRITERION = "crit-integration";

function contractCovering(criterionId: string): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "Ship the migration",
    deliverables: [],
    constraints: [
      { id: "con-no-legacy", description: "do not touch src/legacy" },
      { id: "con-stable-api", description: "keep the public API stable" }
    ],
    nonGoals: [],
    acceptanceCriteria: [{ id: criterionId, description: "the integration suite passes" }],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  } as unknown as RequirementContract;
}

function testerChild(taskId: string): ChildTaskInput {
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(taskId),
    role: "tester",
    objective: `Verify ${taskId}`,
    profile: registry.resolve("tester"),
    inputArtifactIds: ["art_seed" as ArtifactId],
    acceptanceCriteria: [{ id: CONTRACT_CRITERION, description: "the integration suite passes" }],
    limits: { maxAttempts: 3, timeoutMs: 45_000, maxWallTimeMs: 900_000 }
  };
}

/** Reports SUCCESS + verification PASSED for every task it is given. */
class PassingExecutor implements AgentExecutor {
  readonly taskIds: string[] = [];
  constructor(private readonly onExecute?: () => void) {}
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.taskIds.push(request.taskId);
    this.onExecute?.();
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_${request.agentInstanceId}` as MessageId,
        occurredAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "all acceptance checks passed",
        artifactIds: [`art_done_${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_done_${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_done_${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** In-memory pause, so a run can stop between nodes without touching disk. */
class TogglePause implements PauseController {
  paused = false;
  async requestPause(_runId: RunId): Promise<PauseToken> {
    this.paused = true;
    return this.token();
  }
  async clearPause(): Promise<void> {
    this.paused = false;
  }
  async token(): Promise<PauseToken> {
    if (!this.paused) return { paused: false };
    return { paused: true, requestedAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z") };
  }
}

interface LoggedTaskRequest {
  readonly taskId: string;
  readonly objective: string;
  readonly inputArtifactIds: readonly string[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly limits: Readonly<Record<string, number>>;
}

function loggedTaskRequests(events: readonly Event[]): LoggedTaskRequest[] {
  return events.flatMap((event) => {
    if (event.type !== "CHILD_MESSAGE") return [];
    const message = event.payload.message as unknown as LoggedTaskRequest & { type: string };
    return message.type === "TASK_REQUEST" ? [message] : [];
  });
}

function dimensionVerdicts(events: readonly Event[], taskId: string): Record<string, string> {
  for (const event of events) {
    if (event.type !== "TRACKING_ASSESSMENT") continue;
    const assessment = event.payload.assessment as unknown as {
      turnId: string;
      dimensions: readonly { id: string; verdict: string }[];
    };
    if (assessment.turnId !== taskId) continue;
    return Object.fromEntries(assessment.dimensions.map((entry) => [entry.id, entry.verdict]));
  }
  return {};
}

/**
 * Two tester children with a contract, paused after the first: the second node
 * is only ever run by a resume, and the log has never seen it, so it is the
 * substitution case rather than the reconstruction one. Faithful reconstruction
 * of a node the log *has* seen is pinned in
 * `test/unit/run/flowchart-run-abort.test.ts`.
 */
async function pausedBeforeSecondChild(
  stateRoot: string,
  projectRoot: string,
  options: { readonly withContract?: boolean } = {}
): Promise<{ runId: RunId; contract: RequirementContract }> {
  const children = [testerChild("tsk_first"), testerChild("tsk_second")];
  const contract = contractCovering(CONTRACT_CRITERION);
  const flowchart = compileChildrenToFlowchart(
    children.map((child, index) => ({
      taskId: child.taskId,
      role: "tester" as const,
      objective: child.objective,
      ...(index > 0 ? { dependsOn: [children[index - 1]!.taskId] } : {})
    }))
  );

  const pause = new TogglePause();
  const first = new PassingExecutor(() => {
    pause.paused = true;
  });
  const paused = await startFlowchartRun(
    { ...deps(stateRoot), executor: first, pause },
    {
      projectRoot,
      flowchart,
      childTasks: children,
      ...(options.withContract === false ? {} : { contract })
    }
  );
  assert.equal(paused.status, "PAUSED");
  assert.deepEqual(first.taskIds, ["tsk_first"]);
  return { runId: paused.runId, contract };
}

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    out: () => out.join(""),
    err: () => err.join("")
  };
}

/** The production command boundary: argv in, exit code out, no injected state. */
async function cli(args: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const captured = capture();
  const code = await withIsolatedPiEnv(() => main([...args], captured.io));
  return { code, out: captured.out(), err: captured.err() };
}

async function storedContract(stateRoot: string, runId: RunId): Promise<unknown> {
  const raw = await new CheckpointStore(stateRoot, runId).read();
  return validateCheckpoint(raw).flowchart?.contract;
}

async function eventsOf(stateRoot: string, runId: RunId): Promise<readonly Event[]> {
  return (await new EventStore(stateRoot, runId).readAll()).events;
}

test("a node the resume has to substitute for gets a budget the caller authorised", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, contract } = await pausedBeforeSecondChild(stateRoot, projectRoot);

    const resumed = await resumeFlowchartRun(
      { ...deps(stateRoot), executor: new PassingExecutor(), pause: new TogglePause() },
      runId,
      { unpause: true, contract }
    );
    assert.equal(resumed.status, "COMPLETED");

    const requests = loggedTaskRequests(resumed.events);
    const started = requests.find((request) => request.taskId === "tsk_first");
    const restarted = requests.find((request) => request.taskId === "tsk_second");
    assert.ok(started, "the first node ran under the caller's spec");
    assert.ok(restarted, "the second node ran under a rebuilt one");

    // The second node has no request of its own on the log, so its criteria and
    // artifacts stay empty — there is nothing to restore and nothing is invented.
    assert.deepEqual(started.acceptanceCriteria.map((criterion) => criterion.id), [CONTRACT_CRITERION]);
    assert.deepEqual(restarted.acceptanceCriteria, []);
    assert.deepEqual(restarted.inputArtifactIds, []);

    // The budget is the one substitution that is made rather than left empty,
    // and it is the sibling's: a budget this run's caller really authorised.
    // Before R7-1 every rebuilt child got {2, 60_000, 3_600_000} instead —
    // twelve times this caller's wall budget and one extra attempt.
    assert.deepEqual(started.limits, { maxAttempts: 3, timeoutMs: 45_000, maxWallTimeMs: 900_000 });
    assert.deepEqual(restarted.limits, started.limits, "the resumed node spends what the caller allowed");

    // And the contract the resume was given reaches its children, so the
    // constraint dimension keeps applying across the resume boundary.
    assert.equal(dimensionVerdicts(resumed.events, "tsk_first")["constraint-retention"], "PASS");
    assert.equal(dimensionVerdicts(resumed.events, "tsk_second")["constraint-retention"], "PASS");
  });
});

/**
 * The half R7-1 could not close, now closed — and this is the pin it flips.
 *
 * **Disclosure.** Until this round the assertion here was the opposite one:
 * `a resume that is handed no contract assesses its children against none`,
 * with `tsk_second` pinned at `NOT_APPLICABLE` because the constraints lived
 * on no record a run id could reach. That was honest and is no longer true:
 * the contract is now written to the flowchart checkpoint, so a resume holding
 * nothing but a run id recovers it. The pin is flipped, not deleted — and it is
 * flipped through the *production CLI boundary*, `main(["resume", …])`, rather
 * than another direct `resumeFlowchartRun` call that hand-feeds a contract. A
 * direct call would only re-prove R7-1's seam; what had to be proved is that
 * the durable record reaches a caller that has nothing else.
 *
 * The run is still seeded through the embedder API, because that is the only
 * producer that takes a contract — no CLI command accepts one. Everything
 * after the seed is the shipped command path: argv, the CLI's own router,
 * pause controller, executor and checkpoint read.
 */
test("a contract-ful run resumed through the CLI assesses its children against it", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, contract } = await pausedBeforeSecondChild(stateRoot, projectRoot);

    // The durable half, before anything reads it back.
    assert.deepEqual(await storedContract(stateRoot, runId), contract);

    const resumed = await cli([
      "resume",
      "--run",
      runId,
      "--state-root",
      stateRoot,
      "--executor",
      "fake",
      "--unpause"
    ]);
    assert.equal(resumed.code, 0, resumed.err);
    assert.match(resumed.out, new RegExp(`Run ${runId}: COMPLETED`));

    const events = await eventsOf(stateRoot, runId);
    assert.equal(dimensionVerdicts(events, "tsk_first")["constraint-retention"], "PASS");
    assert.equal(
      dimensionVerdicts(events, "tsk_second")["constraint-retention"],
      "PASS",
      "the resumed leg is assessed against the run's own durable constraints"
    );

    // And the resume rewrote the checkpoint without dropping what it read.
    assert.deepEqual(await storedContract(stateRoot, runId), contract);
  });
});

/**
 * The runner-side half of the precedence rule, on the call shape the retired
 * pin used. `resumeFlowchartRun` is handed no contract and still has one,
 * because `resumeLockedFlowchartRun` defaults it from the validated
 * checkpoint. The CLI projection above and this default are deliberately two
 * routes to the same value: the CLI one makes the recovery explicit at the
 * boundary an operator uses, this one covers every embedder that resumes by
 * run id alone.
 */
test("a direct resume handed no contract recovers the run's own durable one", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId } = await pausedBeforeSecondChild(stateRoot, projectRoot);

    const resumed = await resumeFlowchartRun(
      { ...deps(stateRoot), executor: new PassingExecutor(), pause: new TogglePause() },
      runId,
      { unpause: true }
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.equal(dimensionVerdicts(resumed.events, "tsk_second")["constraint-retention"], "PASS");
  });
});

/**
 * ...and the order of the two. An embedder that names a contract meant that
 * one, so `continuation.contract` wins: here it carries no constraints, and
 * the resumed leg reports `NOT_APPLICABLE` even though the checkpoint's own
 * contract carries two.
 */
test("an explicit continuation contract outranks the run's durable one", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, contract } = await pausedBeforeSecondChild(stateRoot, projectRoot);
    const unconstrained = { ...contract, constraints: [] } as unknown as RequirementContract;

    const resumed = await resumeFlowchartRun(
      { ...deps(stateRoot), executor: new PassingExecutor(), pause: new TogglePause() },
      runId,
      { unpause: true, contract: unconstrained }
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.equal(
      dimensionVerdicts(resumed.events, "tsk_second")["constraint-retention"],
      "NOT_APPLICABLE",
      "the caller's contract is the effective one, not the stored fallback"
    );
    assert.deepEqual(
      await storedContract(stateRoot, runId),
      unconstrained,
      "and the effective contract is what the resume then checkpoints"
    );
  });
});

/**
 * The other side of the same rule, and the reason the recovery is a projection
 * rather than a reconstruction: a run that started without a contract must
 * still be assessed against none. The bound episode carries acceptance
 * criteria for every run, so a resume that built `{ acceptanceCriteria,
 * constraints: [] }` out of it would report an empty constraint list as the
 * run's own — turning missing evidence into `NOT_APPLICABLE` by way of a claim
 * nobody made. That is the class of lie R7-1 removed.
 */
test("a CLI resume of a run that started without a contract invents none", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId } = await pausedBeforeSecondChild(stateRoot, projectRoot, { withContract: false });
    assert.equal(await storedContract(stateRoot, runId), undefined);

    const resumed = await cli([
      "resume",
      "--run",
      runId,
      "--state-root",
      stateRoot,
      "--executor",
      "fake",
      "--unpause"
    ]);
    assert.equal(resumed.code, 0, resumed.err);

    const events = await eventsOf(stateRoot, runId);
    for (const taskId of ["tsk_first", "tsk_second"]) {
      assert.equal(
        dimensionVerdicts(events, taskId)["constraint-retention"],
        "NOT_APPLICABLE",
        `${taskId} has no constraints to retain, and none were synthesized`
      );
    }
    assert.equal(await storedContract(stateRoot, runId), undefined);
  });
});

/**
 * The unblock is the third writer of a flowchart checkpoint, and the only one
 * that rebuilds the payload from parts rather than from the loop context — so
 * it is the one that can drop the field without any restorer being wrong.
 * Authorizing a blocked run changes what may execute, never what the run was
 * asked to honour.
 */
test("unblocking a blocked run carries its contract onto the reopened checkpoint", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const contract = contractCovering(CONTRACT_CRITERION);
    const blocked = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: { id: "stall", nodes: [node("only", { models: ["cheap"] })], edges: [] },
      objective: "Stall on purpose",
      contract
    });
    assert.equal(blocked.status, "BLOCKED");
    assert.deepEqual(await storedContract(stateRoot, blocked.runId), contract);

    const unblocked = await unblockFlowchartRun(deps(stateRoot), blocked.runId, {
      reason: "operator supplied the missing result out of band"
    });
    assert.equal(unblocked.status, "RUNNING");
    assert.deepEqual(
      await storedContract(stateRoot, blocked.runId),
      contract,
      "the reopen rewrote the checkpoint from parts and kept the contract among them"
    );
  });
});

/**
 * A green CLI-resume test can coexist with a side command silently deleting the
 * contract: `pause` and `inject` share `restoreFlowchartSession` and both end in
 * a checkpoint write, so a restorer that dropped the field would erase it from
 * the run on the next operator action. Proved end to end — pause through the
 * shipped command, then resume, and the resumed leg is still assessed.
 */
test("a pause taken between the legs does not strip the run contract", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, contract } = await pausedBeforeSecondChild(stateRoot, projectRoot);

    const paused = await cli(["pause", "--run", runId, "--reason", "operator stepped away", "--state-root", stateRoot]);
    assert.equal(paused.code, 0, paused.err);
    assert.deepEqual(
      await storedContract(stateRoot, runId),
      contract,
      "the pause rewrote the checkpoint and kept the contract on it"
    );

    const resumed = await cli([
      "resume",
      "--run",
      runId,
      "--state-root",
      stateRoot,
      "--executor",
      "fake",
      "--unpause"
    ]);
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(
      dimensionVerdicts(await eventsOf(stateRoot, runId), "tsk_second")["constraint-retention"],
      "PASS"
    );
  });
});

/**
 * The premise `childTasksFromLog` rests on. R4-6 refused to persist executor
 * config because the log did not carry it; that reason does not apply here.
 * Everything `ChildTaskInput` needs is already durable: `TASK_REQUEST` carries
 * the objective, artifacts, criteria and limits, and the assignment-sourced
 * `MODEL_ROUTED` carries the true `agentRole` plus the `highRisk` and
 * `eligibleModels` that regenerate the cascade through the shipped planner.
 *
 * The rebuild reads exactly these fields, so if a schema change ever drops one
 * of them the resume goes back to substituting — and this test is where that
 * shows up, before the substitution does.
 */
test("the parent log already carries what a faithful child-spec rebuild needs", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const catalog = { policyVersion: routerConfig.policyVersion, models: routerConfig.models };
    const base = testerChild("tsk_verify");
    const assignments = assignTasks({
      tasks: [{ taskId: base.taskId, role: "tester", objective: base.objective }],
      catalog
    });
    const assignment = assignments[0]!;
    // Exactly the production shape `smartChildPlan` builds in cli/main.ts.
    const spec: ChildTaskInput = {
      ...base,
      assignedModel: assignment.decision.model,
      cascade: liveCascadePlanFromAssignment(assignment, catalog)
    };

    const outcome = await startFlowchartRun(
      { ...deps(stateRoot), executor: new PassingExecutor(), pause: new TogglePause() },
      {
        projectRoot,
        flowchart: compileChildrenToFlowchart([
          { taskId: spec.taskId, role: "tester", objective: spec.objective }
        ]),
        childTasks: [spec],
        assignments
      }
    );
    assert.equal(outcome.status, "COMPLETED");

    const request = loggedTaskRequests(outcome.events).find((entry) => entry.taskId === spec.taskId);
    assert.ok(request, "the log carries the task request");

    const routes = outcome.events.flatMap((event) =>
      event.type === "MODEL_ROUTED"
        ? [event.payload as unknown as { taskId: string; role: string; agentRole?: string; model: string; highRisk: boolean; eligibleModels: readonly string[] }]
        : []
    );
    // Two producers write MODEL_ROUTED: the pre-run assignment, which knows the
    // AgentRole, and the supervisor's per-node routing, which only knows the
    // coarser flowchart role. A rebuild must select the one that carries it.
    const routed = routes.find((route) => route.agentRole !== undefined);
    assert.ok(routed, "at least one MODEL_ROUTED carries the agent role");
    assert.equal(routed.agentRole, "tester");
    assert.equal(routed.role, "actor", "the flowchart role alone would coarsen tester to actor");

    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const rebuiltFromLog: ChildTaskInput = {
      taskId: parseTaskId(request.taskId),
      role: routed.agentRole,
      objective: request.objective,
      profile: registry.resolve("tester"),
      inputArtifactIds: [...request.inputArtifactIds] as ArtifactId[],
      acceptanceCriteria: [...request.acceptanceCriteria],
      limits: request.limits as unknown as ChildTaskInput["limits"],
      assignedModel: routed.model,
      cascade: { highRisk: routed.highRisk, tiers: cheapFirstTiers(routed.eligibleModels, catalog.models) }
    };
    assert.deepEqual(rebuiltFromLog, spec, "the log alone rebuilds the spec the run started with");
  });
});

test("resume fails closed on a malformed flowchart snapshot", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const first = await startFlowchartRun(deps(stateRoot), {
      projectRoot,
      flowchart: selectiveFlowchart(),
      childResults: specialistResults
    });
    assert.equal(first.status, "WAITING_FOR_USER");
    const store = new CheckpointStore(stateRoot, first.runId);
    const raw = (await store.read()) as Record<string, unknown>;
    const flowchart = raw.flowchart as { snapshot: { nodes: Record<string, { confidence?: number }> } };
    flowchart.snapshot.nodes["selector"] = { ...flowchart.snapshot.nodes["selector"], confidence: 4 };
    await writeFile(
      join(stateRoot, "runtime", "runs", first.runId, "checkpoint.json"),
      `${JSON.stringify(raw, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(() => resumeFlowchartRun(deps(stateRoot), first.runId), /flowchart\.snapshot|confidence/);
  });
});
