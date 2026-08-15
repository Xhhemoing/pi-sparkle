import { type EventId, type TaskId } from "../domain/ids.js";
import type { ConfidenceScore } from "../domain/flowchart.js";
import type { IsoTimestamp } from "../domain/timestamp.js";

/** Facts observed so far, used to detect duplicates across rounds. */

export interface LedgerFact {
  key: string;
  value: string;
  confidence: ConfidenceScore;
}

export interface LedgerProgressEntry {
  round: number;
  what: "TASK_COMPLETED" | "EVIDENCE" | "FACT" | "BLOCKER_RESOLVED" | "USER_DECISION";
  taskId?: TaskId;
  detail?: string;
}

export interface LedgerBlocker {
  kind: "NEEDS_INFO" | "DEPENDENCY" | "EXTERNAL" | "UNKNOWN";
  description: string;
  taskId?: TaskId;
}

export interface LedgerNextAction {
  taskId: TaskId;
  action: "RETRY" | "SKIP" | "RUN" | "WAIT_FOR_USER";
}

/** Evidence required to resume a BLOCKED run. */
export interface RequiredEvidence {
  description: string;
}

export interface RunLedger {
  revision: number;
  objective: string;
  facts: LedgerFact[];
  progress: LedgerProgressEntry[];
  blockers: LedgerBlocker[];
  nextActions: LedgerNextAction[];
  round: number;
  consecutiveStalls: number;
  maxConsecutiveStalls: number;
  isBlocked: boolean;
  requiredEvidence: RequiredEvidence[];
  updatedByEventId?: EventId;
  updatedAt?: IsoTimestamp;
}

/** Facts observed so far, used to detect duplicates across rounds. */
export interface LedgerRoundEvent {
  taskId?: TaskId;
  completedTasks: TaskId[];
  newEvidenceIds: string[];
  newFacts: LedgerFact[];
  resolvedBlockers: LedgerBlocker[];
  userDecision: boolean;
}

export interface AdvanceOptions {
  event?: LedgerRoundEvent;
  timestamp?: IsoTimestamp;
  eventId?: EventId;
}

export function createLedger(objective: string, maxConsecutiveStalls = 3): RunLedger {
  return {
    revision: 0,
    objective,
    facts: [],
    progress: [],
    blockers: [],
    nextActions: [],
    round: 0,
    consecutiveStalls: 0,
    maxConsecutiveStalls,
    isBlocked: false,
    requiredEvidence: []
  };
}

function isDuplicateFact(facts: readonly LedgerFact[], fact: LedgerFact): boolean {
  return facts.some((existing) => existing.key === fact.key && existing.value === fact.value);
}

/**
 * A round has progress only when it adds a completed task, validated
 * evidence, a new non-duplicate fact, a resolved blocker, or a user-decision
 * boundary. Repeating the same plan or retrying without new evidence is a
 * stall.
 */
export function classifyRoundProgress(event: LedgerRoundEvent, ledger?: RunLedger): boolean {
  if (event.completedTasks.length > 0) return true;
  if (event.newEvidenceIds.length > 0) return true;
  if (event.userDecision) return true;
  if (event.resolvedBlockers.length > 0) return true;
  if (event.newFacts.length > 0) {
    const facts = ledger?.facts ?? [];
    if (event.newFacts.some((fact) => !isDuplicateFact(facts, fact))) return true;
  }
  return false;
}

/** Advances the ledger by one round, updating the stall counter. */
export function advanceLedgerRound(
  ledger: RunLedger,
  progress: boolean,
  maxConsecutiveStalls: number,
  options: AdvanceOptions = {}
): RunLedger {
  const round = ledger.round + 1;
  const consecutiveStalls = progress ? 0 : ledger.consecutiveStalls + 1;
  const isBlocked = consecutiveStalls >= maxConsecutiveStalls;
  const event = options.event;

  const progressEntries: LedgerProgressEntry[] = [...ledger.progress];
  if (event !== undefined) {
    for (const taskId of event.completedTasks) {
      progressEntries.push({ round, what: "TASK_COMPLETED", taskId });
    }
    for (const evidence of event.newEvidenceIds) {
      progressEntries.push({ round, what: "EVIDENCE", detail: evidence });
    }
    for (const fact of event.newFacts) {
      if (!isDuplicateFact(ledger.facts, fact)) {
        progressEntries.push({ round, what: "FACT", detail: fact.key });
      }
    }
    for (const blocker of event.resolvedBlockers) {
      progressEntries.push({ round, what: "BLOCKER_RESOLVED", detail: blocker.description });
    }
    if (event.userDecision) {
      progressEntries.push({ round, what: "USER_DECISION" });
    }
  }

  const facts = [...ledger.facts];
  if (event !== undefined) {
    for (const fact of event.newFacts) {
      if (!isDuplicateFact(facts, fact)) facts.push(fact);
    }
  }

  const requiredEvidence: RequiredEvidence[] = isBlocked
    ? [{ description: "Add a completed task, validated evidence, a new fact, or resolve a blocker in the next round" }]
    : [];

  return {
    ...ledger,
    revision: ledger.revision + 1,
    facts,
    progress: progressEntries,
    round,
    consecutiveStalls,
    maxConsecutiveStalls,
    isBlocked,
    requiredEvidence,
    ...(options.timestamp !== undefined ? { updatedAt: options.timestamp } : {}),
    ...(options.eventId !== undefined ? { updatedByEventId: options.eventId } : {})
  };
}
