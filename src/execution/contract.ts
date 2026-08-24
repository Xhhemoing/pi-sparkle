import type { AgentInstanceId, RunId, TaskId } from "../domain/ids.js";
import type { AgentMessage } from "../protocol/v1.js";
import type { ClusterSessionView } from "../cluster/host.js";

export interface AgentExecutionRequest {
  runId: RunId;
  taskId: TaskId;
  agentInstanceId: AgentInstanceId;
  prompt: string;
  workingDirectory: string;
  /** Routed model for this attempt. Executors that support multi-model honor it. */
  modelId?: string;
  providerId?: string;
  /** Live cluster session for spawn / send / inbox. Optional. */
  cluster?: ClusterSessionView;
  /**
   * USD ceiling for this execution, from `RunLimits.maxCostUsd`. Executors
   * that can price their own spend stop after the turn that reaches it;
   * executors that cannot ignore it rather than guess at a cost.
   */
  maxCostUsd?: number;
}

export type ExecutionEvent =
  | { type: "TEXT_DELTA"; text: string }
  /**
   * Reasoning progress carried as a size only. Chain-of-thought text never
   * enters the execution stream, so it can never reach the event log.
   */
  | { type: "THINKING_DELTA"; bytes: number }
  | { type: "TOOL_STARTED"; toolCallId: string; toolName: string }
  | { type: "TOOL_FINISHED"; toolCallId: string; isError: boolean; summary: string }
  | { type: "TURN_FINISHED"; usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: "MESSAGE"; message: AgentMessage }
  | { type: "EXECUTION_FINISHED"; outcome: "SUCCESS" | "FAILURE" | "CANCELLED" };

export interface AgentExecutor {
  execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent>;
  /**
   * Inject a user turn into the run that is in flight right now, to be picked
   * up after the current assistant turn. This is live steering, not the
   * flowchart `inject` verb in `src/run/injection.ts`: that one writes typed
   * policy facts (`fact | override | skip`) the supervisor reads, while this
   * one puts user-authored text into the agent's own conversation.
   *
   * Optional because not every executor drives a steerable loop. Callers must
   * treat its absence as "steering unsupported" and fail rather than drop the
   * text — a steer that silently goes nowhere is worse than a rejected one.
   *
   * Implementations reject empty or whitespace-only text, and reject the call
   * when no run is in flight, with `DomainValidationError`.
   */
  steerText?(text: string): void;
}
