import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import type { Flowchart, FlowNode } from "../../../src/domain/flowchart.js";
import {
  createAgentInstanceId,
  createArtifactId,
  createEventId,
  createMessageId,
  createProjectId,
  createRunId,
  createTaskId
} from "../../../src/domain/ids.js";
import { defaultRunLimits, type RunLimits } from "../../../src/domain/limits.js";
import type { AgentRole } from "../../../src/domain/roles.js";
import type { AcceptanceCriterion } from "../../../src/domain/task.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { SUPERVISOR, type ChildRunLimits, type TaskRequest } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { Event, EventBase } from "../../../src/run/events.js";
import {
  advanceTaskCostCeilings,
  advanceTaskCriteria,
  childTasksFromLog,
  loggedTaskRequests,
  plannedTaskCostCeilings,
  plannedTaskCriteria,
  withRecordedCostCeilings,
  withRecordedCriteria
} from "../../../src/run/flowchart-child-recovery.js";

const registry = createAgentProfileRegistry(defaultAgentProfiles());
const runId = createRunId(() => "recovery");
const occurredAt = parseIsoTimestamp("2026-10-14T18:00:00.000Z");
const limits: ChildRunLimits = { maxAttempts: 1, timeoutMs: 30_000, maxWallTimeMs: 90_000 };
const taskId = (name: string) => createTaskId(() => name);
const criteria = (id: string): AcceptanceCriterion[] => [{ id, description: `Satisfy ${id}` }];

function child(name: string, acceptanceCriteria = criteria(name), maxCostUsd?: number): ChildTaskInput {
  return {
    taskId: taskId(name),
    role: "tester",
    objective: `Test ${name}`,
    profile: registry.resolve("tester"),
    inputArtifactIds: [],
    acceptanceCriteria,
    limits: { ...limits, ...(maxCostUsd !== undefined ? { maxCostUsd } : {}) }
  };
}

function request(spec: ChildTaskInput): TaskRequest {
  return {
    protocolVersion: 1,
    id: createMessageId(),
    occurredAt,
    runId,
    taskId: spec.taskId,
    from: createAgentInstanceId(() => "supervisor"),
    to: SUPERVISOR,
    type: "TASK_REQUEST",
    objective: spec.objective,
    inputArtifactIds: spec.inputArtifactIds,
    acceptanceCriteria: spec.acceptanceCriteria,
    limits: spec.limits
  };
}

function envelope(): Omit<EventBase, "type"> {
  return { id: createEventId(), schemaVersion: 1, occurredAt, runId, actor: "supervisor" };
}

function requested(spec: ChildTaskInput): Event {
  return { ...envelope(), type: "CHILD_MESSAGE", payload: { message: request(spec) } };
}

function routed(name: string, model: string, agentRole?: AgentRole): Event {
  return {
    ...envelope(),
    type: "MODEL_ROUTED",
    payload: {
      taskId: taskId(name),
      role: "actor",
      complexity: "LOW",
      model,
      justification: "recovery fixture",
      confidence: 1,
      approvalPlan: { id: "approval", items: [{ id: "continue", label: "Continue", selectable: true }] },
      statusAfterRoute: "RUNNING",
      policyVersion: "flowchart-v5",
      estimatedCostUsd: 0.1,
      estimatedDurationMs: 100,
      family: "test",
      featureVersion: "fixture-v1",
      modelVersion: "recorded-version",
      highRisk: false,
      eligibleModels: ["premium", "cheap", "unversioned", "missing"],
      rejections: [],
      behaviorDistribution: { [model]: 1 },
      ...(agentRole !== undefined ? { agentRole } : {})
    }
  };
}

function created(runLimits: RunLimits): Event {
  return {
    ...envelope(),
    type: "RUN_CREATED",
    payload: {
      run: {
        id: runId,
        projectId: createProjectId(() => "recovery"),
        rootTaskId: taskId("root"),
        status: "PLANNING",
        limits: runLimits,
        createdAt: occurredAt,
        updatedAt: occurredAt
      }
    }
  };
}

function node(name: string, role: FlowNode["role"] = "actor"): FlowNode {
  return {
    id: name,
    taskId: taskId(name),
    role,
    agentRole: "tester",
    objective: `Define ${name}`,
    modelPolicy: { allowedModels: ["cheap"] },
    confidenceThreshold: 0.7,
    approvalRequired: false
  };
}

test("caller declarations keep sorted last-spec criteria, including known empty, and detach arrays", () => {
  const final = child("z", []);
  const first = child("a");
  const planned = plannedTaskCriteria([child("z"), first, final]);
  assert.deepEqual(planned, [
    { taskId: taskId("a"), acceptanceCriteria: criteria("a") },
    { taskId: taskId("z"), acceptanceCriteria: [] }
  ]);
  first.acceptanceCriteria.push(...criteria("later mutation"));
  assert.deepEqual(planned?.[0]?.acceptanceCriteria, criteria("a"));
  assert.equal(plannedTaskCriteria([]), undefined);
});

test("checkpoint advancement preserves known empty and rejects laundering unknown empty criteria", () => {
  const recorded = [{ taskId: taskId("z"), acceptanceCriteria: [] }];
  const requests = loggedTaskRequests([requested(child("z")), requested(child("a")), requested(child("unknown", []))]);
  assert.deepEqual(advanceTaskCriteria(recorded, requests), [
    { taskId: taskId("a"), acceptanceCriteria: criteria("a") },
    { taskId: taskId("z"), acceptanceCriteria: [] }
  ]);
  assert.deepEqual(recorded, [{ taskId: taskId("z"), acceptanceCriteria: [] }]);
  assert.equal(advanceTaskCriteria(undefined, loggedTaskRequests([requested(child("unknown", []))])), undefined);
});

test("caller cost declarations keep final absence and refuse invalid in-process ceilings", () => {
  assert.equal(plannedTaskCostCeilings([child("a", [], 2), child("a", [])]), undefined);
  assert.deepEqual(plannedTaskCostCeilings([child("z", [], 4), child("a", [], 2)]), [
    { taskId: taskId("a"), maxCostUsd: 2 },
    { taskId: taskId("z"), maxCostUsd: 4 }
  ]);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(plannedTaskCostCeilings([child("a", [], invalid)]), undefined);
  }
});

test("checkpoint cost advancement never raises recorded authorization or invents missing caps", () => {
  const recorded = [{ taskId: taskId("z"), maxCostUsd: 1 }];
  const requests = loggedTaskRequests([
    requested(child("z", [], 9)),
    requested(child("a", [], 2)),
    requested(child("uncapped", []))
  ]);
  assert.deepEqual(advanceTaskCostCeilings(recorded, requests), [
    { taskId: taskId("a"), maxCostUsd: 2 },
    { taskId: taskId("z"), maxCostUsd: 1 }
  ]);
  assert.equal(advanceTaskCostCeilings(undefined, loggedTaskRequests([requested(child("uncapped", []))])), undefined);
  assert.deepEqual(recorded, [{ taskId: taskId("z"), maxCostUsd: 1 }]);
});

test("logged empty criteria and uncapped request outrank conflicting checkpoint declarations", () => {
  const tasks = [child("logged", []), child("planned", []), child("unknown", [])];
  const events = [requested(tasks[0]!)];
  const restoredCriteria = withRecordedCriteria(tasks, events, [
    { taskId: taskId("logged"), acceptanceCriteria: criteria("must not replace logged empty") },
    { taskId: taskId("planned"), acceptanceCriteria: criteria("planned") }
  ]);
  const restored = withRecordedCostCeilings(restoredCriteria, events, [
    { taskId: taskId("logged"), maxCostUsd: 9 },
    { taskId: taskId("planned"), maxCostUsd: 2 }
  ]);
  assert.equal(restored[0], tasks[0], "the task with a request stays authoritative in both wrappers");
  assert.deepEqual(restored[1]?.acceptanceCriteria, criteria("planned"));
  assert.deepEqual(restored[1]?.limits, { ...limits, maxCostUsd: 2 });
  assert.equal(restored[2], tasks[2], "unknown remains empty and uncapped");
  assert.deepEqual(tasks[1]?.limits, limits, "restoration does not modify substituted input limits");
  assert.deepEqual(tasks[1]?.acceptanceCriteria, []);
});

test("reconstruction uses latest request and latest role-bearing assignment with current cascade catalog", () => {
  const old = child("a", criteria("old"), 1);
  const current = {
    ...child("a", criteria("current"), 3),
    objective: "Current logged objective",
    inputArtifactIds: [createArtifactId(() => "current")],
    limits: { maxAttempts: 2, timeoutMs: 45_000, maxWallTimeMs: 150_000, maxCostUsd: 3 }
  };
  const events = [requested(old), routed("a", "premium", "reviewer"), requested(current), routed("a", "cheap", "tester"), routed("a", "premium")];
  const definition: Flowchart = { id: "recovery", nodes: [node("a")], edges: [] };
  const [rebuilt] = childTasksFromLog(events, definition, registry, [
    { id: "premium", version: "new-premium", estimatedCostUsd: 3 },
    { id: "cheap", version: "new-cheap", estimatedCostUsd: 1 },
    { id: "unversioned", estimatedCostUsd: 0 }
  ]);
  assert.ok(rebuilt);
  assert.equal(rebuilt.role, "tester");
  assert.equal(rebuilt.profile, registry.resolve("tester"));
  assert.equal(rebuilt.objective, current.objective);
  assert.deepEqual(rebuilt.inputArtifactIds, current.inputArtifactIds);
  assert.deepEqual(rebuilt.acceptanceCriteria, criteria("current"));
  assert.deepEqual(rebuilt.limits, current.limits);
  assert.equal(rebuilt.assignedModel, "cheap", "a later supervisor route cannot replace assignment");
  assert.deepEqual(rebuilt.cascade, {
    highRisk: false,
    tiers: [{ modelId: "cheap", version: "new-cheap" }, { modelId: "premium", version: "new-premium" }]
  });
  rebuilt.inputArtifactIds.push(createArtifactId(() => "later"));
  rebuilt.acceptanceCriteria.push(...criteria("later"));
  assert.equal(current.inputArtifactIds.length, 1);
  assert.equal(current.acceptanceCriteria.length, 1);
});

test("undispatched children inherit sibling enforcement fields without sibling cost or compiled role", () => {
  const definition: Flowchart = {
    id: "recovery",
    nodes: [node("a"), node("b", "critic"), node("human", "human")],
    edges: [
      { from: "a", to: "b", condition: { type: "success", expected: true } },
      { from: "a", to: "b", condition: { type: "success", expected: false } }
    ]
  };
  const events = [requested(child("a", criteria("a"), 7))];
  const rebuilt = childTasksFromLog(events, definition, registry, []);
  assert.deepEqual(rebuilt.map((task) => [task.taskId, task.role]), [[taskId("a"), "implementer"], [taskId("b"), "reviewer"]]);
  assert.deepEqual(rebuilt[1]?.dependsOn, [taskId("a")]);
  assert.deepEqual(rebuilt[1]?.limits, limits);
  assert.deepEqual(rebuilt[1]?.acceptanceCriteria, []);
  assert.deepEqual(rebuilt[1]?.inputArtifactIds, []);
  assert.equal(Object.hasOwn(rebuilt[1]!, "assignedModel"), false);
  assert.equal(Object.hasOwn(rebuilt[1]!.limits, "maxCostUsd"), false);
});

test("substitution without sibling requests uses run enforcement limits, preserving absent task cap", () => {
  const definition: Flowchart = { id: "recovery", nodes: [node("a")], edges: [] };
  const runLimits = { ...defaultRunLimits(), maxAttemptsPerTask: 3, maxWallTimeMs: 80_000, maxCostUsd: 4 };
  const [rebuilt] = childTasksFromLog([created(runLimits)], definition, registry, []);
  assert.deepEqual(rebuilt?.limits, { maxAttempts: 3, timeoutMs: 60_000, maxWallTimeMs: 80_000 });
  const defaults = defaultRunLimits();
  const [legacy] = childTasksFromLog([], definition, registry, []);
  assert.deepEqual(legacy?.limits, { maxAttempts: defaults.maxAttemptsPerTask, timeoutMs: 60_000, maxWallTimeMs: defaults.maxWallTimeMs });
});
