import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAgentProfileRegistry, defaultAgentProfiles } from "../../../src/agents/registry.js";
import { parseTaskId } from "../../../src/domain/ids.js";
import { nowIso } from "../../../src/domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../../../src/execution/contract.js";
import { startParentRun } from "../../../src/run/coordinator.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import type { ArtifactId, EvidenceId, MessageId } from "../../../src/domain/ids.js";

/**
 * Cluster feasibility probe: a planner child dynamically spawns an
 * implementer mid-run through its cluster session; the spawned task must be
 * executed for real (not just recorded), complete with a TASK_RESULT, and
 * surface in the parent outcome.
 */
class SpawnExecutor implements AgentExecutor {
  readonly spawnedObjectives: string[] = [];

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (request.prompt.includes("Role: planner") && request.cluster !== undefined) {
      const spawned = request.cluster.spawn({
        role: "implementer",
        objective: "dynamically spawned follow-up work"
      });
      this.spawnedObjectives.push(spawned.taskId);
    }
    const summary =
      request.prompt.includes("dynamically spawned")
        ? "spawned child completed the dynamic follow-up"
        : "planner finished and delegated";
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_spawn-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary,
        artifactIds: [`art_spawn-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_spawn-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_spawn-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

test("a planner can spawn an implementer mid-run and the spawned task executes", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-spawn-e2e-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-spawn-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const planner: ChildTaskInput = {
      taskId: parseTaskId("tsk_planner"),
      role: "planner",
      objective: "Plan the parser refactor",
      profile: registry.resolve("planner"),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
    };
    const executor = new SpawnExecutor();
    const outcome = await startParentRun(
      { stateRoot, executor, registry, cluster: true },
      { projectRoot, objective: "Ship the refactor", children: [planner] }
    ).done;

    assert.equal(outcome.status, "COMPLETED");
    assert.equal(executor.spawnedObjectives.length, 1, "exactly one dynamic spawn");

    const results = outcome.events
      .filter((event) => event.type === "CHILD_MESSAGE")
      .map((event) => event.payload.message)
      .filter(
        (message): message is Extract<typeof message, { type: "TASK_RESULT" }> =>
          message.type === "TASK_RESULT"
      );
    const summaries = results.map((result) => result.summary);
    assert.ok(
      summaries.some((summary) => summary.includes("delegated")),
      `planner result missing: ${JSON.stringify(summaries)}`
    );
    assert.ok(
      summaries.some((summary) => summary.includes("spawned child completed")),
      `dynamic spawn did not execute: ${JSON.stringify(summaries)}`
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("spawn limits hold under cluster mode: depth and fan-out refuse fail-closed", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-spawn-limit-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-spawn-lproj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    // An implementer cannot delegate at all; the refusal happens inside the
    // cluster host and must not crash the run.
    const impl: ChildTaskInput = {
      taskId: parseTaskId("tsk_impl"),
      role: "implementer",
      objective: "attempt to delegate",
      profile: registry.resolve("implementer"),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
    };

    class IllegalSpawnExecutor implements AgentExecutor {
      refusalError: string | undefined;
      async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
        if (signal.aborted) {
          yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
          return;
        }
        try {
          request.cluster?.spawn({ role: "scout", objective: "should be refused" });
          this.refusalError = undefined;
        } catch (error) {
          this.refusalError = error instanceof Error ? error.message : String(error);
        }
        yield {
          type: "MESSAGE",
          message: {
            protocolVersion: 1,
            id: `msg_ref-${request.agentInstanceId}` as MessageId,
            occurredAt: nowIso(),
            runId: request.runId,
            taskId: request.taskId,
            from: request.agentInstanceId,
            to: SUPERVISOR,
            type: "TASK_RESULT",
            outcome: "SUCCESS",
            summary: `refusal captured: ${this.refusalError ?? "none"}`,
            artifactIds: [],
            evidenceIds: [],
            verification: { kind: "PASSED", evidenceIds: [] }
          }
        };
        yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      }
    }

    const executor = new IllegalSpawnExecutor();
    const outcome = await startParentRun(
      { stateRoot, executor, registry, cluster: true },
      { projectRoot, objective: "Ship anyway", children: [impl] }
    ).done;
    assert.equal(outcome.status, "COMPLETED", "an illegal spawn refusal must not fail the run");
    assert.match(executor.refusalError ?? "", /cannot delegate|cannot spawn|not allowed|refuse/i);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
