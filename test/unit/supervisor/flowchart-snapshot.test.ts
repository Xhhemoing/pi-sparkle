import assert from "node:assert/strict";
import { test } from "node:test";

import type { RequirementContract } from "../../../src/domain/contract.js";
import { createTaskId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import { validateConfidenceScore, type Flowchart, type FlowNode } from "../../../src/domain/flowchart.js";
import {
  materializeCheckpoint,
  replayRun,
  validateCheckpoint,
  validateFlowchartCheckpointState
} from "../../../src/run/replay.js";
import { makeEvent } from "../../helpers/event-factory.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import {
  createFlowchartSupervisor,
  restoreFlowchartSupervisor
} from "../../../src/supervisor/flowchart-supervisor.js";
import { validateFlowchartSupervisorSnapshot } from "../../../src/supervisor/flowchart-snapshot.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";

function node(id: string): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: "actor",
    objective: `Do ${id}`,
    modelPolicy: { allowedModels: ["cheap"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

function flowchart(): Flowchart {
  return { id: "snap", nodes: [node("a")], edges: [] };
}

function router() {
  return createModelRouter({
    policyVersion: "router-v1",
    models: [
      {
        id: "cheap",
        version: "cheap-v1",
        roles: ["actor", "critic"],
        maxComplexity: "MEDIUM",
        estimatedCostUsd: 0.1,
        estimatedDurationMs: 1_000
      }
    ]
  });
}

function liveSnapshot() {
  const fc = flowchart();
  const sv = createFlowchartSupervisor({ flowchart: fc, router: router() });
  sv.leaseReadyNodes();
  return { fc, snapshot: sv.snapshot() };
}

test("validateFlowchartSupervisorSnapshot accepts a live supervisor snapshot", () => {
  const { snapshot } = liveSnapshot();
  assert.deepEqual(validateFlowchartSupervisorSnapshot(snapshot), snapshot);
  assert.equal(snapshot.nodes["a"]?.state, "RUNNING");
  assert.equal(typeof snapshot.ledger.facts, "object");
});

test("validateFlowchartSupervisorSnapshot fails closed on malformed fields", () => {
  const { snapshot } = liveSnapshot();
  assert.throws(() => validateFlowchartSupervisorSnapshot(null), /expected an object/);
  assert.throws(
    () => validateFlowchartSupervisorSnapshot({ ...snapshot, nodes: {} }),
    /nodes must not be empty/
  );
  assert.throws(
    () =>
      validateFlowchartSupervisorSnapshot({
        ...snapshot,
        nodes: { a: { ...snapshot.nodes["a"], state: "BOGUS" } }
      }),
    /FlowNodeState/
  );
  assert.throws(
    () =>
      validateFlowchartSupervisorSnapshot({
        ...snapshot,
        nodes: { a: { ...snapshot.nodes["a"], confidence: 1.5 } }
      }),
    /confidence/
  );
  assert.throws(
    () =>
      validateFlowchartSupervisorSnapshot({
        ...snapshot,
        ledger: { ...snapshot.ledger, facts: [{ key: "x", value: "y", confidence: 4 }] }
      }),
    /confidence/
  );
  assert.throws(
    () => validateFlowchartSupervisorSnapshot({ ...snapshot, facts: { coverage: { nested: true } } }),
    /facts\.coverage/
  );
});

test("restoreFlowchartSupervisor rejects pendingApproval unless that node is WAITING_FOR_USER", () => {
  const fc: Flowchart = {
    id: "pending-state",
    nodes: [
      {
        id: "gate",
        taskId: createTaskId(() => "gate"),
        role: "router",
        objective: "Choose",
        modelPolicy: { allowedModels: ["premium"] },
        confidenceThreshold: validateConfidenceScore(0.7),
        approvalRequired: true
      },
      {
        id: "next",
        taskId: createTaskId(() => "next"),
        role: "actor",
        objective: "Do next",
        modelPolicy: { allowedModels: ["cheap"] },
        confidenceThreshold: validateConfidenceScore(0.7),
        approvalRequired: false
      }
    ],
    edges: [{ from: "gate", to: "next", condition: { type: "success", expected: true } }]
  };
  const waitingRouter = createModelRouter({
    policyVersion: "router-v1",
    models: [
      { id: "cheap", version: "cheap-v1", roles: ["actor"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
      { id: "premium", version: "premium-v1", roles: ["router"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
    ]
  });
  const sv = createFlowchartSupervisor({ flowchart: fc, router: waitingRouter });
  sv.leaseReadyNodes();
  const snapshot = sv.snapshot();
  assert.ok(snapshot.pendingApproval);
  assert.equal(snapshot.nodes["gate"]?.state, "WAITING_FOR_USER");

  assert.throws(
    () =>
      restoreFlowchartSupervisor(
        { flowchart: fc, router: waitingRouter },
        {
          ...snapshot,
          nodes: { ...snapshot.nodes, gate: { ...snapshot.nodes["gate"]!, state: "COMPLETED" } }
        }
      ),
    /WAITING_FOR_USER/
  );
});

test("restoreFlowchartSupervisor rejects a snapshot that does not match the flowchart", () => {
  const { fc, snapshot } = liveSnapshot();
  assert.throws(
    () =>
      restoreFlowchartSupervisor(
        { flowchart: fc, router: router() },
        { ...snapshot, flowchartId: "other" }
      ),
    /does not match/
  );
  assert.throws(
    () =>
      restoreFlowchartSupervisor(
        { flowchart: fc, router: router() },
        { ...snapshot, nodes: { ...snapshot.nodes, ghost: snapshot.nodes["a"]! } }
      ),
    /unknown node/
  );
});

function baseCheckpoint() {
  return materializeCheckpoint(
    replayRun([
      makeEvent("RUN_CREATED", {
        run: {
          id: "run_01234567-89ab-cdef-0123-456789abcdef",
          projectId: "prj_01234567-89ab-cdef-0123-456789abcdef",
          rootTaskId: createTaskId(UUID),
          status: "PLANNING",
          limits: {
            maxTasks: 16,
            maxConcurrentTasks: 2,
            maxAttemptsPerTask: 3,
            maxRounds: 32,
            maxConsecutiveStalls: 3,
            maxWallTimeMs: 3_600_000
          },
          createdAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z"),
          updatedAt: parseIsoTimestamp("2026-08-12T09:00:00.000Z")
        }
      })
    ]),
    parseIsoTimestamp("2026-08-12T10:00:00.000Z")
  );
}

const LIMITS = {
  maxConcurrentNodes: 4,
  maxConsecutiveStalls: 3,
  remainingTimeMs: Number.MAX_SAFE_INTEGER
};

function contract(): RequirementContract {
  return {
    schemaVersion: 1,
    objective: "Ship the migration",
    deliverables: [],
    constraints: [{ id: "con-no-legacy", description: "do not touch src/legacy", enforceable: true }],
    nonGoals: [],
    acceptanceCriteria: [
      { id: "crit-suite", description: "the suite passes", observableCheck: "pnpm test" }
    ],
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: []
  };
}

test("validateCheckpoint fails closed on a malformed flowchart snapshot rather than JSON.parse-only", () => {
  const { fc, snapshot } = liveSnapshot();
  const base = baseCheckpoint();
  const limits = LIMITS;
  const valid = { ...base, flowchart: { definition: fc, snapshot, limits } };
  assert.equal(validateCheckpoint(valid).flowchart?.snapshot.flowchartId, "snap");

  assert.throws(() => validateCheckpoint({ ...base, flowchart: "nope" }), /flowchart must be an object/);
  assert.throws(
    () =>
      validateCheckpoint({
        ...base,
        flowchart: {
          definition: fc,
          snapshot: { ...snapshot, nodes: { a: { ...snapshot.nodes["a"], confidence: 2 } } },
          limits
        }
      }),
    /flowchart\.snapshot|confidence/
  );
  assert.throws(
    () =>
      validateCheckpoint({
        ...base,
        flowchart: { definition: fc, snapshot: { ...snapshot, flowchartId: "other" }, limits }
      }),
    /not restorable|does not match/
  );
});

/**
 * The durable run contract. It is what lets a resume holding nothing but a run
 * id assess its children against the constraints the start ran under, so the
 * three cases that matter are: a stored contract survives the round trip
 * intact, a damaged one fails closed under its own field name, and a
 * checkpoint written before the field existed still loads.
 */
test("a stored run contract round-trips through the flowchart checkpoint validator", () => {
  const { fc, snapshot } = liveSnapshot();
  const stored = contract();
  const validated = validateCheckpoint({
    ...baseCheckpoint(),
    flowchart: { definition: fc, snapshot, limits: LIMITS, contract: stored }
  });
  assert.deepEqual(validated.flowchart?.contract, stored);
  assert.deepEqual(
    validated.flowchart?.contract?.constraints.map((entry) => entry.id),
    ["con-no-legacy"],
    "the constraints the tracking gate reads survive the checkpoint, not just the criteria"
  );
});

test("a malformed stored contract fails closed under the flowchart.contract field name", () => {
  const { fc, snapshot } = liveSnapshot();
  const base = baseCheckpoint();
  for (const [broken, pattern] of [
    [{ ...contract(), objective: "" }, /flowchart\.contract: Contract\.objective must be non-empty/],
    [{ ...contract(), constraints: "all of them" }, /flowchart\.contract: constraints must be array/],
    [{ ...contract(), schemaVersion: 2 }, /flowchart\.contract: Contract\.schemaVersion must be 1/],
    ["a contract, honest", /flowchart\.contract: Contract must be an object/]
  ] as const) {
    assert.throws(
      () =>
        validateCheckpoint({
          ...base,
          flowchart: { definition: fc, snapshot, limits: LIMITS, contract: broken }
        }),
      pattern
    );
  }
});

test("a flowchart checkpoint written before the contract field existed still validates", () => {
  const { fc, snapshot } = liveSnapshot();
  const old = { ...baseCheckpoint(), flowchart: { definition: fc, snapshot, limits: LIMITS } };
  const validated = validateCheckpoint(old);
  assert.equal(validated.schemaVersion, 1, "absence is valid at the same schema version");
  assert.equal(validated.flowchart?.contract, undefined);
  assert.equal(
    "contract" in (validateFlowchartCheckpointState(old.flowchart) as object),
    false,
    "absence stays absence: the validator invents no empty contract"
  );
});

test("validateFlowchartSupervisorSnapshot rejects a waiter without pendingApproval", () => {
  const { snapshot } = liveSnapshot();
  assert.throws(
    () =>
      validateFlowchartSupervisorSnapshot({
        ...snapshot,
        nodes: { a: { ...snapshot.nodes["a"]!, state: "WAITING_FOR_USER" } }
      }),
    /requires pendingApproval/
  );
});

test("validateFlowchartSupervisorSnapshot rejects pendingApproval without a waiter", () => {
  const fc: Flowchart = {
    id: "pending-state",
    nodes: [
      {
        id: "gate",
        taskId: createTaskId(() => "gate"),
        role: "router",
        objective: "Choose",
        modelPolicy: { allowedModels: ["premium"] },
        confidenceThreshold: validateConfidenceScore(0.7),
        approvalRequired: true
      },
      {
        id: "next",
        taskId: createTaskId(() => "next"),
        role: "actor",
        objective: "Do next",
        modelPolicy: { allowedModels: ["cheap"] },
        confidenceThreshold: validateConfidenceScore(0.7),
        approvalRequired: false
      }
    ],
    edges: [{ from: "gate", to: "next", condition: { type: "success", expected: true } }]
  };
  const waitingRouter = createModelRouter({
    policyVersion: "router-v1",
    models: [
      { id: "cheap", version: "cheap-v1", roles: ["actor"], maxComplexity: "MEDIUM", estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
      { id: "premium", version: "premium-v1", roles: ["router"], maxComplexity: "HIGH", estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
    ]
  });
  const sv = createFlowchartSupervisor({ flowchart: fc, router: waitingRouter });
  sv.leaseReadyNodes();
  const snapshot = sv.snapshot();
  assert.ok(snapshot.pendingApproval);

  const { pendingApproval: _pending, ...withoutPending } = snapshot;
  assert.throws(
    () =>
      restoreFlowchartSupervisor({ flowchart: fc, router: waitingRouter }, {
        ...withoutPending,
        nodes: snapshot.nodes
      }),
    /requires pendingApproval/
  );
  assert.throws(
    () =>
      restoreFlowchartSupervisor(
        { flowchart: fc, router: waitingRouter },
        {
          ...snapshot,
          nodes: {
            ...snapshot.nodes,
            gate: { ...snapshot.nodes["gate"]!, state: "COMPLETED" },
            next: { ...snapshot.nodes["next"]!, state: "WAITING_FOR_USER" }
          }
        }
      ),
    /WAITING_FOR_USER/
  );
  assert.throws(
    () =>
      validateFlowchartSupervisorSnapshot({
        ...snapshot,
        nodes: {
          ...snapshot.nodes,
          next: { ...snapshot.nodes["next"]!, state: "WAITING_FOR_USER" }
        }
      }),
    /at most one WAITING_FOR_USER/
  );
});
