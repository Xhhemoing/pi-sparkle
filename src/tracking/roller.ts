import type {
  AnomalyCode,
  ConstraintRecord,
  HumanSignal,
  OpenMinor,
  OptionalScore,
  RollingSummary,
  TrackingOmission,
  TrackingWindow
} from "./types.js";
import { hashSummary } from "./types.js";

export interface RollInput {
  readonly window: TrackingWindow;
  readonly prescore: OptionalScore;
  readonly human: HumanSignal;
  readonly score: number;
  readonly anomalyCodes: readonly AnomalyCode[];
  readonly evidenceRefs: readonly string[];
  readonly openMinors: readonly OpenMinor[];
  readonly maxItems?: number;
}

export interface RollResult {
  readonly summary: RollingSummary;
}

export function rollSummary(input: RollInput): RollResult {
  const previous = input.window.previous;
  const mergedConstraints = mergeConstraints(previous?.constraints ?? [], input.window.constraints);
  const unresolvedQuestions = uniqueStrings([
    ...(previous?.unresolvedQuestions ?? []),
    ...input.window.unresolvedDecisions
  ]).filter((question) => !input.window.confirmedDecisions.includes(question));
  const confirmedDecisions = uniqueStrings([
    ...(previous?.confirmedDecisions ?? []),
    ...input.window.confirmedDecisions
  ]);

  const mandatory: Array<{ key: string; kind: TrackingOmission["kind"]; text?: string }> = [
    ...mergedConstraints.map((item) => ({ key: item.id, kind: item.kind, text: item.text })),
    ...unresolvedQuestions.map((question) => ({ key: question, kind: "unresolved-decision" as const }))
  ];

  const omissions: TrackingOmission[] = [];
  let keptMandatory = mandatory;
  let failClosed = false;
  let failClosedReason: string | undefined;

  if (input.maxItems !== undefined && mandatory.length > input.maxItems) {
    keptMandatory = mandatory.slice(0, input.maxItems);
    for (const dropped of mandatory.slice(input.maxItems)) {
      omissions.push({
        key: dropped.key,
        kind: dropped.kind,
        mandatory: true,
        reason: "budget"
      });
    }
    failClosed = true;
    failClosedReason = "mandatory item could not fit; fail closed";
  }

  const keptIds = new Set(keptMandatory.map((item) => item.key));
  const constraints: ConstraintRecord[] = mergedConstraints.filter((item) => keptIds.has(item.id));
  const keptQuestions = unresolvedQuestions.filter((question) => keptIds.has(question));

  const prevSummaryHash = previous === undefined ? undefined : hashSummary(previous);

  const summary: RollingSummary = {
    schemaVersion: 1,
    constraints,
    unresolvedQuestions: keptQuestions,
    confirmedDecisions,
    operations: input.window.toolSituations,
    prescore: input.prescore,
    human: input.human,
    score: input.score,
    anomalyCodes: input.anomalyCodes,
    evidenceRefs: input.evidenceRefs,
    openMinors: input.openMinors,
    omissions,
    failClosed,
    ...(failClosedReason !== undefined ? { failClosedReason } : {}),
    ...(prevSummaryHash !== undefined ? { prevSummaryHash } : {})
  };

  return { summary };
}

function mergeConstraints(
  previous: readonly ConstraintRecord[],
  current: readonly ConstraintRecord[]
): ConstraintRecord[] {
  const byId = new Map<string, ConstraintRecord>();
  for (const item of previous) byId.set(item.id, item);
  for (const item of current) byId.set(item.id, item);
  return [...byId.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
