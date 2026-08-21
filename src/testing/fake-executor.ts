import type { ArtifactId, EvidenceId, MessageId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import type { AgentExecutionRequest, AgentExecutor, ExecutionEvent } from "../execution/contract.js";
import { SUPERVISOR } from "../protocol/v1.js";

export class FakeExecutor implements AgentExecutor {
  constructor(private readonly steps: readonly ExecutionEvent[]) {}

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    for (const step of this.steps) yield step;
  }
}

export class GatedExecutor implements AgentExecutor {
  sawAbort = false;
  readonly started: Promise<void>;
  private resolveStarted!: () => void;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  async *execute(_request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent> {
    this.resolveStarted();
    yield { type: "TEXT_DELTA", text: "working" };
    if (signal.aborted) {
      this.sawAbort = true;
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          this.sawAbort = true;
          resolve();
        },
        { once: true }
      );
    });
    yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
  }
}

/** Deterministic child that emits a protocol v1 TASK_RESULT, used by `--children`. */
export class ProtocolChildExecutor implements AgentExecutor {
  async *execute(
    request: AgentExecutionRequest,
    signal: AbortSignal
  ): AsyncIterable<ExecutionEvent> {
    if (signal.aborted) {
      yield { type: "EXECUTION_FINISHED", outcome: "CANCELLED" };
      return;
    }
    yield {
      type: "MESSAGE",
      message: {
        protocolVersion: 1,
        id: `msg_fake-${request.agentInstanceId}` as MessageId,
        occurredAt: nowIso(),
        runId: request.runId,
        taskId: request.taskId,
        from: request.agentInstanceId,
        to: SUPERVISOR,
        type: "TASK_RESULT",
        outcome: "SUCCESS",
        summary: "fake child completed the task",
        artifactIds: [`art_fake-${request.taskId}` as ArtifactId],
        evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId],
        verification: { kind: "PASSED", evidenceIds: [`evd_fake-${request.taskId}` as EvidenceId] }
      }
    };
    yield { type: "EXECUTION_FINISHED", outcome: "SUCCESS" };
  }
}
