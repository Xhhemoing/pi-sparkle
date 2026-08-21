import {
  createAgentInstanceId,
  type AgentInstanceId,
  type IdGenerator,
  type RunId,
  type TaskId
} from "../domain/ids.js";
import { validateConfidenceScore, type ConfidenceScore, type FlowNode } from "../domain/flowchart.js";
import type { AgentExecutor } from "../execution/contract.js";
import type { TaskResult } from "../protocol/v1.js";
import type { ChildNodeResult } from "../supervisor/flowchart-supervisor.js";
import type { ChildRunOutcome } from "./child-coordinator.js";

/** Confidence for a child TASK_RESULT whose verification actually PASSED. */
export const PASSED_NODE_CONFIDENCE: ConfidenceScore = validateConfidenceScore(0.9);

export function formatFlowchartNodePrompt(node: FlowNode, modelId?: string): string {
  const lines = [`flowchart node ${node.id} (${node.role})`, `Objective: ${node.objective}`];
  if (modelId !== undefined && modelId.trim() !== "") {
    lines.push(`Assigned model: ${modelId}`);
  }
  return lines.join("\n");
}

export function childNodeResultFromExecution(input: {
  readonly terminal?: TaskResult;
  readonly executorOutcome?: "SUCCESS" | "FAILURE" | "CANCELLED";
}): ChildNodeResult {
  const terminal = input.terminal;
  if (terminal !== undefined) {
    const evidenceIds = terminal.evidenceIds;
    if (terminal.outcome === "FAILURE" || terminal.outcome === "CANCELLED") {
      return { outcome: "FAILURE", evidenceIds };
    }
    if (terminal.verification.kind === "FAILED") {
      return { outcome: "FAILURE", evidenceIds };
    }
    const outcome = terminal.outcome === "PARTIAL" ? "PARTIAL" : "SUCCESS";
    if (terminal.verification.kind === "PASSED") {
      return { outcome, confidence: PASSED_NODE_CONFIDENCE, evidenceIds };
    }
    return { outcome, evidenceIds };
  }
  if (input.executorOutcome === "SUCCESS") {
    return { outcome: "SUCCESS" };
  }
  return { outcome: "FAILURE" };
}

export interface ExecuteFlowchartNodeInput {
  readonly executor: AgentExecutor;
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly prompt: string;
  readonly workingDirectory: string;
  readonly modelId?: string;
  readonly agentInstanceId?: AgentInstanceId;
  readonly generateId?: IdGenerator;
  readonly signal?: AbortSignal;
}

export async function executeFlowchartNode(input: ExecuteFlowchartNodeInput): Promise<ChildNodeResult> {
  const agentInstanceId = input.agentInstanceId ?? createAgentInstanceId(input.generateId);
  const signal = input.signal ?? new AbortController().signal;
  let terminal: TaskResult | undefined;
  let executorOutcome: "SUCCESS" | "FAILURE" | "CANCELLED" | undefined;
  for await (const event of input.executor.execute(
    {
      runId: input.runId,
      taskId: input.taskId,
      agentInstanceId,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {})
    },
    signal
  )) {
    if (event.type === "MESSAGE" && event.message.type === "TASK_RESULT") {
      terminal = event.message;
    }
    if (event.type === "EXECUTION_FINISHED") {
      executorOutcome = event.outcome;
    }
  }
  return childNodeResultFromExecution({
    ...(terminal !== undefined ? { terminal } : {}),
    ...(executorOutcome !== undefined ? { executorOutcome } : {})
  });
}

export function childNodeResultFromChildOutcome(outcome: ChildRunOutcome): ChildNodeResult {
  if (outcome.terminalResult !== undefined) {
    const executorOutcome =
      outcome.outcome === "CANCELLED"
        ? "CANCELLED"
        : outcome.outcome === "FAILURE" || outcome.outcome === "TIMEOUT"
          ? "FAILURE"
          : "SUCCESS";
    return childNodeResultFromExecution({
      terminal: outcome.terminalResult,
      executorOutcome
    });
  }
  if (outcome.outcome === "SUCCESS" || outcome.outcome === "PARTIAL") {
    return {
      outcome: outcome.outcome === "PARTIAL" ? "PARTIAL" : "SUCCESS",
      evidenceIds: [...outcome.evidenceIds],
      confidence: PASSED_NODE_CONFIDENCE
    };
  }
  return { outcome: "FAILURE", evidenceIds: [...outcome.evidenceIds] };
}
