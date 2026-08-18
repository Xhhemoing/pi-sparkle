import type { ImprovementCandidate } from "../adaptation/candidate.js";
import type { ResourceRegistry } from "../adaptation/registry.js";
import type { ResourceIdentity } from "../adaptation/resource.js";
import { DomainValidationError } from "../domain/errors.js";
import type { AnomalyPacket } from "./types.js";

export const ANALYSIS_EVALUATION_PLAN = {
  stages: ["static", "replay"],
  metrics: ["utility", "safety"],
  planVersion: 1
} as const;

export type AnalysisPacketInput = AnomalyPacket & {
  readonly actorDefense?: string;
  readonly actorIdentity?: string;
};

/**
 * Drop actor identity/defense before analysis scoring or candidate text.
 * Tool bodies may be present on the ephemeral packet; they are not
 * copied into durable candidate fields. Hidden CoT is never accepted.
 */
export function sanitizePacketForAnalysis(packet: AnalysisPacketInput): AnomalyPacket {
  return {
    summary: packet.summary,
    window: {
      contextFacts: packet.window.contextFacts,
      toolSituations: packet.window.toolSituations,
      ...(packet.window.userText !== undefined
        ? {
            userText: packet.window.userText,
            userTextTrust: packet.window.userTextTrust ?? "UNTRUSTED_TEXT"
          }
        : {}),
      ...(packet.window.aiText !== undefined ? { aiText: packet.window.aiText } : {}),
      ...(packet.window.toolBodies !== undefined ? { toolBodies: packet.window.toolBodies } : {})
    },
    P: packet.P,
    H: packet.H,
    score: packet.score,
    gate: packet.gate,
    evidenceRefs: packet.evidenceRefs
  };
}

export interface ProposeFromAnomalyInput {
  readonly packet: AnalysisPacketInput;
  readonly registry: ResourceRegistry;
  readonly identity: ResourceIdentity;
}

/** Versioned candidate only. Never promotes and never patches the in-flight run. */
export function proposeFromAnomaly(input: ProposeFromAnomalyInput): ImprovementCandidate {
  const parent = input.registry.getActiveVersion(input.identity);
  if (parent === undefined) {
    throw new DomainValidationError("analysis cannot propose without an active rollback target");
  }
  const safe = sanitizePacketForAnalysis(input.packet);
  const content = JSON.stringify({
    gate: safe.gate,
    score: safe.score,
    P: safe.P,
    H: safe.H,
    evidenceRefs: safe.evidenceRefs,
    anomalyCodes: safe.summary.anomalyCodes,
    operations: safe.window.toolSituations.map((tool) => ({
      name: tool.name,
      ...(tool.exitCode !== undefined ? { exitCode: tool.exitCode } : {})
    })),
    rollbackTarget: parent.versionId
  });
  return input.registry.createCandidate({
    identity: input.identity,
    content,
    parentVersionId: parent.versionId,
    author: { kind: "detector", identity: "tracking-analysis" },
    evaluationPlan: ANALYSIS_EVALUATION_PLAN
  });
}
