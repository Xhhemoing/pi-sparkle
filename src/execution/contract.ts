import type { AgentInstanceId, RunId, TaskId } from "../domain/ids.js";
import type { AgentMessage } from "../protocol/v1.js";

export interface AgentExecutionRequest {
  runId: RunId;
  taskId: TaskId;
  agentInstanceId: AgentInstanceId;
  prompt: string;
  workingDirectory: string;
}

export type ExecutionEvent =
  | { type: "TEXT_DELTA"; text: string }
  | { type: "TOOL_STARTED"; toolCallId: string; toolName: string }
  | { type: "TOOL_FINISHED"; toolCallId: string; isError: boolean; summary: string }
  | { type: "TURN_FINISHED"; usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: "MESSAGE"; message: AgentMessage }
  | { type: "EXECUTION_FINISHED"; outcome: "SUCCESS" | "FAILURE" | "CANCELLED" };

export interface AgentExecutor {
  execute(request: AgentExecutionRequest, signal: AbortSignal): AsyncIterable<ExecutionEvent>;
}
