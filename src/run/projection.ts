import type { RunId } from "../domain/ids.js";
import type { RunStatus } from "../domain/status.js";
import type { ModelInvocation } from "../telemetry/model-invocation.js";
import { isCostEligible, sumUsage } from "../telemetry/usage-aggregate.js";
import { gateBlockCause, type ChildInspection } from "./inspection.js";
import type { Event } from "./events.js";

/** Read-only inputs from inspection and validated telemetry; no second event authority. */
export interface RunStatusProjectionInput {
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly children: readonly ChildInspection[];
  readonly events: readonly Event[];
  readonly invocations?: readonly ModelInvocation[] | undefined;
  readonly pendingQuestions?: readonly { readonly id: string; readonly question: string }[];
  readonly requiredEvidence?: readonly string[];
  readonly truncated: boolean;
  readonly invocationsTruncated?: boolean;
}

export interface ProjectionNextStep {
  readonly command: string;
  readonly reason: string;
  readonly note?: string;
}

/**
 * RUN_STATUS_PROJECTION is a frozen-additive read model, not a domain Event.
 * Outcomes and criterion verdicts below are explicitly CHILD REPORTS, not host
 * acceptance. No percent-complete, approval, settlement or new terminal state
 * is inferred. Absent criteria stay absent; UNOBSERVED never means FAILED.
 * Contract pins live in test/integration/cli/status-projection.test.ts.
 */
export function buildRunStatusProjection(input: RunStatusProjectionInput) {
  const children = input.children.map((child) => {
    const verification = child.terminalResult?.verification;
    const criteria = verification?.criteria;
    return {
      taskId: child.taskId,
      childRunId: child.childRunId,
      outcome: child.outcome,
      verification: verification?.kind,
      verificationSource: verification === undefined ? "not-reported" as const : "child-report" as const,
      criteriaReported: criteria !== undefined,
      metCriteria: (criteria ?? []).filter((c) => c.kind === "PASSED").map((c) => c.id),
      unmetCriteria: (criteria ?? []).filter((c) => c.kind === "FAILED").map((c) => c.id),
      unobservedCriteria: (criteria ?? []).filter((c) => c.kind === "UNOBSERVED").map((c) => c.id)
    };
  });
  const blocked = input.status === "BLOCKED";
  const waiting = input.status === "WAITING_FOR_USER";
  // gateBlockCause describes the latest historical block. It is a current
  // blocker only when replay says BLOCKED; a later unblock/terminal clears it.
  const cause = blocked ? gateBlockCause(input.events) : undefined;
  const blockers = {
    ...(cause === undefined ? {} : { gateCause: {
      ...cause, codes: [...cause.codes], failedDimensions: [...cause.failedDimensions],
      unmetCriteria: cause.unmetCriteria.map((c) => ({ ...c, evidenceIds: [...c.evidenceIds] }))
    } }),
    requiredEvidence: blocked ? [...(input.requiredEvidence ?? [])] : [],
    pendingQuestions: waiting ? (input.pendingQuestions ?? []).map((q) => ({ ...q })) : []
  };
  return {
    type: "RUN_STATUS_PROJECTION" as const,
    runId: input.runId,
    status: input.status,
    children,
    progress: {
      total: children.length,
      // These are outcome counts, NOT independent verification counts.
      succeeded: children.filter((c) => c.outcome === "SUCCESS").length,
      failed: children.filter((c) => c.outcome === "FAILURE" || c.outcome === "TIMEOUT").length,
      partial: children.filter((c) => c.outcome === "PARTIAL").length,
      cancelled: children.filter((c) => c.outcome === "CANCELLED").length,
      unobserved: children.filter((c) => c.verification === undefined || c.verification === "UNOBSERVED").length,
      inFlight: children.filter((c) => c.outcome === "RUNNING").length,
      criteriaUnobserved: children.reduce((n, c) => n + c.unobservedCriteria.length, 0),
      criteriaNotReported: children.filter((c) => !c.criteriaReported).length
    },
    blockers,
    cost: projectCost(input.invocations, input.runId),
    safeNextSteps: safeNextSteps(input.status, input.runId, blockers.pendingQuestions),
    dataQuality: { truncated: input.truncated, invocationsTruncated: input.invocationsTruncated === true }
  };
}

export type RunStatusProjection = ReturnType<typeof buildRunStatusProjection>;

/**
 * Reuse the established usage eligibility policy. Non-ok/legacy rows stay
 * excluded AND counted: they may have incurred spend, so this is not a bill.
 * USD is only the finite, fully priced subset of this run's observed rows;
 * missing input/output usage or either rate never becomes an invented zero.
 * Parent/child rollup and exactly-once settlement remain PS-04 work.
 */
function projectCost(invocations: readonly ModelInvocation[] | undefined, runId: RunId) {
  const rows = (invocations ?? []).filter((row) => row.runId === runId);
  const totals = sumUsage(rows);
  let usd: number | undefined;
  let pricedInvocations = 0;
  let unpricedInvocations = 0;
  for (const row of rows) {
    if (!isCostEligible(row)) continue;
    const inputRate = row.pricing?.inputUsdPerMTok;
    const outputRate = row.pricing?.outputUsdPerMTok;
    if (row.tokensIn === undefined || row.tokensOut === undefined || inputRate === undefined || outputRate === undefined) {
      unpricedInvocations += 1;
      continue;
    }
    const cost = row.tokensIn / 1_000_000 * inputRate + row.tokensOut / 1_000_000 * outputRate;
    if (!Number.isFinite(cost) || !Number.isFinite((usd ?? 0) + cost)) {
      unpricedInvocations += 1;
      continue;
    }
    usd = (usd ?? 0) + cost;
    pricedInvocations += 1;
  }
  return {
    invocationsAvailable: invocations !== undefined,
    known: {
      invocations: totals.invocations, tokensIn: totals.tokensIn, tokensOut: totals.tokensOut,
      withUsage: totals.withUsage, usd, pricedInvocations
    },
    unknown: {
      missingUsage: totals.missingUsage, excludedNotOk: totals.excludedNotOk,
      unattributed: totals.excludedUnattributed, unpricedInvocations
    }
  };
}

function safeNextSteps(status: RunStatus, runId: RunId, questions: readonly { readonly id: string }[]): ProjectionNextStep[] {
  if (status === "BLOCKED") return [
    { command: `inspect --run ${runId}`, reason: "review the block and its recorded evidence" },
    { command: `inject --run ${runId} --type fact --key <key> --value <text>`, reason: "supply a fact the block asked for" },
    {
      command: `unblock --run ${runId} --reason <text> [--retry-node <nodeId>]`,
      reason: "authorize reopening after reviewing the evidence",
      note: "resume alone replays BLOCKED; unblock first, then resume (neither step is automatic)"
    },
    { command: `resume --run ${runId}`, reason: "only after unblock succeeds, execute the reopened work" }
  ];
  if (status === "PAUSED") return [
    { command: `resume --run ${runId} --unpause`, reason: "clear the pause token and continue" }
  ];
  if (status === "WAITING_FOR_USER") return questions.map((question) => ({
    command: `answer --run ${runId} --message ${question.id} --text <answer>`, reason: "respond to this recorded child question"
  }));
  // Clarification-only WAITING_FOR_USER has no child question. Its new-run
  // continuation belongs to the existing CLI renderer, not a guessed answer.
  return [];
}
