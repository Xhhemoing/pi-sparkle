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
import { createFileRunControlPlane } from "../../../src/run/control-plane.js";
import {
  injectFlowchartRun,
  pauseFlowchartRun,
  startFlowchartRun
} from "../../../src/run/flowchart-run.js";
import { EventStore } from "../../../src/run/event-store.js";
import { createModelRouter, type ModelRouter } from "../../../src/supervisor/model-router.js";
import type { ChildNodeResult } from "../../../src/supervisor/flowchart-supervisor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

const routerConfig = {
  policyVersion: "router-v1",
  models: [
    {
      id: "cheap",
      version: "cheap-v1",
      roles: ["actor", "critic"] as const,
      maxComplexity: "MEDIUM" as const,
      estimatedCostUsd: 0.1,
      estimatedDurationMs: 1_000
    },
    {
      id: "premium",
      version: "premium-v1",
      roles: ["actor", "critic", "judge", "router"] as const,
      maxComplexity: "HIGH" as const,
      estimatedCostUsd: 0.5,
      estimatedDurationMs: 4_000
    }
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
    id: "control-linear",
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

async function withTempState(run: (stateRoot: string, projectRoot: string) => Promise<void>): Promise<void> {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cp-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cp-proj-"));
  try {
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

const childResults = { first: fakeResult("first"), second: fakeResult("second") };
const NOW = parseIsoTimestamp("2026-08-15T06:00:00.000Z");

test("control plane submit assigns requestId and ack round-trips", async () => {
  await withTempState(async (stateRoot) => {
    const runId = "run_01234567-89ab-cdef-0123-456789abcdef" as RunId;
    const plane = createFileRunControlPlane(stateRoot, runId, () => NOW, () => "req-1");
    const submitted = await plane.submit({ kind: "pause", reason: "hold" });
    assert.equal(submitted.requestId, "req-1");
    assert.equal(submitted.kind, "pause");
    const pending = await plane.listPending();
    assert.equal(pending.length, 1);
    await plane.acknowledge({
      requestId: "req-1",
      status: "applied",
      kind: "pause",
      appliedStatus: "PAUSED"
    });
    assert.equal((await plane.listPending()).length, 0);
    const ack = await plane.waitForAck("req-1", { timeoutMs: 100 });
    assert.equal(ack.status, "applied");
  });
});

test("pauseFlowchartRun after terminal rejects without writing PAUSE_REQUESTED", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const deps = {
      stateRoot,
      router: router(),
      now: () => NOW,
      generateId: sequenceGenerator()
    };
    const completed = await startFlowchartRun(deps, {
      projectRoot,
      flowchart: linearFlowchart(),
      childResults
    });
    assert.equal(completed.status, "COMPLETED");
    const before = await new EventStore(stateRoot, completed.runId).readAll();
    const pauseCountBefore = before.events.filter((e) => e.type === "PAUSE_REQUESTED").length;

    await assert.rejects(
      () => pauseFlowchartRun(deps, completed.runId, "too late"),
      /cannot pause a COMPLETED run/
    );

    const after = await new EventStore(stateRoot, completed.runId).readAll();
    const pauseCountAfter = after.events.filter((e) => e.type === "PAUSE_REQUESTED").length;
    assert.equal(pauseCountAfter, pauseCountBefore, "sole writer must not append PAUSE_REQUESTED after terminal");
  });
});

test("interleaved read-then-terminal: pending pause is rejected, no PAUSE_REQUESTED", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    const generateId = sequenceGenerator();
    const deps = { stateRoot, router: router(), now: () => NOW, generateId };
    const completed = await startFlowchartRun(deps, {
      projectRoot,
      flowchart: linearFlowchart(),
      childResults
    });
    assert.equal(completed.status, "COMPLETED");

    const plane = createFileRunControlPlane(stateRoot, completed.runId, () => NOW, generateId);
    // Mimic: operator read non-terminal status, then enqueued pause; another
    // writer finished the run before the sole writer drained the queue.
    const submitted = await plane.submit({ kind: "pause", reason: "stale read" });

    // Idle sole writer (pauseFlowchartRun) drains the pending stale pause and
    // must reject it — never append PAUSE_REQUESTED after terminal.
    await assert.rejects(
      () => pauseFlowchartRun(deps, completed.runId, "follow-up"),
      /cannot pause a COMPLETED run/
    );

    const events = (await new EventStore(stateRoot, completed.runId).readAll()).events;
    assert.equal(
      events.filter((e) => e.type === "PAUSE_REQUESTED").length,
      0,
      "stale pause control must not leave PAUSE_REQUESTED after terminal"
    );
    const staleAck = await plane.readAck(submitted.requestId);
    assert.ok(staleAck, "stale pause must be acknowledged by the sole writer");
    assert.equal(staleAck.status, "rejected");
  });
});

test("inject still lands on a PAUSED run through the control queue", async () => {
  await withTempState(async (stateRoot, projectRoot) => {
    let calls = 0;
    let paused = false;
    const pause = {
      async requestPause() {
        paused = true;
        return { paused: true as const, requestedAt: NOW };
      },
      async clearPause() {
        paused = false;
      },
      async token() {
        calls += 1;
        if (calls >= 2) paused = true;
        return paused ? { paused: true as const, requestedAt: NOW } : { paused: false as const };
      }
    };
    const deps = {
      stateRoot,
      router: router(),
      pause,
      now: () => NOW,
      generateId: sequenceGenerator()
    };
    const started = await startFlowchartRun(deps, {
      projectRoot,
      flowchart: linearFlowchart(),
      childResults
    });
    assert.equal(started.status, "PAUSED");
    const injected = await injectFlowchartRun(deps, started.runId, {
      kind: "fact",
      key: "k",
      value: "v",
      actor: "user",
      confidence: 1
    });
    assert.equal(injected.snapshot.facts.k, "v");
    assert.ok(injected.events.some((e) => e.type === "INJECTION_REQUESTED"));
  });
});
