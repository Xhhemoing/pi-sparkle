import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { compileChildrenToFlowchart } from "../../../src/graph/compile-children.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import { isAgentRole } from "../../../src/domain/roles.js";
import { startFlowchartRun } from "../../../src/run/flowchart-run.js";
import { inspectRun } from "../../../src/run/inspection.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { createModelRouter } from "../../../src/supervisor/model-router.js";
import { ProtocolChildExecutor } from "../../../src/testing/fake-executor.js";

function sequenceGenerator(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`;
}

function child(id: string, role: string): ChildTaskInput {
  if (!isAgentRole(role)) throw new Error(`bad role ${role}`);
  const registry = createAgentProfileRegistry(defaultAgentProfiles());
  return {
    taskId: parseTaskId(`tsk_${id}`),
    role,
    objective: `Do ${id}`,
    profile: registry.resolve(role),
    inputArtifactIds: [],
    acceptanceCriteria: [],
    limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 300_000 }
  };
}

async function withRoots(run: (stateRoot: string, projectRoot: string) => Promise<void>) {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-children-flow-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-children-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    await run(stateRoot, projectRoot);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("compiled children execute through the flowchart supervisor and persist child protocol events", async () => {
  await withRoots(async (stateRoot, projectRoot) => {
    const children = [child("parse", "implementer"), child("test", "tester")];
    const flowchart = compileChildrenToFlowchart(
      children.map((entry) => ({
        taskId: entry.taskId,
        role: isAgentRole(entry.role) ? entry.role : "worker",
        objective: entry.objective
      }))
    );
    const outcome = await startFlowchartRun(
      {
        stateRoot,
        router: createModelRouter({
          policyVersion: "router-v1",
          models: [
            {
              id: "cheap",
              version: "cheap-v1",
              roles: ["actor", "critic"],
              maxComplexity: "MEDIUM",
              estimatedCostUsd: 0.1,
              estimatedDurationMs: 1_000
            },
            {
              id: "premium",
              version: "premium-v1",
              roles: ["actor", "critic", "judge", "router"],
              maxComplexity: "HIGH",
              estimatedCostUsd: 0.5,
              estimatedDurationMs: 4_000
            }
          ]
        }),
        executor: new ProtocolChildExecutor(),
        registry: createAgentProfileRegistry(defaultAgentProfiles()),
        generateId: sequenceGenerator()
      },
      {
        projectRoot,
        flowchart,
        objective: "Ship the parser",
        childTasks: children
      }
    );

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["tsk_parse"]?.state, "COMPLETED");
    assert.equal(outcome.snapshot.nodes["tsk_test"]?.state, "COMPLETED");
    assert.ok(outcome.events.some((event) => event.type === "MODEL_ROUTED"));
    assert.ok(outcome.events.some((event) => event.type === "CHILD_RUN_CREATED"));

    const inspection = await inspectRun(stateRoot, outcome.runId);
    assert.equal(inspection.children.length, 2);
    assert.deepEqual(
      inspection.children.map((entry) => entry.outcome).sort(),
      ["SUCCESS", "SUCCESS"]
    );
    for (const childRun of inspection.children) {
      assert.ok(childRun.messages.some((message) => message.type === "TASK_REQUEST"));
      assert.ok(childRun.messages.some((message) => message.type === "TASK_RESULT"));
    }
  });
});
