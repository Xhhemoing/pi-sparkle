import type { R0Config, R0Decision } from "./r0.js";
import { applyCascade } from "./r0.js";

export type CascadeEvidenceSource =
  | "deterministic-check"
  | "compile"
  | "schema"
  | "acceptance"
  | "critic"
  | "self-report"
  | "none";

export type CascadeEvidenceKind = "PASS" | "FAIL" | "ABSTAIN";

export interface CascadeEvidence {
  readonly source: CascadeEvidenceSource;
  readonly kind: CascadeEvidenceKind;
}

export interface EvidenceCascadeResult {
  readonly decision: R0Decision;
  readonly retained: boolean;
  readonly escalated: boolean;
  readonly abstained: boolean;
}

export type EvidenceCascadeAction = "retain" | "escalate" | "abstain";

export interface EvidenceCascadeChoice {
  readonly action: EvidenceCascadeAction;
  readonly reason: string;
}

/** Evidence gate only — no catalog, no live import of R1. */
export function resolveEvidenceCascade(
  highRisk: boolean,
  evidence: CascadeEvidence
): EvidenceCascadeChoice {
  if (highRisk) {
    return { action: "retain", reason: "high-risk: cascade exploration forbidden" };
  }
  if (evidence.source === "self-report") {
    return { action: "retain", reason: "self-report weight is 0; cascade ignored" };
  }
  if (evidence.source === "none" || evidence.kind === "ABSTAIN" || evidence.source === "critic") {
    const reason =
      evidence.source === "critic"
        ? "critic cannot prove PASS; ABSTAIN (no cheap retain, no self-report)"
        : "no deterministic check; ABSTAIN — conservative model or human gate";
    return { action: "abstain", reason };
  }
  const positive =
    evidence.kind === "PASS" &&
    (evidence.source === "deterministic-check" ||
      evidence.source === "compile" ||
      evidence.source === "schema" ||
      evidence.source === "acceptance");
  if (positive) {
    return { action: "retain", reason: "deterministic positive evidence; retain" };
  }
  return { action: "escalate", reason: "deterministic FAIL; escalate" };
}

/**
 * First-attempt cascade. Only deterministic checks / compile / schema /
 * explicit acceptance PASS may keep a cheap tier. Critic cannot prove PASS.
 * Self-report weight is 0. Missing checks ABSTAIN — do not treat as pass or
 * as a reason to explore.
 */
export function applyEvidenceCascade(
  config: R0Config,
  decision: R0Decision,
  previousModelId: string,
  evidence: CascadeEvidence
): EvidenceCascadeResult {
  const choice = resolveEvidenceCascade(decision.request.highRisk, evidence);
  if (choice.action === "retain" && decision.request.highRisk) {
    return {
      decision: { ...decision, reason: choice.reason },
      retained: true,
      escalated: false,
      abstained: false
    };
  }
  if (choice.action === "retain" && evidence.source === "self-report") {
    return {
      decision: { ...decision, reason: choice.reason },
      retained: true,
      escalated: false,
      abstained: false
    };
  }
  if (choice.action === "abstain") {
    return {
      decision: { ...decision, reason: choice.reason },
      retained: false,
      escalated: false,
      abstained: true
    };
  }
  if (choice.action === "retain") {
    const next = applyCascade(config, decision, {
      previousModelId,
      previousConfidence: 1
    });
    return { decision: next, retained: true, escalated: false, abstained: false };
  }
  const next = applyCascade(config, decision, {
    previousModelId,
    previousConfidence: 0
  });
  const escalated = next.selection !== undefined && next.selection !== previousModelId;
  return { decision: next, retained: !escalated, escalated, abstained: false };
}
