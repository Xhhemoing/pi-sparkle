import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createEpisodeId,
  createMessageId,
  createProjectId,
  createRunId,
  parseTaskId,
  type AgentInstanceId,
  type CandidateId
} from "../../../src/domain/ids.js";
import {
  outcomesFromRoutedRun,
  proposeRoutingFromAssignments,
  proposeRoutingFromRoutedEvents
} from "../../../src/learning/from-episode.js";
import { makeEvent } from "../../helpers/event-factory.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import { EventStore } from "../../../src/run/event-store.js";
import type { Event, ModelRoutedPayload } from "../../../src/run/events.js";
import {
  configurePreferencePersistence,
  listObservations,
  preferenceSnapshotPath,
  resetPreferenceStore
} from "../../../src/preferences/store.js";
import { assignTasks } from "../../../src/routing/assign.js";
import { catalogFromPrimary } from "../../../src/routing/primary-catalog.js";
import { loadAdaptationRegistry } from "../../../src/adaptation/promotion.js";
import { observationsForR1, parseOutcomeObservation } from "../../../src/routing/outcomes.js";
import { ASSIGN_FEATURE_VERSION } from "../../../src/routing/feature-version.js";

test("learning from assignments without outcomes does not create a candidate", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-learn-"));
  try {
    const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
    const assignments = assignTasks({
      catalog,
      tasks: [
        { taskId: parseTaskId("tsk_scout"), role: "scout", objective: "Survey the repo" }
      ]
    });
    const first = await proposeRoutingFromAssignments({
      stateRoot,
      projectRoot: "/tmp/learn-proj",
      projectId: createProjectId(),
      assignments,
      outcomes: [],
      primaryModelId: "premium"
    });
    assert.equal(first.created, false);
    assert.match(first.reason, /no bound taskSuccess outcomes/);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("bound model FAIL outcomes propose a routing-policy candidate without promoting it", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-learn-out-"));
  try {
    const projectId = createProjectId();
    const outcome = parseOutcomeObservation({
      taskFamily: "edit",
      role: "implementer",
      modelId: "cheap",
      modelVersion: "cheap-v1",
      featureVersion: ASSIGN_FEATURE_VERSION,
      criterion: "taskSuccess",
      outcome: "FAIL",
      occurredAtMs: 1,
      source: "deterministic-check",
      failureClass: "model"
    });
    const first = await proposeRoutingFromAssignments({
      stateRoot,
      projectRoot: "/tmp/learn-proj",
      projectId,
      outcomes: [outcome],
      primaryModelId: "premium"
    });
    assert.equal(first.created, true);
    assert.ok(first.candidateId);

    const registry = await loadAdaptationRegistry(stateRoot);
    const candidate = registry.getCandidate(first.candidateId as CandidateId);
    assert.equal(candidate?.status, "proposed");
    assert.equal(registry.getActiveVersion(candidate!.identity)?.versionId, first.parentVersionId);

    const second = await proposeRoutingFromAssignments({
      stateRoot,
      projectRoot: "/tmp/learn-proj",
      projectId,
      outcomes: [outcome],
      primaryModelId: "premium"
    });
    assert.equal(second.created, false);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

const TASK_ID = parseTaskId("tsk_edit");
const RUN_ID = createRunId();
const AGENT = "agt_00000000-0000-4000-8000-000000000001" as AgentInstanceId;
const OCCURRED = parseIsoTimestamp("2026-08-19T00:00:00.000Z");

function routedPayload(overrides: Partial<ModelRoutedPayload> = {}): ModelRoutedPayload {
  return {
    taskId: TASK_ID,
    role: "actor",
    complexity: "MEDIUM",
    model: "cheap",
    justification: "cheapest eligible",
    confidence: 0.8,
    approvalPlan: { id: "approval:t", items: [] },
    statusAfterRoute: "RUNNING",
    policyVersion: "router-v1",
    estimatedCostUsd: 0.1,
    estimatedDurationMs: 1000,
    family: "edit",
    featureVersion: ASSIGN_FEATURE_VERSION,
    modelVersion: "cheap-v1",
    highRisk: false,
    eligibleModels: ["cheap", "premium"],
    rejections: [],
    behaviorDistribution: { cheap: 1, premium: 0 },
    agentRole: "implementer",
    ...overrides
  };
}

function resultMessage(input: {
  outcome: "SUCCESS" | "FAILURE";
  summary: string;
  failure?: { category: string; detail?: string };
}) {
  return {
    protocolVersion: 1 as const,
    id: createMessageId(),
    occurredAt: OCCURRED,
    runId: RUN_ID,
    taskId: TASK_ID,
    from: AGENT,
    to: SUPERVISOR,
    type: "TASK_RESULT" as const,
    outcome: input.outcome,
    summary: input.summary,
    artifactIds: [],
    evidenceIds: ["evd_check"],
    verification: {
      kind: input.outcome === "SUCCESS" ? ("PASSED" as const) : ("FAILED" as const),
      evidenceIds: ["evd_check"]
    },
    ...(input.failure !== undefined ? { failure: input.failure } : {})
  };
}

test("planning-omission FAIL is contract and does not enter R1", () => {
  const events = [
    makeEvent("MODEL_ROUTED", routedPayload(), { taskId: TASK_ID, runId: RUN_ID }),
    makeEvent(
      "CHILD_MESSAGE",
      {
        message: resultMessage({
          outcome: "FAILURE",
          summary: "Acceptance criterion ac-1 was never specified in the contract",
          failure: { category: "VALIDATION", detail: "planning omission" }
        })
      },
      { taskId: TASK_ID, runId: RUN_ID }
    )
  ];
  const outcomes = outcomesFromRoutedRun(events);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.failureClass, "contract");
  assert.deepEqual(observationsForR1(outcomes), []);
});

test("cascade retry binds the second result to the next model", () => {
  const childRunId = createRunId();
  const events = [
    makeEvent("MODEL_ROUTED", routedPayload(), { taskId: TASK_ID, runId: RUN_ID }),
    makeEvent(
      "CHILD_MESSAGE",
      {
        message: resultMessage({
          outcome: "FAILURE",
          summary: "golden fixture mismatch",
          failure: { category: "MODEL_ERROR" }
        })
      },
      { taskId: TASK_ID, runId: RUN_ID }
    ),
    makeEvent(
      "TASK_RETRY",
      {
        childRunId,
        attempt: 1,
        reason: "cascade cheap->premium",
        previousModel: "cheap",
        nextModel: "premium",
        nextModelVersion: "premium-v1"
      },
      { taskId: TASK_ID, runId: RUN_ID }
    ),
    makeEvent(
      "CHILD_MESSAGE",
      {
        message: resultMessage({
          outcome: "SUCCESS",
          summary: "fixed"
        })
      },
      { taskId: TASK_ID, runId: RUN_ID }
    )
  ];
  const outcomes = outcomesFromRoutedRun(events);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.modelId, "cheap");
  assert.equal(outcomes[0]?.failureClass, "model");
  assert.equal(outcomes[1]?.modelId, "premium");
  assert.equal(outcomes[1]?.modelVersion, "premium-v1");
  assert.equal(outcomes[1]?.outcome, "PASS");
});

/**
 * The preference store is a process-global singleton, so an unbound store hides
 * a stray write: it lands in memory and dies at exit, which is exactly how the
 * inferred-preference recording escaped notice from `adapt learn`. Both pins
 * below therefore bind the store first, and assert the in-memory history as
 * well as the absence of the snapshot file.
 */
async function withBoundPreferenceStore<T>(
  stateRoot: string,
  body: () => Promise<T>
): Promise<T> {
  resetPreferenceStore();
  configurePreferencePersistence(preferenceSnapshotPath(stateRoot));
  try {
    return await body();
  } finally {
    configurePreferencePersistence(undefined);
    resetPreferenceStore();
  }
}

test("proposing a candidate from outcomes leaves the preference store untouched", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-learn-pref-"));
  try {
    const outcome = parseOutcomeObservation({
      taskFamily: "edit",
      role: "implementer",
      modelId: "cheap",
      modelVersion: "cheap-v1",
      featureVersion: ASSIGN_FEATURE_VERSION,
      criterion: "taskSuccess",
      outcome: "FAIL",
      occurredAtMs: 1,
      source: "deterministic-check",
      failureClass: "model"
    });
    await withBoundPreferenceStore(stateRoot, async () => {
      const result = await proposeRoutingFromAssignments({
        stateRoot,
        projectRoot: "/tmp/learn-pref-proj",
        projectId: createProjectId(),
        outcomes: [outcome],
        primaryModelId: "premium"
      });
      assert.equal(result.created, true, result.reason);
      assert.deepEqual(listObservations(), []);
      assert.equal(existsSync(preferenceSnapshotPath(stateRoot)), false);
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("the routed-events learn path records no inferred preference for an episode-bound run", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-learn-routed-pref-"));
  try {
    const runId = createRunId();
    const taskId = parseTaskId("tsk_pref01");
    const store = new EventStore(stateRoot, runId);
    for (const event of episodeBoundFailureRun(runId, taskId)) {
      await store.append(event);
    }

    await withBoundPreferenceStore(stateRoot, async () => {
      const result = await proposeRoutingFromRoutedEvents({
        stateRoot,
        runId,
        primaryModelId: "premium"
      });
      // A created candidate proves the run reached the point where the
      // inferred-preference recording used to fire.
      assert.equal(result.created, true, result.reason);
      assert.deepEqual(listObservations(), []);
      assert.equal(existsSync(preferenceSnapshotPath(stateRoot)), false);
    });
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

/**
 * A run whose log carries everything the learner keys on: a project snapshot,
 * an episode binding (`RUN_ATTACHED`), and one routed task that failed on the
 * model. Every event validates, so these go through `EventStore.append`.
 */
function episodeBoundFailureRun(
  runId: ReturnType<typeof createRunId>,
  taskId: ReturnType<typeof parseTaskId>
): Event[] {
  const projectId = createProjectId();
  const episodeId = createEpisodeId();
  return [
    makeEvent(
      "PROJECT_DISCOVERED",
      {
        project: {
          id: projectId,
          rootPath: "/tmp/learn-routed-proj",
          discoveredAt: OCCURRED,
          instructionFiles: [],
          manifests: [],
          commands: [],
          facts: []
        }
      },
      { runId }
    ),
    makeEvent("RUN_ATTACHED", { episodeId, runId, attachedAt: OCCURRED }, { runId }),
    makeEvent(
      "MODEL_ROUTED",
      {
        taskId,
        role: "actor",
        complexity: "MEDIUM",
        model: "cheap",
        justification: "cheapest eligible",
        confidence: 0.8,
        approvalPlan: {
          id: "ap_learn",
          items: [{ id: "go", label: "go", selectable: true }]
        },
        statusAfterRoute: "RUNNING",
        policyVersion: "router-v1",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1000,
        family: "edit",
        featureVersion: ASSIGN_FEATURE_VERSION,
        modelVersion: "cheap-v1",
        highRisk: false,
        eligibleModels: ["cheap", "premium"],
        rejections: [],
        behaviorDistribution: { cheap: 1, premium: 0 },
        agentRole: "implementer"
      },
      { taskId, runId }
    ),
    makeEvent(
      "CHILD_MESSAGE",
      {
        message: {
          protocolVersion: 1 as const,
          id: createMessageId(),
          occurredAt: OCCURRED,
          runId,
          taskId,
          from: AGENT,
          to: SUPERVISOR,
          type: "TASK_RESULT" as const,
          outcome: "FAILURE" as const,
          summary: "golden fixture mismatch",
          artifactIds: [],
          evidenceIds: ["evd_check"],
          verification: { kind: "FAILED" as const, evidenceIds: ["evd_check"] },
          failure: { category: "MODEL_ERROR" }
        }
      },
      { taskId, runId }
    )
  ];
}

