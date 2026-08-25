import { DomainValidationError } from "../domain/errors.js";
import { hash32 } from "../domain/hash.js";

export const UNOBSERVED = "UNOBSERVED" as const;
export type Unobserved = typeof UNOBSERVED;

/** Machine scores live on [0, 1]. Missing evidence stays UNOBSERVED, never 0.5. */
export type MachineScore = number;
export type OptionalScore = MachineScore | Unobserved;

export function isUnobserved(value: unknown): value is Unobserved {
  return value === UNOBSERVED;
}

export function isMachineScore(value: unknown): value is MachineScore {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export type AnomalyCode =
  | "deterministic-fail"
  | "ownership-escape"
  | "claimed-verification-without-checks"
  | "unmet-acceptance-criterion"
  | "repeated-no-progress"
  | "user-reject-stop"
  | "soft-threshold"
  | "minor-escalated"
  | "mandatory-omission"
  | "permission-security-reject";

export type EvidenceSource =
  | "deterministic"
  | "explicit-user-verdict"
  | "independent-check"
  | "tracking-credibility"
  | "actor-self-score";

export const TRACKING_EVIDENCE_PRECEDENCE: readonly {
  readonly source: EvidenceSource;
  readonly weight: number;
}[] = [
  { source: "deterministic", weight: 5 },
  { source: "explicit-user-verdict", weight: 4 },
  { source: "independent-check", weight: 3 },
  { source: "tracking-credibility", weight: 2 },
  { source: "actor-self-score", weight: 0 }
] as const;

export type ConstraintKind = "constraint" | "authority" | "unresolved-decision" | "failed-check";

export interface ConstraintRecord {
  readonly id: string;
  readonly text: string;
  readonly kind: ConstraintKind;
  readonly mandatory: true;
}

export interface OperationRecord {
  readonly name: string;
  readonly targetPath?: string;
  readonly scope?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly wrote: boolean;
  readonly escaped: boolean;
  readonly artifactIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly hashes: readonly string[];
}

export type ToolSituation = OperationRecord;

export type OpenMinorStatus = "verified-true" | Unobserved;

export interface OpenMinor {
  readonly id: string;
  readonly text: string;
  readonly status: OpenMinorStatus;
  readonly consecutiveTurns: number;
  readonly touchesConstraint: boolean;
  readonly userRejected: boolean;
}

export type OmissionKind = ConstraintKind | "operation" | "other";

export interface TrackingOmission {
  readonly key: string;
  readonly kind: OmissionKind;
  readonly mandatory: boolean;
  readonly reason: "budget" | "dropped";
}

export type ListItemClass = "permission" | "security";

export interface CountableListItem {
  readonly id: string;
  readonly text: string;
  readonly class?: ListItemClass;
}

export interface CountableList {
  readonly items: readonly CountableListItem[];
  readonly agreedIds: readonly string[];
}

export type ShortRuleBucket = "whole-reject" | "operation-reject" | "named-error-continue";

export type HumanSignal =
  | { readonly kind: "unobserved" }
  | {
      readonly kind: "ratio";
      readonly H: number;
      readonly agreed: number;
      readonly evaluable: number;
      readonly safetyRejected: boolean;
    }
  | { readonly kind: "ten-point"; readonly H: number; readonly mark: number }
  | { readonly kind: "short-rule"; readonly H: number; readonly bucket: ShortRuleBucket };

export interface RollingSummary {
  readonly schemaVersion: 1;
  readonly constraints: readonly ConstraintRecord[];
  readonly unresolvedQuestions: readonly string[];
  readonly confirmedDecisions: readonly string[];
  readonly operations: readonly OperationRecord[];
  readonly prescore: OptionalScore;
  readonly human: HumanSignal;
  readonly score: number;
  readonly anomalyCodes: readonly AnomalyCode[];
  readonly evidenceRefs: readonly string[];
  readonly openMinors: readonly OpenMinor[];
  readonly omissions: readonly TrackingOmission[];
  readonly failClosed: boolean;
  readonly failClosedReason?: string;
  readonly prevSummaryHash?: string;
}

export type SummaryHashInput = Omit<RollingSummary, "prevSummaryHash"> & {
  readonly prevSummaryHash?: string | undefined;
};

export interface TrackingWindow {
  readonly previous?: RollingSummary;
  readonly contextFacts: readonly string[];
  readonly userText?: string;
  readonly aiText?: string;
  readonly toolSituations: readonly ToolSituation[];
  readonly constraints: readonly ConstraintRecord[];
  readonly unresolvedDecisions: readonly string[];
  readonly confirmedDecisions: readonly string[];
  readonly openMinors: readonly OpenMinor[];
}

export type PrescoreDimensionId =
  | "evidence-consistency"
  | "scope-safety"
  | "check-coverage"
  | "constraint-retention"
  | "progress-vs-stall"
  | "narrative-coherence";

export interface DimensionScore {
  readonly id: PrescoreDimensionId;
  readonly outcome: "PASS" | "FAIL" | "ABSTAIN" | "UNOBSERVED" | "NOT_APPLICABLE";
  readonly value?: number;
  readonly hardRelated: boolean;
}

export interface PrescoreResult {
  readonly P: number;
  readonly quality: number;
  readonly coverage: number;
  readonly dimensions: readonly DimensionScore[];
  readonly cappedByHardFail: boolean;
  readonly displayPrescore: number;
}

export type GateKind = "hard" | "soft" | "none";

export interface GateDecision {
  readonly kind: GateKind;
  readonly codes: readonly AnomalyCode[];
  readonly wakeAnalysis: boolean;
  readonly expandDetail: boolean;
  readonly askUser: boolean;
  readonly openMinors: readonly OpenMinor[];
}

export type TrustTag = "FACT" | "DERIVED" | "INFERENTIAL" | "UNTRUSTED_TEXT";

export interface AnomalyPacketWindow {
  readonly contextFacts: readonly string[];
  readonly userText?: string;
  readonly userTextTrust?: TrustTag;
  readonly aiText?: string;
  readonly toolSituations: readonly ToolSituation[];
  readonly toolBodies?: readonly string[];
}

export interface AnomalyPacket {
  readonly summary: RollingSummary;
  readonly window: AnomalyPacketWindow;
  readonly P: number;
  readonly H: OptionalScore;
  readonly score: number;
  readonly gate: AnomalyCode;
  readonly evidenceRefs: readonly string[];
}

export function evidenceWeight(source: EvidenceSource): number {
  const entry = TRACKING_EVIDENCE_PRECEDENCE.find((item) => item.source === source);
  return entry?.weight ?? 0;
}

export type AssessmentVerdict = "PASS" | "FAIL" | "UNOBSERVED" | "NOT_APPLICABLE";

export interface AssessmentDimension {
  readonly id: PrescoreDimensionId;
  readonly verdict: AssessmentVerdict;
  readonly evidenceRefs?: readonly string[];
}

export interface TrackingAssessment {
  readonly schemaVersion: 1;
  readonly episodeId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly prescore: number;
  readonly quality: number;
  readonly coverage: number;
  readonly human: HumanSignal;
  readonly score: number;
  readonly dimensions: readonly AssessmentDimension[];
  readonly gate: GateDecision;
  readonly evidenceRefs: readonly string[];
}

const PRESCORE_DIMENSION_IDS: readonly PrescoreDimensionId[] = [
  "evidence-consistency",
  "scope-safety",
  "check-coverage",
  "constraint-retention",
  "progress-vs-stall",
  "narrative-coherence"
] as const;

const ASSESSMENT_VERDICTS: readonly AssessmentVerdict[] = [
  "PASS",
  "FAIL",
  "UNOBSERVED",
  "NOT_APPLICABLE"
] as const;

const GATE_KINDS: readonly GateKind[] = ["hard", "soft", "none"] as const;

const ANOMALY_CODES: readonly AnomalyCode[] = [
  "deterministic-fail",
  "ownership-escape",
  "claimed-verification-without-checks",
  "unmet-acceptance-criterion",
  "repeated-no-progress",
  "user-reject-stop",
  "soft-threshold",
  "minor-escalated",
  "mandatory-omission",
  "permission-security-reject"
] as const;

const SHORT_RULE_BUCKETS: readonly ShortRuleBucket[] = [
  "whole-reject",
  "operation-reject",
  "named-error-continue"
] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DomainValidationError(`${label} must be an array of strings`);
  }
  return value as string[];
}

function asUnitScore(value: unknown, label: string): number {
  if (!isMachineScore(value)) {
    throw new DomainValidationError(`${label} must be a finite number in [0, 1]`);
  }
  return value;
}

function asTenPointMark(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) {
    throw new DomainValidationError(`${label} must be a finite number in [0, 10]`);
  }
  return value;
}

function isPrescoreDimensionId(value: string): value is PrescoreDimensionId {
  return (PRESCORE_DIMENSION_IDS as readonly string[]).includes(value);
}

function isAssessmentVerdict(value: string): value is AssessmentVerdict {
  return (ASSESSMENT_VERDICTS as readonly string[]).includes(value);
}

function isGateKind(value: string): value is GateKind {
  return (GATE_KINDS as readonly string[]).includes(value);
}

function isAnomalyCode(value: string): value is AnomalyCode {
  return (ANOMALY_CODES as readonly string[]).includes(value);
}

function isShortRuleBucket(value: string): value is ShortRuleBucket {
  return (SHORT_RULE_BUCKETS as readonly string[]).includes(value);
}

function parseHumanSignal(value: unknown): HumanSignal {
  const record = asRecord(value, "human");
  if (record.kind === "unobserved") {
    return { kind: "unobserved" };
  }
  if (record.kind === "ratio") {
    const H = asUnitScore(record.H, "human.H");
    const agreed = record.agreed;
    const evaluable = record.evaluable;
    if (!Number.isInteger(agreed) || (agreed as number) < 0) {
      throw new DomainValidationError("human.agreed must be an integer >= 0");
    }
    if (!Number.isInteger(evaluable) || (evaluable as number) < 0) {
      throw new DomainValidationError("human.evaluable must be an integer >= 0");
    }
    if (typeof record.safetyRejected !== "boolean") {
      throw new DomainValidationError("human.safetyRejected must be a boolean");
    }
    return {
      kind: "ratio",
      H,
      agreed: agreed as number,
      evaluable: evaluable as number,
      safetyRejected: record.safetyRejected
    };
  }
  if (record.kind === "ten-point") {
    return {
      kind: "ten-point",
      H: asUnitScore(record.H, "human.H"),
      mark: asTenPointMark(record.mark, "human.mark")
    };
  }
  if (record.kind === "short-rule") {
    if (typeof record.bucket !== "string" || !isShortRuleBucket(record.bucket)) {
      throw new DomainValidationError("human.bucket is invalid");
    }
    return {
      kind: "short-rule",
      H: asUnitScore(record.H, "human.H"),
      bucket: record.bucket
    };
  }
  throw new DomainValidationError("human.kind is invalid");
}

function parseOpenMinor(value: unknown, label: string): OpenMinor {
  const record = asRecord(value, label);
  const status = record.status;
  if (status !== "verified-true" && status !== UNOBSERVED) {
    throw new DomainValidationError(`${label}.status is invalid`);
  }
  const consecutiveTurns = record.consecutiveTurns;
  if (!Number.isInteger(consecutiveTurns) || (consecutiveTurns as number) < 0) {
    throw new DomainValidationError(`${label}.consecutiveTurns must be an integer >= 0`);
  }
  if (typeof record.touchesConstraint !== "boolean") {
    throw new DomainValidationError(`${label}.touchesConstraint must be a boolean`);
  }
  if (typeof record.userRejected !== "boolean") {
    throw new DomainValidationError(`${label}.userRejected must be a boolean`);
  }
  return {
    id: asString(record.id, `${label}.id`),
    text: asString(record.text, `${label}.text`),
    status,
    consecutiveTurns: consecutiveTurns as number,
    touchesConstraint: record.touchesConstraint,
    userRejected: record.userRejected
  };
}

function parseGateDecision(value: unknown): GateDecision {
  const record = asRecord(value, "gate");
  if (typeof record.kind !== "string" || !isGateKind(record.kind)) {
    throw new DomainValidationError("gate.kind is invalid");
  }
  const codes = asArray(record.codes, "gate.codes").map((code, index) => {
    if (typeof code !== "string" || !isAnomalyCode(code)) {
      throw new DomainValidationError(`gate.codes[${index}] is invalid`);
    }
    return code;
  });
  if (typeof record.wakeAnalysis !== "boolean") {
    throw new DomainValidationError("gate.wakeAnalysis must be a boolean");
  }
  if (typeof record.expandDetail !== "boolean") {
    throw new DomainValidationError("gate.expandDetail must be a boolean");
  }
  if (typeof record.askUser !== "boolean") {
    throw new DomainValidationError("gate.askUser must be a boolean");
  }
  const openMinors = asArray(record.openMinors, "gate.openMinors").map((minor, index) =>
    parseOpenMinor(minor, `gate.openMinors[${index}]`)
  );
  return {
    kind: record.kind,
    codes,
    wakeAnalysis: record.wakeAnalysis,
    expandDetail: record.expandDetail,
    askUser: record.askUser,
    openMinors
  };
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an array`);
  }
  return value;
}

function parseAssessmentDimension(value: unknown, index: number): AssessmentDimension {
  const record = asRecord(value, `dimensions[${index}]`);
  const id = record.id;
  if (typeof id !== "string" || !isPrescoreDimensionId(id)) {
    throw new DomainValidationError(`dimensions[${index}].id is invalid`);
  }
  const verdict = record.verdict;
  if (typeof verdict !== "string" || !isAssessmentVerdict(verdict)) {
    throw new DomainValidationError(`dimensions[${index}].verdict is invalid`);
  }
  const evidenceRefs =
    record.evidenceRefs === undefined
      ? undefined
      : asStringArray(record.evidenceRefs, `dimensions[${index}].evidenceRefs`);
  if (verdict === "FAIL" && (evidenceRefs === undefined || evidenceRefs.length === 0)) {
    throw new DomainValidationError(
      `dimensions[${index}] with verdict FAIL requires non-empty evidenceRefs`
    );
  }
  return evidenceRefs === undefined ? { id, verdict } : { id, verdict, evidenceRefs };
}

export function parseTrackingAssessment(value: unknown): TrackingAssessment {
  const record = asRecord(value, "tracking assessment");
  if (record.schemaVersion !== 1) {
    throw new DomainValidationError("tracking assessment schemaVersion must be 1");
  }
  const dimensions = asArray(record.dimensions, "dimensions").map(parseAssessmentDimension);
  return {
    schemaVersion: 1,
    episodeId: asString(record.episodeId, "episodeId"),
    runId: asString(record.runId, "runId"),
    turnId: asString(record.turnId, "turnId"),
    prescore: asUnitScore(record.prescore, "prescore"),
    quality: asUnitScore(record.quality, "quality"),
    coverage: asUnitScore(record.coverage, "coverage"),
    human: parseHumanSignal(record.human),
    score: asUnitScore(record.score, "score"),
    dimensions,
    gate: parseGateDecision(record.gate),
    evidenceRefs: asStringArray(record.evidenceRefs, "evidenceRefs")
  };
}

export function hashAssessment(assessment: TrackingAssessment): string {
  const payload = {
    coverage: assessment.coverage,
    dimensions: [...assessment.dimensions]
      .map((dimension) => ({ id: dimension.id, verdict: dimension.verdict }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    episodeId: assessment.episodeId,
    gate: {
      codes: [...assessment.gate.codes].sort(),
      kind: assessment.gate.kind
    },
    prescore: assessment.prescore,
    quality: assessment.quality,
    runId: assessment.runId,
    score: assessment.score,
    turnId: assessment.turnId
  };
  return hash32(JSON.stringify(payload));
}

export function hashSummary(summary: SummaryHashInput): string {
  const payload = {
    anomalyCodes: [...summary.anomalyCodes].sort(),
    confirmedDecisions: [...summary.confirmedDecisions].sort(),
    constraintIds: summary.constraints.map((item) => item.id).sort(),
    omissionKeys: summary.omissions.map((item) => item.key).sort(),
    operations: summary.operations
      .map((operation) => ({
        exitCode: operation.exitCode,
        hashes: [...operation.hashes].sort(),
        name: operation.name
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    prevSummaryHash: summary.prevSummaryHash,
    score: summary.score,
    unresolvedQuestions: [...summary.unresolvedQuestions].sort()
  };
  return hash32(JSON.stringify(payload));
}
