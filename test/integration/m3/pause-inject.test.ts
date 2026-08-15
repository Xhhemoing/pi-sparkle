import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createTaskId, type RunId } from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";
import {
  validateConfidenceScore,
  type Flowchart,
  type FlowEdge,
  type FlowNode
} from "../../../src/domain/flowchart.js";
import {
  injectFlowchartRun,
  pauseFlowchartRun,
  resumeFlowchartRun,
  startFlowchartRun
} from "../../../src/run/flowchart-run.js";
import type { PauseController, PauseToken } from "../../../src/run/pause-controller.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    { id: "cheap", roles: ["actor", "critic"] as const, maxComplexity: "MEDIUM" as const, estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 },
    { id: "premium", roles: ["actor", "critic", "judge", "router"] as const, maxComplexity: "HIGH" as const, estimatedCostUsd: 0.5, estimatedDurationMs: 4_000 }
  ]
};

function node(id: string): FlowNode {
  return {
    id,
    taskId: createTaskId(() => id),
    role: "actor",
    objective: `Do ${id}`,
    modelPolicy: { allowedModels: ["cheap", "premium"] },
    confidenceThreshold: validateConfidenceScore(0.7),
    approvalRequired: false
  };
}

const successEdge = (from: string, to: string): FlowEdge => ({
  from,
  to,
  condition: { type: "success", expected: true }
});

function linearFlowchart(): Flowchart {
  return {
    id: "pause-linear",
    nodes: [node("first"), node("second")],
    edges: [successEdge("first", "second")]
  };
}

function fakeResult(id: string): ChildNodeResult {
  return {
    outcome: "SUCCESS",
    confidence: validateConfidenceScore(0.9),
    evidenceIds: [`evd_${id}`]
  };
}

function router(): ModelRouter {
  return createModelRouter(routerConfig);
}

function pauseAfterTokenCalls(n: number): PauseController {
  let calls = 0;
  let paused = false;
  let autoArm = true;
  const requestedAt = parseIsoTimestamp("2026-08-15T06:00:00.000Z");
  const snapshot = (): PauseToken => (paused ? { paused: true, requestedAt } : { paused: false });
  return {
    async requestPause() {
      paused = true;
      return snapshot();
    },
    async clearPause() {
      paused = false;
      autoArm = false;
    },
    async token() {
      calls += 1;
      if (autoArm && calls >= n) paused = true;
      return snapshot();
    }
  };
}

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m3-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-m3-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const childResults = { first: fakeResult("first"), second: fakeResult("second") };

test("a test PauseController pauses after the first lease so later nodes stay incomplete", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        pause: pauseAfterTokenCalls(2),
        now: () => parseIsoTimestamp("2026-08-15T06:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      { projectRoot, flowchart: linearFlowchart(), childResults }
    );
    assert.equal(outcome.status, "PAUSED");
    assert.notEqual(outcome.snapshot.nodes["second"]?.state, "COMPLETED");
    assert.ok(outcome.events.some((event) => event.type === "PAUSE_REQUESTED"));
    assert.equal(
      outcome.events.filter((event) => event.type === "MODEL_ROUTED").length,
      1,
      "only the first node is leased before pause"
    );
  });
});

test("inject fact is recorded in the ledger and snapshot facts", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const pause = pauseAfterTokenCalls(2);
    const started = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        pause,
        now: () => parseIsoTimestamp("2026-08-15T06:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      { projectRoot, flowchart: linearFlowchart(), childResults }
    );
    const injected = await injectFlowchartRun(
      { stateRoot, router: router(), pause, now: () => parseIsoTimestamp("2026-08-15T06:00:00.000Z") },
      started.runId,
      { kind: "fact", key: "k", value: "v", actor: "user", confidence: 1 }
    );
    assert.equal(injected.snapshot.facts.k, "v");
    assert.ok(injected.events.some((event) => event.type === "INJECTION_REQUESTED"));
    assert.ok(injected.snapshot.ledger.facts.some((fact) => fact.key === "k" && fact.value === "v"));
  });
});

test("resumeFlowchartRun without clearing pause remains paused", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const pause = pauseAfterTokenCalls(2);
    const deps = {
      stateRoot,
      router: router(),
      pause,
      now: () => parseIsoTimestamp("2026-08-15T06:00:00.000Z"),
      generateId: sequenceGenerator()
    };
    const started = await startFlowchartRun(deps, { projectRoot, flowchart: linearFlowchart(), childResults });
    assert.equal(started.status, "PAUSED");
    const resumed = await resumeFlowchartRun(deps, started.runId, { childResults });
    assert.equal(resumed.status, "PAUSED");
    assert.notEqual(resumed.snapshot.nodes["second"]?.state, "COMPLETED");
  });
});

test("after clearPause and PAUSE_CLEARED the run continues without rerunning the first node", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const pause = pauseAfterTokenCalls(2);
    const now = () => parseIsoTimestamp("2026-08-15T06:00:00.000Z");
    const deps = { stateRoot, router: router(), pause, now, generateId: sequenceGenerator() };
    const started = await startFlowchartRun(deps, { projectRoot, flowchart: linearFlowchart(), childResults });
    assert.equal(started.status, "PAUSED");
    const routedBefore = started.events.filter((event) => event.type === "MODEL_ROUTED").length;

    const resumed = await resumeFlowchartRun(
      { stateRoot, router: router(), pause, now },
      started.runId as RunId,
      { childResults, unpause: true }
    );
    assert.equal(resumed.status, "COMPLETED");
    assert.equal(resumed.snapshot.nodes["first"]?.state, "COMPLETED");
    assert.equal(resumed.snapshot.nodes["second"]?.state, "COMPLETED");
    const firstRouted = resumed.events.filter((event) => {
      if (event.type !== "MODEL_ROUTED") return false;
      return (event.payload as { taskId: string }).taskId === "tsk_first";
    }).length;
    assert.equal(firstRouted, 1, "the first leased node must not be rerun");
    assert.ok(resumed.events.filter((event) => event.type === "MODEL_ROUTED").length >= routedBefore);
  });
});

test("pauseFlowchartRun rejects a BLOCKED run", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const blocked = await startFlowchartRun(
      {
        stateRoot,
        router: router(),
        now: () => parseIsoTimestamp("2026-08-15T06:00:00.000Z"),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        flowchart: { id: "stall-pause", nodes: [node("hung")], edges: [] },
        limits: { maxConsecutiveStalls: 2, maxRounds: 8 },
        childResults: {}
      }
    );
    assert.equal(blocked.status, "BLOCKED");
    await assert.rejects(
      () => pauseFlowchartRun({ stateRoot, router: router() }, blocked.runId),
      /cannot pause a BLOCKED run/
    );
  });
});
