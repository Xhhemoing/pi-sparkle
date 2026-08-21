import { compileContextPacket, type ContextPacket } from "../context/packet.js";
import type { ProjectContextIndex } from "../context/index.js";
import type { RequirementContract } from "../domain/contract.js";
import type { ArtifactId, TaskId } from "../domain/ids.js";
import type { ChildTaskInput } from "./child-coordinator.js";

const DEFAULT_PACKET_BUDGET = 2000;

const EMPTY_CONTRACT: RequirementContract = {
  schemaVersion: 1,
  objective: "",
  deliverables: [],
  constraints: [],
  nonGoals: [],
  acceptanceCriteria: [],
  assumptions: [],
  questions: [],
  authority: [],
  sourceRefs: []
};

export interface ChildPredecessor {
  readonly taskId: TaskId;
  readonly summary: string;
  readonly artifactIds: readonly ArtifactId[];
}

export interface GroundChildTaskInput {
  readonly child: ChildTaskInput;
  readonly predecessors: readonly ChildPredecessor[];
  readonly index: ProjectContextIndex;
  readonly contract?: RequirementContract | undefined;
  readonly tokenBudget?: number | undefined;
}

/**
 * Attaches a bounded context packet and predecessor artifacts so a child does
 * not start from a one-line objective.
 */
export function groundChildTask(input: GroundChildTaskInput): ChildTaskInput {
  const predecessorNotes = input.predecessors.map(
    (predecessor) => `${predecessor.taskId}: ${predecessor.summary}`
  );
  const inputArtifactIds = uniqueArtifacts([
    ...input.child.inputArtifactIds,
    ...input.predecessors.flatMap((predecessor) => predecessor.artifactIds)
  ]);
  const contextPacket: ContextPacket = compileContextPacket({
    taskId: input.child.taskId,
    contract: input.contract ?? EMPTY_CONTRACT,
    index: input.index,
    tokenBudget: input.tokenBudget ?? DEFAULT_PACKET_BUDGET,
    selectorVersion: 1,
    dependencyOutputs: input.predecessors.map((predecessor) => predecessor.summary)
  });
  return {
    ...input.child,
    inputArtifactIds,
    contextPacket,
    predecessorNotes
  };
}

function uniqueArtifacts(ids: readonly ArtifactId[]): ArtifactId[] {
  const seen = new Set<ArtifactId>();
  const unique: ArtifactId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}
