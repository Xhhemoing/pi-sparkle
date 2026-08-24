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
}
