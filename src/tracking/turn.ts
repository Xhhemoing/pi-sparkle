import { DEFAULT_TRACKING_CONFIG, type TrackingConfig } from "./config.js";
import { combineScore } from "./combined-score.js";
import { evaluateGates, type GateInput } from "./gates.js";
import {
  extractHumanScore,
  hasObviousHumanProblem,
  humanScoreValue,
  type HumanScoreInput
} from "./human-score.js";
import { computePrescore, type PrescoreInput } from "./prescore.js";
import { rollSummary } from "./roller.js";
import type {
  AnomalyCode,
  AnomalyPacket,
  AnomalyPacketWindow,
  GateDecision,
  HumanSignal,
  OpenMinor,
  RollingSummary,
  TrackingWindow
} from "./types.js";

export interface DetailReaders {
  readonly readToolBodies?: () => readonly string[];
}

export type GateFactOverrides = Partial<
  Omit<GateInput, "P" | "score" | "human" | "config" | "openMinors">
>;

export interface TrackingTurnInput {
  readonly window: TrackingWindow;
  readonly prescoreInput: PrescoreInput;
  readonly humanInput: HumanScoreInput;
  readonly gateFacts?: GateFactOverrides;
  readonly config?: TrackingConfig;
  readonly readers?: DetailReaders;
  readonly maxItems?: number;
}

export interface TrackingTurnResult {
  readonly summary: RollingSummary;
  readonly P: number;
  readonly human: HumanSignal;
  readonly score: number;
  readonly gate: GateDecision;
  readonly packet?: AnomalyPacket;
  readonly readersInvoked: {
    readonly toolBodies: boolean;
    readonly chainOfThought: boolean;
  };
}

export function mergeOpenMinors(
  previous: readonly OpenMinor[],
  current: readonly OpenMinor[]
): OpenMinor[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const merged: OpenMinor[] = [];
  for (const item of current) {
    seen.add(item.id);
    const prior = previousById.get(item.id);
    const consecutive = prior === undefined ? item.consecutiveTurns : Math.max(item.consecutiveTurns, prior.consecutiveTurns + 1);
    merged.push({ ...item, consecutiveTurns: consecutive });
  }
  for (const item of previous) {
    if (!seen.has(item.id)) merged.push(item);
  }
  return merged;
}

export function runTrackingTurn(input: TrackingTurnInput): TrackingTurnResult {
  const config = input.config ?? DEFAULT_TRACKING_CONFIG;
  const openMinors = mergeOpenMinors(input.window.previous?.openMinors ?? [], input.window.openMinors);
  const lightMinorCount =
    input.prescoreInput.lightMinorCount ??
    openMinors.filter((item) => item.status === "verified-true").length;
  const prescore = computePrescore({
    ...input.prescoreInput,
    lightMinorCount
  });
  const userText = input.humanInput.userText ?? input.window.userText;
  const human = extractHumanScore({
    ...(input.humanInput.list !== undefined ? { list: input.humanInput.list } : {}),
    ...(userText !== undefined ? { userText } : {})
  });
  const obviousProblem = hasObviousHumanProblem(human);
  const score = combineScore({ P: prescore.P, human, obviousProblem });
  const safetyRejected = input.gateFacts?.safetyRejected ?? (human.kind === "ratio" && human.safetyRejected);
  const userRejectStop =
    input.gateFacts?.userRejectStop ?? (human.kind === "short-rule" && human.bucket === "whole-reject");

  let gate = evaluateGates({
    P: prescore.P,
    score,
    human,
    config,
    deterministicFail: input.gateFacts?.deterministicFail ?? false,
    ownershipEscape:
      input.gateFacts?.ownershipEscape ?? input.window.toolSituations.some((tool) => tool.escaped),
    claimedVerificationWithoutChecks: input.gateFacts?.claimedVerificationWithoutChecks ?? false,
    repeatedNoProgress: input.gateFacts?.repeatedNoProgress ?? input.prescoreInput.stalledTurns >= 2,
    userRejectStop,
    safetyRejected,
    openMinors
  });

  let readersInvoked: TrackingTurnResult["readersInvoked"] = {
    toolBodies: false,
    chainOfThought: false
  };
  let toolBodies: readonly string[] | undefined;
  if (gate.expandDetail && input.readers?.readToolBodies !== undefined) {
    toolBodies = input.readers.readToolBodies();
    readersInvoked = { toolBodies: true, chainOfThought: false };
  }

  const anomalyCodes = [...gate.codes];

  const rolled = rollSummary({
    window: { ...input.window, openMinors },
    prescore: prescore.P,
    human,
    score,
    anomalyCodes,
    evidenceRefs: collectEvidence(input.window),
    openMinors,
    ...(input.maxItems !== undefined ? { maxItems: input.maxItems } : {})
  });

  let summary = rolled.summary;
  if (summary.failClosed) {
    const codes: AnomalyCode[] = uniqueCodes([...summary.anomalyCodes, "mandatory-omission"]);
    summary = { ...summary, anomalyCodes: codes };
    gate = { ...gate, askUser: true, codes };
  }

  let packet: AnomalyPacket | undefined;
  if (gate.wakeAnalysis) {
    const windowDetail: AnomalyPacketWindow = {
      contextFacts: input.window.contextFacts,
      toolSituations: input.window.toolSituations,
      ...(input.window.userText !== undefined
        ? { userText: input.window.userText, userTextTrust: "UNTRUSTED_TEXT" as const }
        : {}),
      ...(input.window.aiText !== undefined ? { aiText: input.window.aiText } : {}),
      ...(toolBodies !== undefined ? { toolBodies } : {})
    };
    packet = {
      summary,
      window: windowDetail,
      P: prescore.P,
      H: humanScoreValue(human),
      score,
      gate: gate.codes[0] ?? "soft-threshold",
      evidenceRefs: summary.evidenceRefs
    };
  }

  return {
    summary,
    P: prescore.P,
    human,
    score,
    gate,
    ...(packet !== undefined ? { packet } : {}),
    readersInvoked
  };
}

function collectEvidence(window: TrackingWindow): string[] {
  const refs = new Set<string>();
  for (const tool of window.toolSituations) {
    for (const id of tool.evidenceIds) refs.add(id);
    for (const id of tool.artifactIds) refs.add(id);
    for (const hash of tool.hashes) refs.add(hash);
  }
  return [...refs];
}

function uniqueCodes(codes: readonly AnomalyCode[]): AnomalyCode[] {
  return [...new Set(codes)];
}
