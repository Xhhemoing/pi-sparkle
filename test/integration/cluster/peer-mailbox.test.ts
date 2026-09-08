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
import type { ChildTaskInput } from "../../../src/run/child-coordinator.js";
import { SUPERVISOR } from "../../../src/protocol/v1.js";
import type { ArtifactId, EvidenceId, MessageId } from "../../../src/domain/ids.js";

class PeerExecutor implements AgentExecutor {
  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (request.prompt.includes("Role: scout")) {
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: `msg_peer-${request.agentInstanceId}` as MessageId,
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "PEER_MESSAGE",
          body: "found src/parser.ts",
          addressRole: "implementer"
        }
      };
    }
    const inbox = request.cluster?.inbox() ?? [];
    const summary =
      inbox.length > 0 ? `received peer mail: ${inbox[0]?.body}` : "fake child completed the task";
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_done-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary,
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

/** Attempt 1 receives peer mail and dies; the retry must inherit that mail. */
class FlakyImplementerExecutor implements AgentExecutor {
  private failedOnce = false;

  async *execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    if (request.prompt.includes("Role: scout")) {
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: `msg_peer-${request.agentInstanceId}` as MessageId,
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "PEER_MESSAGE",
          body: "found src/parser.ts",
          addressRole: "implementer"
        }
      };
      yield {
        type: "MESSAGE",
        message: {
          protocolVersion: 1,
          id: `msg_sdone-${request.agentInstanceId}` as MessageId,
          occurredAt: nowIso(),
          runId: request.runId,
          taskId: request.taskId,
          from: request.agentInstanceId,
          to: SUPERVISOR,
          type: "TASK_RESULT",
          outcome: "SUCCESS",
          summary: "scout done",
          artifactIds: [],
          evidenceIds: [`evd_s-${request.taskId}` as EvidenceId],
          verification: { kind: "PASSED", evidenceIds: [`evd_s-${request.taskId}` as EvidenceId] }
        }
      };
      yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
      return;
    }
    if (!this.failedOnce) {
      this.failedOnce = true;
      yield { type: "EXECUTION_FINISHED", outcome: "FAILURE" };
      return;
    }
    const inbox = request.cluster?.inbox() ?? [];
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_retry-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary:
          inbox.length > 0 ? `retry inherited peer mail: ${inbox[0]?.body}` : "retry saw no mail",
        artifactIds: [],
        evidenceIds: [`evd_r-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_r-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}

test("a retry attempt inherits peer mail the failed attempt never drained", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-handoff-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-handoff-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const scout: ChildTaskInput = {
      taskId: parseTaskId("tsk_scout"),
      role: "scout",
      objective: "Survey the parser",
      profile: registry.resolve("scout"),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
    };
    const impl: ChildTaskInput = {
      taskId: parseTaskId("tsk_impl"),
      role: "implementer",
      objective: "Implement the parser",
      profile: registry.resolve("implementer"),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 2, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 },
      dependsOn: [scout.taskId]
    };
    const outcome = await startParentRun(
      { stateRoot, executor: new FlakyImplementerExecutor(), registry, cluster: true },
      { projectRoot, objective: "Ship the parser", children: [scout, impl] }
    ).done;
    assert.equal(outcome.status, "COMPLETED");
    const implResult = outcome.events
      .filter((event) => event.type === "CHILD_MESSAGE")
      .map((event) => event.payload.message)
      .find((message) => message.type === "TASK_RESULT" && message.taskId === impl.taskId);
    assert.equal(implResult?.type, "TASK_RESULT");
    if (implResult?.type === "TASK_RESULT") {
      assert.match(implResult.summary, /retry inherited peer mail: found src\/parser\.ts/);
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("a scout role-casts to the implementer inbox before the implementer runs", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cluster-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-cluster-proj-"));
  try {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");
    const registry = createAgentProfileRegistry(defaultAgentProfiles());
    const scout: ChildTaskInput = {
      taskId: parseTaskId("tsk_scout"),
      role: "scout",
      objective: "Survey the parser",
      profile: registry.resolve("scout"),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }
    };
    const impl: ChildTaskInput = {
      taskId: parseTaskId("tsk_impl"),
      role: "implementer",
      objective: "Implement the parser",
      profile: registry.resolve("implementer"),
      inputArtifactIds: [],
      acceptanceCriteria: [],
      limits: { maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 },
      dependsOn: [scout.taskId]
    };
    const outcome = await startParentRun(
      { stateRoot, executor: new PeerExecutor(), registry, cluster: true },
      { projectRoot, objective: "Ship the parser", children: [scout, impl] }
    ).done;
    assert.equal(outcome.status, "COMPLETED");
    const implResult = outcome.events
      .filter((event) => event.type === "CHILD_MESSAGE")
      .map((event) => event.payload.message)
      .find((message) => message.type === "TASK_RESULT" && message.taskId === impl.taskId);
    assert.equal(implResult?.type, "TASK_RESULT");
    if (implResult?.type === "TASK_RESULT") {
      assert.match(implResult.summary, /found src\/parser\.ts/);
    }
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
