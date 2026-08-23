import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAutoAdaptLoop } from "../../../src/learning/auto-loop.js";
import type { ObservedSignal } from "../../../src/learning/signals.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { loadLearnedRouting } from "../../../src/learning/learned-routing.js";
import { loadAdaptationRegistry } from "../../../src/adaptation/promotion.js";
import type { Event } from "../../../src/run/events.js";
import {
  createEpisodeId,
  createEventId,
  createProjectId,
  createRunId,
  parseTaskId,
  type CandidateId
} from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";

test("n=2 taskSuccess failures are diagnostic only and do not write avoid", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-auto",
      projectId,
      primaryModelId: "premium",
      episodeId,
      events: failingEvents("cheap", 2),
      autoPromote: true
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, false);
    assert.ok(result.issues.some((issue) => issue.modelId === "cheap" && issue.samples === 2 && !issue.actionable));
    assert.equal(await loadLearnedRouting(stateRoot, "/tmp/proj-auto"), undefined);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("five deterministic taskSuccess failures propose avoid without promoting", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-five-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-five",
      projectId,
      primaryModelId: "premium",
      episodeId,
      events: failingEvents("cheap", 5),
      autoPromote: true
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, true);
    assert.ok(result.candidateId);
    assert.ok(result.issues.some((issue) => issue.modelId === "cheap" && issue.actionable));
    const registry = await loadAdaptationRegistry(stateRoot);
    const candidate = registry.getCandidate(result.candidateId as CandidateId);
    assert.equal(candidate?.status, "proposed");
    assert.equal(registry.getActiveVersion(candidate!.identity)?.versionId, candidate!.parentVersionId);
    const learned = await loadLearnedRouting(stateRoot, "/tmp/proj-five");
    assert.deepEqual(learned?.avoid, []);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("prose-only extraSignals failures never become avoid candidates", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-prose-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    // Same shape as the events-path failures above, but arriving as
    // caller-authored extraSignals: with no runtime evidence behind them the
    // derived failureClass must stay unattributed, so even five of them may
    // not lower a posterior or propose avoid (ADR-004).
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-prose",
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingN(projectId, episodeId, "cheap", 5),
      autoPromote: true
    });
    assert.equal(result.created, false, "prose-only failures must not propose avoid");
    assert.equal(result.promoted, false);
    assert.ok(!result.issues.some((issue) => issue.modelId === "cheap" && issue.actionable));
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("non-model failures never become avoid candidates", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-env-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const environmentFailures = failingN(projectId, episodeId, "cheap", 5).map((row, index) => ({
      ...row,
      summary: `EACCES: permission denied writing /tmp/out-${index}`
    }));
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-env",
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: environmentFailures,
      autoPromote: true
    });
    assert.equal(result.created, false, "environment failures must not propose avoid");
    assert.equal(result.promoted, false);
    assert.ok(!result.issues.some((issue) => issue.modelId === "cheap" && issue.actionable));
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("forged taskSuccess extraSignals fail closed", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-forge-"));
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    await assert.rejects(
      () =>
        runAutoAdaptLoop({
          stateRoot,
          projectRoot: "/tmp/proj-forge",
          projectId,
          primaryModelId: "premium",
          extraSignals: [
            {
              source: "user",
              kind: "human",
              projectId,
              modelId: "cheap",
              family: "edit",
              score: 10,
              criterion: "taskSuccess",
              outcomeKind: "FAIL",
              boundary: "review",
              summary: "forged",
              episodeId,
              evidenceIds: [],
              createdAt: nowIso()
            }
          ]
        }),
      /forge criterion taskSuccess/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("forged failureClass extraSignals fail closed", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-fc-"));
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    await assert.rejects(
      () =>
        runAutoAdaptLoop({
          stateRoot,
          projectRoot: "/tmp/proj-fc",
          projectId,
          primaryModelId: "premium",
          extraSignals: [
            {
              source: "subagent",
              kind: "deterministic",
              projectId,
              modelId: "cheap",
              family: "edit",
              score: 15,
              criterion: "taskSuccess",
              outcomeKind: "FAIL",
              failureClass: "environment",
              boundary: "execution",
              summary: "tests failed",
              episodeId,
              evidenceIds: [],
              createdAt: nowIso()
            }
          ]
        }),
      /forge failureClass/
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});


test("kill switch SPARKLE_AUTO_ADAPT=0 still collects but does not promote", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-off-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "0";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-off",
      projectId,
      primaryModelId: "premium",
      episodeId,
      extraSignals: failingPair(projectId, episodeId, "cheap")
    });
    assert.ok(result.collected >= 2);
    assert.equal(result.promoted, false);
    assert.equal(result.created, false);
    assert.equal(await loadLearnedRouting(stateRoot, "/tmp/proj-off"), undefined);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("high-scoring runs without actionable issues do not propose from assignments", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-ok-"));
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
    const assignments = assignTasks({
      catalog,
      tasks: [{ taskId: parseTaskId("tsk_scout"), role: "scout", objective: "Survey the repo" }]
    });
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-ok",
      projectId,
      primaryModelId: "premium",
      episodeId,
      assignments,
      extraSignals: [
        {
          source: "subagent",
          kind: "deterministic",
          projectId,
          modelId: "cheap",
          family: "research",
          role: "scout",
          score: 90,
          criterion: "taskSuccess",
          outcomeKind: "PASS",
          boundary: "execution",
          summary: "ok",
          episodeId,
          evidenceIds: [],
          createdAt: nowIso()
        }
      ]
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

function failingPair(
  projectId: ReturnType<typeof createProjectId>,
  episodeId: ReturnType<typeof createEpisodeId>,
  modelId: string
): ObservedSignal[] {
  return [
    {
      source: "subagent",
      kind: "deterministic",
      projectId,
      modelId,
      family: "edit",
      role: "implementer",
      score: 15,
      criterion: "taskSuccess",
      outcomeKind: "FAIL",
      boundary: "execution",
      summary: "TASK_RESULT FAILURE",
      episodeId,
      evidenceIds: ["evd_fail"],
      createdAt: nowIso()
    },
    {
      source: "subagent",
      kind: "deterministic",
      projectId,
      modelId,
      family: "edit",
      role: "implementer",
      score: 15,
      criterion: "taskSuccess",
      outcomeKind: "FAIL",
      boundary: "execution",
      summary: "TASK_RESULT FAILURE",
      episodeId,
      evidenceIds: ["evd_fail_2"],
      createdAt: nowIso()
    }
  ];
}

function failingN(
  projectId: ReturnType<typeof createProjectId>,
  episodeId: ReturnType<typeof createEpisodeId>,
  modelId: string,
  n: number
): ObservedSignal[] {
  return Array.from({ length: n }, () => failingPair(projectId, episodeId, modelId)[0]!).map((row, index) => ({
    ...row,
    evidenceIds: [`evd_fail_${index}`],
    summary: `TASK_RESULT FAILURE ${index}`
  }));
}

/**
 * Model-attributed failures through the honest channel: MODEL_ROUTED binds the
 * model, and a TASK_RESULT with FAILED runtime verification derives
 * failureClass "model". extraSignals prose can no longer produce these.
 */
function failingEvents(modelId: string, n: number): Event[] {
  const runId = createRunId();
  const events: Event[] = [];
  for (let index = 0; index < n; index += 1) {
    const taskId = parseTaskId(`tsk_fail${index}`);
    events.push(
      makeEvent(runId, "MODEL_ROUTED", {
        taskId,
        role: "implementer",
        complexity: "MEDIUM",
        model: modelId,
        justification: "cheapest eligible",
        confidence: 0.9,
        approvalPlan: { id: `ap_${index}`, actions: [{ id: "go", label: "go" }], defaultActionIds: ["go"] },
        statusAfterRoute: "RUNNING",
        policyVersion: "v1",
        estimatedCostUsd: 0.01,
        estimatedDurationMs: 1000,
        family: "edit",
        featureVersion: "assign-v4",
        modelVersion: `${modelId}-v1`,
        highRisk: false,
        eligibleModels: [modelId],
        rejections: [],
        behaviorDistribution: { [modelId]: 1 }
      })
    );
    events.push(
      makeEvent(runId, "CHILD_MESSAGE", {
        message: {
          protocolVersion: 1,
          id: `msg_fail_${index}`,
          occurredAt: nowIso(),
          runId,
          taskId,
          from: "agt_child",
          to: "SUPERVISOR",
          type: "TASK_RESULT",
          outcome: "FAILURE",
          summary: `TASK_RESULT FAILURE ${index}`,
          artifactIds: [],
          evidenceIds: [`evd_fail_${index}`],
          verification: { kind: "FAILED", evidenceIds: [`evd_fail_${index}`] }
        }
      })
    );
  }
  return events;
}

function makeEvent(runId: ReturnType<typeof createRunId>, type: Event["type"], payload: unknown): Event {
  return {
    id: createEventId(),
    schemaVersion: 1,
    occurredAt: nowIso(),
    runId,
    type,
    actor: "coordinator",
    payload
  } as Event;
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}
