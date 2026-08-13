import type { TaskId } from "../domain/ids.js";
import type { ProjectContextIndex } from "./index.js";

export interface ContextPacket {
  readonly taskId: TaskId;
  readonly contractDigest: string;
  readonly requiredFacts: string[];
  readonly relevantFiles: string[];
  readonly tokenBudget: number;
  readonly omittedSummary: { reason: string; count: number }[];
}

export function compilePacket(
  taskId: TaskId,
  index: ProjectContextIndex,
  budget = 4000
): ContextPacket {
  const facts = Object.keys(index.manifests).slice(0, 10);
  const omitted = index.risks.length > 3 ? [{ reason: "risks-truncated", count: index.risks.length - 3 }] : [];
  return {
    taskId,
    contractDigest: "v1",
    requiredFacts: facts,
    relevantFiles: [],
    tokenBudget: budget,
    omittedSummary: omitted
  };
}
