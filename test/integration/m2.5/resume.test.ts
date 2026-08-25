import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createTaskId, parseRunId, parseTaskId, type ArtifactId, type EvidenceId, type MessageId, type RunId } from "../../../src/domain/ids.js";
import { runtimeRoot } from "../../../src/privacy/state-layout.js";
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
import { startTrackedRun } from "../../../src/track/loop.js";
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

async function sourceModules(directory: string): Promise<string[]> {
  const modules: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...(await sourceModules(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) modules.push(path);
  }
  return modules.sort();
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return parent;
  }
  return undefined;
}

function resolvePayloadInitializer(
  parsed: ts.SourceFile,
  call: ts.CallExpression,
  payload: ts.Expression
): ts.Expression {
  if (!ts.isIdentifier(payload)) return payload;
  const payloadName = payload.text;
  const scope = enclosingFunction(call);
  assert.ok(scope, "materializeCheckpoint flowchart payload is written inside a function");
  const declarations: ts.VariableDeclaration[] = [];

  function visit(node: ts.Node): void {
    if (node !== scope && ts.isFunctionLike(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === payloadName &&
      node.initializer !== undefined &&
      node.getStart(parsed) < call.getStart(parsed)
    ) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(scope);
  declarations.sort((left, right) => right.getStart(parsed) - left.getStart(parsed));
  const initializer = declarations[0]?.initializer;
  assert.ok(
    initializer,
    `flowchart payload ${payloadName} must have an inspectable local initializer`
  );
  return initializer;
}

function carriesContractProperty(payload: ts.Expression): boolean {
  let carries = false;
  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ((ts.isIdentifier(node.name) && node.name.text === "contract") ||
        (ts.isStringLiteralLike(node.name) && node.name.text === "contract"))
    ) {
      carries = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(payload);
  return carries;
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

  // R8-4 §5.3's reservation is spent: Loop 4 R11-1 implemented per-task
  // acceptance criteria on this seam as `taskCriteria`, validated fail-closed
  // and still never synthesized. Behavioural coverage is in
  // test/unit/tracking/option-a-preconditions.test.ts.
  assert.match(checkpointState, /taskCriteria\?: TaskAcceptanceCriteria\[\]/);
  assert.match(checkpointState, /never \*synthesized\*/);
  assert.match(
    checkpointValidator,
    /validateTaskCriteria/,
    "the sibling field fails closed the way the contract does"
  );

  // Loop 4 R12-1 filled it. Every seam the contract travels, the record now
  // travels too — same writer, same two restorers, same reopen — because a
  // side command that rewrites the checkpoint learns nothing about what a
  // child was asked to check and so may not forget it. The behavioural halves
  // are the pause test below and the substitution pins above; these are the
  // per-seam tripwires that fail by location when one writer drops it.
  assert.match(checkpointWriter, /ctx\.taskCriteria !== undefined \? \{ taskCriteria: ctx\.taskCriteria \}/);
  assert.match(sessionRestorer, /checkpoint\.flowchart\.taskCriteria/);
  assert.match(resumeRestorer, /const taskCriteria = checkpoint\.flowchart\.taskCriteria;/);
  assert.match(unblockWriter, /\.\.\.\(taskCriteria !== undefined \? \{ taskCriteria \} : \{\}\)/);
  // No `continuation.taskCriteria` counterpart: unlike the contract, this is a
  // record of what the run already dispatched, not an answer a caller may give.
  assert.doesNotMatch(resumeRestorer, /continuation\.taskCriteria/);
});

test("every flowchart-payload writer carries contract", async () => {
  const sourceRoot = fileURLToPath(new URL("../../../src/", import.meta.url));
  const writers: Array<{ readonly location: string; readonly carriesContract: boolean }> = [];

  for (const path of await sourceModules(sourceRoot)) {
    const source = await readFile(path, "utf8");
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "materializeCheckpoint" &&
        node.arguments[2] !== undefined
      ) {
        const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
        const payload = resolvePayloadInitializer(parsed, node, node.arguments[2]);
        writers.push({
          location: `${relative(sourceRoot, path)}:${line}`,
          carriesContract: carriesContractProperty(payload)
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }

  assert.ok(writers.length > 0, "the source census must find flowchart-payload writers");
  for (const writer of writers) {
    assert.equal(
      writer.carriesContract,
      true,
      `${writer.location}: every flowchart-payload writer carries contract`
    );
  }
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

    // **Disclosure: half of this pin is flipped.** Until Loop 4 R12-1 the
    // assertion here was `restarted.acceptanceCriteria` deep-equal `[]`, on the
    // reasoning that the second node has no request of its own on the log, so
    // there is nothing to restore. That was true of the log and is no longer
    // true of the run: the checkpoint now records what each task was dispatched
    // with, written when the caller's specs are accepted rather than when a
    // child starts, so the node the pause caught before dispatch is re-asked
    // for the criteria the caller actually set.
    assert.deepEqual(started.acceptanceCriteria.map((criterion) => criterion.id), [CONTRACT_CRITERION]);
    assert.deepEqual(
      restarted.acceptanceCriteria.map((criterion) => criterion.id),
      [CONTRACT_CRITERION],
      "the resumed node is re-dispatched with the criteria it was originally given"
    );
    // Artifacts are *not* on that seam, and the difference is the point: only
    // the recorded field comes back, so nothing else is quietly invented.
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
 * The durable per-task criteria record, and the distinction it exists to keep:
 * *unknown* is not *known-none*.
 *
 * R11-1 shipped `taskCriteria` on the flowchart checkpoint with no writer, and
 * named the laundering it was declared to stop. `childTasksFromLog` rebuilds a
 * resumed child from the parent log, and a `TASK_REQUEST` only reaches the log
 * when a child actually starts — so a run paused before some child is
 * dispatched leaves that child with no recorded criteria at all, the resume
 * substitutes an empty list, the node runs, and the empty list it logs becomes
 * the authoritative answer for every later resume. One pause silently and
 * permanently downgrades what that node is asked to satisfy.
 *
 * Both halves are asserted here against one run, because the contrast is the
 * evidence: `tsk_second` is a child the caller specified and the pause caught
 * before dispatch, so the record carries its criteria and the resume re-asks
 * for them; `tsk_unspecified` is a flowchart node the caller supplied no spec
 * for and the log never saw, so it is absent from the record and is
 * re-dispatched with the empty list it has always had. Nothing is invented for
 * the node nobody described.
 */
const UNSPECIFIED_TASK = "tsk_unspecified";

async function pausedWithAnUnspecifiedNode(
  stateRoot: string,
  projectRoot: string
): Promise<{ runId: RunId; contract: RequirementContract }> {
  const children = [testerChild("tsk_first"), testerChild("tsk_second")];
  const contract = contractCovering(CONTRACT_CRITERION);
  // Three flowchart nodes, two child specs: the third is a node the caller
  // never described, which is the only shape that can still be unknown once a
  // writer exists.
  const flowchart = compileChildrenToFlowchart([
    { taskId: children[0]!.taskId, role: "tester" as const, objective: children[0]!.objective },
    {
      taskId: children[1]!.taskId,
      role: "tester" as const,
      objective: children[1]!.objective,
      dependsOn: [children[0]!.taskId]
    },
    {
      taskId: parseTaskId(UNSPECIFIED_TASK),
      role: "tester" as const,
      objective: "Verify something nobody specified",
      dependsOn: [children[1]!.taskId]
    }
  ]);

  const pause = new TogglePause();
  const first = new PassingExecutor(() => {
    pause.paused = true;
  });
  const paused = await startFlowchartRun(
    { ...deps(stateRoot), executor: first, pause },
    { projectRoot, flowchart, childTasks: children, contract }
  );
  assert.equal(paused.status, "PAUSED");
  assert.deepEqual(first.taskIds, ["tsk_first"]);
  return { runId: paused.runId, contract };
}

async function storedTaskCriteria(
  stateRoot: string,
  runId: RunId
): Promise<Record<string, readonly string[]> | undefined> {
  const raw = await new CheckpointStore(stateRoot, runId).read();
  const recorded = validateCheckpoint(raw).flowchart?.taskCriteria;
  if (recorded === undefined) return undefined;
  return Object.fromEntries(
    recorded.map((entry) => [entry.taskId, entry.acceptanceCriteria.map((criterion) => criterion.id)])
  );
}

test("a resume re-dispatches recorded criteria and leaves an unrecorded node unknown", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const { runId, contract } = await pausedWithAnUnspecifiedNode(stateRoot, projectRoot);

    // The durable half. `tsk_unspecified` is absent rather than present-and-
    // empty: the record says nothing about a task nobody described.
    assert.deepEqual(await storedTaskCriteria(stateRoot, runId), {
      tsk_first: [CONTRACT_CRITERION],
      tsk_second: [CONTRACT_CRITERION]
    });

    const resumed = await resumeFlowchartRun(
      { ...deps(stateRoot), executor: new PassingExecutor(), pause: new TogglePause() },
      runId,
      { unpause: true, contract }
    );
    assert.equal(resumed.status, "COMPLETED");

    const dispatched = Object.fromEntries(
      loggedTaskRequests(resumed.events).map((request) => [
        request.taskId,
        request.acceptanceCriteria.map((criterion) => criterion.id)
      ])
    );
    assert.deepEqual(dispatched, {
      tsk_first: [CONTRACT_CRITERION],
      tsk_second: [CONTRACT_CRITERION],
      [UNSPECIFIED_TASK]: []
    });

    // And the resume's own writes neither revised nor forgot the record: the
    // node that ran with an empty list under a substituted spec is still
    // absent, so a second resume would still know it is unknown rather than
    // read back the emptiness this run just logged.
    assert.deepEqual(await storedTaskCriteria(stateRoot, runId), {
      tsk_first: [CONTRACT_CRITERION],
      tsk_second: [CONTRACT_CRITERION]
    });
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

    const recorded = await storedTaskCriteria(stateRoot, runId);

    const paused = await cli(["pause", "--run", runId, "--reason", "operator stepped away", "--state-root", stateRoot]);
    assert.equal(paused.code, 0, paused.err);
    assert.deepEqual(
      await storedContract(stateRoot, runId),
      contract,
      "the pause rewrote the checkpoint and kept the contract on it"
    );
    // The same rewrite, the same hazard, for the per-task criteria record: an
    // operator action that has nothing to do with what a child was asked to
    // check must not be able to delete it.
    assert.deepEqual(recorded, { tsk_first: [CONTRACT_CRITERION], tsk_second: [CONTRACT_CRITERION] });
    assert.deepEqual(await storedTaskCriteria(stateRoot, runId), recorded);

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
 * The tracked path's own pause arc, and the last contract-retention leg that
 * had no proof at all.
 *
 * R10-4 stopped here: `startTrackedRun` passed no `pause` dependency into
 * `startFlowchartRun`, and `pauseIfRequested` returns immediately without one,
 * so a tracked run could not be paused — the token was written and never read.
 * The dependency now exists, and the control below is R10-4's finding kept as
 * the falsifiable half: the same objective, the same executor, the same
 * flipped flag, differing only in whether the input carries a controller.
 */
const TRACKED_OBJECTIVE = "Implement the smallest possible change and add tests";

async function trackedRun(
  stateRoot: string,
  projectRoot: string,
  options: { readonly executor: PassingExecutor; readonly pause?: PauseController }
): Promise<{ runId: RunId; status: string }> {
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
  const outcome = await withIsolatedPiEnv(() =>
    startTrackedRun({
      projectRoot,
      objective: TRACKED_OBJECTIVE,
      stateRoot,
      executor: options.executor,
      primaryModelId: "premium",
      fastModelId: "cheap",
      assumeDefaults: true,
      ...(options.pause !== undefined ? { pause: options.pause } : {})
    })
  );
  return { runId: outcome.runId, status: outcome.status };
}

function constraintRetentionByTurn(events: readonly Event[]): Record<string, string> {
  const verdicts: Record<string, string> = {};
  for (const event of events) {
    if (event.type !== "TRACKING_ASSESSMENT") continue;
    const assessment = event.payload.assessment as unknown as {
      turnId: string;
      dimensions: readonly { id: string; verdict: string }[];
    };
    const dimension = assessment.dimensions.find((entry) => entry.id === "constraint-retention");
    if (dimension !== undefined) verdicts[assessment.turnId] = dimension.verdict;
  }
  return verdicts;
}

test("a tracked run observes a pause request only once its input carries a controller", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    // Control. The flag is flipped by the very first child here too; with no
    // controller to poll it, the loop runs the whole plan out to a terminal.
    const unwatched = new PassingExecutor();
    const ignored = await trackedRun(stateRoot, projectRoot, { executor: unwatched });
    assert.equal(ignored.status, "COMPLETED");
    assert.ok(unwatched.taskIds.length > 1, "the tracked plan is more than one child of work");

    const pause = new TogglePause();
    const watched = new PassingExecutor(() => {
      pause.paused = true;
    });
    const stopped = await trackedRun(stateRoot, projectRoot, { executor: watched, pause });
    assert.equal(stopped.status, "PAUSED");
    assert.deepEqual(
      watched.taskIds.length,
      1,
      "the round boundary after the first child is where the tracked loop now stops"
    );
  });
});

/**
 * The arc R10-4 was dispatched to prove, minus the one leg that is not
 * reachable offline (see the report): the contract is the tracked path's own
 * extraction from the objective — no test authored it and no CLI flag accepts
 * one — and everything after the tracked run is the shipped command path.
 */
test("a tracked run's own extracted contract survives a CLI pause and a CLI resume", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const pause = new TogglePause();
    const executor = new PassingExecutor(() => {
      pause.paused = true;
    });
    const { runId, status } = await trackedRun(stateRoot, projectRoot, { executor, pause });
    assert.equal(status, "PAUSED");

    const contract = (await storedContract(stateRoot, runId)) as RequirementContract | undefined;
    assert.ok(contract, "a tracked run checkpoints the contract it extracted");
    assert.deepEqual(
      contract.constraints.map((constraint) => constraint.id),
      ["c-smallest", "c-tests"],
      "these come from the tracked extractor, not from this test"
    );

    const paused = await cli([
      "pause",
      "--run",
      runId,
      "--reason",
      "operator stepped away",
      "--state-root",
      stateRoot
    ]);
    assert.equal(paused.code, 0, paused.err);
    assert.match(paused.out, new RegExp(`Run ${runId}: PAUSED`));
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

    // The resume held nothing but a run id, so every turn it assessed was
    // assessed against the contract it read back off the checkpoint. Turns the
    // paused leg had already run are excluded by name rather than by count.
    const verdicts = constraintRetentionByTurn(await eventsOf(stateRoot, runId));
    const resumedTurns = Object.keys(verdicts).filter((turnId) => !executor.taskIds.includes(turnId));
    assert.ok(resumedTurns.length > 0, "the resume assessed turns of its own");
    for (const turnId of Object.keys(verdicts)) {
      assert.equal(verdicts[turnId], "PASS", `${turnId} is assessed against the run's own constraints`);
    }
    assert.deepEqual(await storedContract(stateRoot, runId), contract);
  });
});

/**
 * The CLI half of the same wiring, and the disclosure R11-3 left standing:
 * both the controller and the early run-id callback have to survive every
 * `main.ts` and `loop.ts` edit, and dropping either silently restores a dead
 * end without failing anything else.
 *
 * The behavioural successor is below. R11-3 could only pin the call site
 * because `runCommand` printed the run id after the awaited outcome, and a
 * tracked run driven by the fake executor is always terminal in one process —
 * so there was no offline moment at which an operator could name the run and
 * still pause it. `onRunStarted` is that moment.
 */
test("runCommand hands the tracked run the file pause controller and an early run id", async () => {
  const [cliSource, loopSource] = await Promise.all([
    readFile(new URL("../../../src/cli/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../src/track/loop.ts", import.meta.url), "utf8")
  ]);
  const trackedCall = cliSource.match(/const outcome = await startTrackedRun\(\{[\s\S]*?^ {4}\}\);$/m)?.[0];
  const trackInput = loopSource.match(/export interface TrackRunInput \{[\s\S]*?^\}$/m)?.[0];
  const forwarder = loopSource.match(/export async function startTrackedRun\b[\s\S]*?^\}$/m)?.[0];

  assert.ok(trackedCall, "the tracked run's CLI call site remains structurally inspectable");
  assert.ok(trackInput, "TrackRunInput remains structurally inspectable");
  assert.ok(forwarder, "startTrackedRun remains structurally inspectable");

  assert.match(trackedCall, /pause: createFilePauseController\(stateRoot\)/);
  assert.match(trackInput, /pause\?: PauseController/);
  assert.match(forwarder, /\.\.\.\(input\.pause !== undefined \? \{ pause: input\.pause \} : \{\}\)/);

  assert.match(trackedCall, /onRunStarted: \(runId\) => \{/);
  assert.match(trackInput, /onRunStarted\?: \(runId: RunId\) => void/);
  assert.match(
    forwarder,
    /\.\.\.\(input\.onRunStarted !== undefined \? \{ onRunStarted: input\.onRunStarted \} : \{\}\)/
  );
});

/**
 * The behavioural pure-CLI tracked pause R11-3 designed and declined to build
 * through a sibling's file.
 *
 * Nothing here races and nothing here is killed. `onRunStarted` fires
 * synchronously inside `startFlowchartRun`, after the run directory and the
 * `RUN_CREATED` row exist and before round 1 reads the pause token, so a
 * `stdout` handler that writes the token has strictly ordered itself ahead of
 * the first poll — the run is not running concurrently with this test, it is
 * suspended inside the callback. Removing `onRunStarted` from either the deps
 * or the CLI call site turns this run COMPLETED.
 *
 * The token is written directly rather than through `createFilePauseController`
 * for two reasons that are both properties of the shipped code:
 * `requestPause` is async and cannot be awaited from a synchronous `stdout`
 * sink, and it takes the run's cooperative lock — which this very run holds for
 * its whole lifetime, so an in-process request would block rather than pause.
 * The bytes still have to satisfy the production reader: `PauseController.token`
 * throws on a malformed `pause.json`, so a format drift fails this loudly.
 */
test("a pure-CLI tracked run is paused from the id its own early disclosure printed", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");

    const out: string[] = [];
    let disclosed: RunId | undefined;
    const io: CliIo = {
      stdout: (text) => {
        out.push(text);
        const started = /^Run (run_[A-Za-z0-9_-]+): started\n$/.exec(text);
        if (started === null || disclosed !== undefined) return;
        disclosed = parseRunId(started[1]!);
        writeFileSync(
          join(runtimeRoot(stateRoot), "runs", disclosed, "pause.json"),
          `${JSON.stringify({ paused: true, requestedAt: "2026-08-12T09:00:00.000Z" }, null, 2)}\n`
        );
      },
      stderr: () => undefined
    };

    const code = await withIsolatedPiEnv(() =>
      main(
        [
          "run",
          "--track",
          "--assume-defaults",
          "--project",
          projectRoot,
          "--objective",
          TRACKED_OBJECTIVE,
          "--state-root",
          stateRoot,
          "--executor",
          "fake"
        ],
        io
      )
    );

    assert.ok(disclosed, "the tracked run disclosed its id before it finished");
    assert.equal(code, 1, `a paused run is not a success: ${out.join("")}`);
    assert.match(out.join(""), new RegExp(`Run ${disclosed}: PAUSED`));

    // The pause landed at the loop's first poll, so no child was ever
    // dispatched — the token was read, not merely written.
    const events = await eventsOf(stateRoot, disclosed);
    assert.deepEqual(
      events.filter((event) => event.type === "CHILD_MESSAGE"),
      [],
      "the run stopped before it leased any child work"
    );
    assert.ok(
      events.some((event) => event.type === "PAUSE_REQUESTED"),
      "the run recorded the pause it observed"
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
