import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { createTaskId } from "../../../src/domain/ids.js";
import type { AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { startParentRun } from "../../../src/run/coordinator.js";

test("parent refuses oversized mandatory context before invoking a child executor", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "sparkle-budget-state-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "sparkle-budget-project-"));
  let calls = 0;
  const executor: AgentExecutor = { async *execute(): AsyncIterable<ExecutionEvent> {
    calls += 1;
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  } };
  try {
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const run = startParentRun({ stateRoot, executor }, { projectRoot, objective: "Inspect safely",
      contract: { schemaVersion: 1, objective: "Inspect safely", deliverables: [],
        constraints: [{ id: "privacy", description: "Never expose private data. ".repeat(1000), enforceable: true }],
        nonGoals: [], acceptanceCriteria: [], assumptions: [], questions: [], authority: [], sourceRefs: [] },
      children: [{ taskId: createTaskId(() => "budget-child"), role: "scout", objective: "Inspect safely",
        profile: registry.resolve("scout"), inputArtifactIds: [], acceptanceCriteria: [],
        limits: { maxAttempts: 1, timeoutMs: 1000, maxWallTimeMs: 2000 } }]
    });
    const outcome = await run.done;
    assert.equal(calls, 0, "unsafe context must not reach executor");
    assert.equal(outcome.status, "FAILED");
    assert.ok(outcome.events.some((event) => event.type === "RUN_FAILED"
      && event.payload.reason.includes("CONTEXT_MANDATORY_BUDGET_EXCEEDED")));
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
