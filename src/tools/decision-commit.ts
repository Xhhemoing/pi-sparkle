import { DomainValidationError } from "../domain/errors.js";
import { isConfidenceScore, type Flowchart, type FlowchartNodeRole, type FlowNode } from "../domain/flowchart.js";
import { isRecord } from "../domain/record.js";
import type { Event } from "../run/events.js";
import type { RunCheckpoint } from "../run/replay.js";
import type { FlowchartSupervisorSnapshot, FlowNodeRuntime } from "../supervisor/flowchart-supervisor.js";
import type { LedgerProgressEntry, LedgerRoundEvent } from "../supervisor/ledger.js";

export const DECISION_COMMIT_TYPES = ["feat", "fix", "chore"] as const;
export type DecisionCommitType = (typeof DECISION_COMMIT_TYPES)[number];

export const COMMIT_SCOPE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const MAX_SUBJECT_CHARS = 72;
const MAX_FIRST_LINE_CHARS = 100;

export interface DecisionCommitProposal {
  readonly type: DecisionCommitType;
  readonly scope: string;
  readonly subject: string;
  readonly nodeId: string;
  readonly evidenceIds: readonly string[];
  readonly runId: string;
  readonly confidence?: number;
  readonly model?: string;
}

export interface DecisionCommitSnapshot {
  readonly nodes: Readonly<Record<string, Pick<FlowNodeRuntime, "state" | "confidence" | "model"> | undefined>>;
  readonly ledger: { readonly progress: readonly LedgerProgressEntry[] };
  readonly pendingRoundEvent?: Pick<LedgerRoundEvent, "newEvidenceIds"> & {
    readonly taskId?: string;
    readonly completedTasks?: readonly string[];
  };
}

export interface DecisionCommitInput {
  readonly runId: string;
  readonly objective: string;
  readonly definition: Pick<Flowchart, "nodes">;
  readonly snapshot: DecisionCommitSnapshot;
  readonly events: readonly Event[];
  readonly nodeIds?: readonly string[];
}

function isDecisionCommitType(value: unknown): value is DecisionCommitType {
  return typeof value === "string" && (DECISION_COMMIT_TYPES as readonly string[]).includes(value);
}

function commitTypeForRole(role: FlowchartNodeRole): DecisionCommitType {
  if (role === "actor" || role === "tool") return "feat";
  if (role === "critic") return "fix";
  return "chore";
}

function commitScope(node: FlowNode): string {
  return COMMIT_SCOPE_PATTERN.test(node.id) ? node.id : node.role;
}

function firstLineSubject(objective: string, prefix: string): string {
  const line = objective.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  const collapsed = line.replace(/\s+/g, " ").trim();
  const budget = Math.min(MAX_SUBJECT_CHARS, Math.max(0, MAX_FIRST_LINE_CHARS - prefix.length));
  return collapsed.length <= budget ? collapsed : collapsed.slice(0, budget);
}

function uniqueSorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter((id) => id.trim() !== "").sort();
}

function evidenceFromChildResults(node: FlowNode, events: readonly Event[]): string[] {
  const ids: string[] = [];
  for (const event of events) {
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT") continue;
    if (message.taskId !== node.taskId) continue;
    ids.push(...message.evidenceIds);
  }
  return ids;
}

function evidenceFromLedgerProgress(node: FlowNode, progress: readonly LedgerProgressEntry[]): string[] {
  const byRound = new Map<number, LedgerProgressEntry[]>();
  for (const entry of progress) {
    const group = byRound.get(entry.round) ?? [];
    group.push(entry);
    byRound.set(entry.round, group);
  }
  const ids: string[] = [];
  for (const entries of byRound.values()) {
    const completed = entries.filter((entry) => entry.what === "TASK_COMPLETED");
    if (completed.length !== 1 || completed[0]?.taskId !== node.taskId) continue;
    for (const entry of entries) {
      if (entry.what === "EVIDENCE" && typeof entry.detail === "string" && entry.detail.trim() !== "") {
        ids.push(entry.detail);
      }
    }
  }
  return ids;
}

function evidenceFromPendingRound(node: FlowNode, pending: DecisionCommitSnapshot["pendingRoundEvent"]): string[] {
  if (pending === undefined) return [];
  const completed = pending.completedTasks ?? [];
  const attributable =
    pending.taskId === node.taskId || (completed.length === 1 && completed[0] === node.taskId);
  if (!attributable) return [];
  return [...(pending.newEvidenceIds ?? [])];
}

function evidenceIdsForNode(node: FlowNode, input: DecisionCommitInput): string[] {
  return uniqueSorted([
    ...evidenceFromChildResults(node, input.events),
    ...evidenceFromLedgerProgress(node, input.snapshot.ledger.progress),
    ...evidenceFromPendingRound(node, input.snapshot.pendingRoundEvent)
  ]);
}

/**
 * Validates `--nodes` against flowchart ids. `undefined` means no filter.
 * Unknown ids fail closed.
 */
export function filterDecisionCommitNodeIds(
  knownIds: readonly string[],
  requested: readonly string[] | undefined
): readonly string[] | undefined {
  if (requested === undefined) return undefined;
  const known = new Set(knownIds);
  const unknown = [...new Set(requested)].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new DomainValidationError(`unknown flowchart node id(s): ${unknown.join(", ")}`);
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of requested) {
    if (id.trim() === "") {
      throw new DomainValidationError("node ids must be non-empty");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function parseCommitNodeIdsCsv(csv: string | undefined): readonly string[] | undefined {
  if (csv === undefined) return undefined;
  return csv
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

export function assembleDecisionCommitInput(
  checkpoint: RunCheckpoint,
  events: readonly Event[],
  runId: string
): DecisionCommitInput {
  if (checkpoint.flowchart === undefined) {
    throw new DomainValidationError("checkpoint has no flowchart; decision-to-commit requires a flowchart run");
  }
  const snapshot: FlowchartSupervisorSnapshot = checkpoint.flowchart.snapshot;
  return {
    runId,
    objective: snapshot.ledger.objective,
    definition: checkpoint.flowchart.definition,
    snapshot,
    events
  };
}

export function generateDecisionCommits(input: DecisionCommitInput): DecisionCommitProposal[] {
  const knownIds = input.definition.nodes.map((node) => node.id);
  const selected = filterDecisionCommitNodeIds(knownIds, input.nodeIds);
  const selectedSet = selected === undefined ? undefined : new Set(selected);
  const proposals: DecisionCommitProposal[] = [];
  for (const node of input.definition.nodes) {
    if (selectedSet !== undefined && !selectedSet.has(node.id)) continue;
    const runtime = input.snapshot.nodes[node.id];
    if (runtime?.state !== "COMPLETED") continue;
    const type = commitTypeForRole(node.role);
    const scope = commitScope(node);
    const prefix = `${type}(${scope}): `;
    const subject = firstLineSubject(node.objective, prefix);
    const evidenceIds = evidenceIdsForNode(node, input);
    proposals.push({
      type,
      scope,
      subject,
      nodeId: node.id,
      evidenceIds,
      runId: input.runId,
      ...(runtime.confidence !== undefined ? { confidence: runtime.confidence } : {}),
      ...(runtime.model !== undefined ? { model: runtime.model } : {})
    });
  }
  if (proposals.length === 0) {
    throw new DomainValidationError("no completed nodes to commit");
  }
  return proposals;
}

export function formatCommitMessage(proposal: DecisionCommitProposal): string {
  const evidence =
    proposal.evidenceIds.length === 0 ? "none" : proposal.evidenceIds.join(", ");
  const lines = [`Evidence: ${evidence}`];
  if (proposal.confidence !== undefined) {
    lines.push(`Confidence: ${proposal.confidence}`);
  }
  lines.push(`Run: ${proposal.runId}`);
  if (proposal.model !== undefined) {
    lines.push(`Model: ${proposal.model}`);
  }
  return `${proposal.type}(${proposal.scope}): ${proposal.subject}\n\n${lines.join("\n")}`;
}

export function validateDecisionCommitProposal(value: unknown): DecisionCommitProposal {
  if (!isRecord(value)) {
    throw new DomainValidationError("decision commit proposal must be an object");
  }
  if (!isDecisionCommitType(value.type)) {
    throw new DomainValidationError("decision commit type must be feat, fix, or chore");
  }
  if (typeof value.scope !== "string" || !COMMIT_SCOPE_PATTERN.test(value.scope)) {
    throw new DomainValidationError("decision commit scope must match ^[a-zA-Z0-9][a-zA-Z0-9._-]*$");
  }
  if (typeof value.subject !== "string" || value.subject.trim() === "" || /[\r\n]/.test(value.subject)) {
    throw new DomainValidationError("decision commit subject must be a non-empty single line");
  }
  if (typeof value.nodeId !== "string" || value.nodeId.trim() === "") {
    throw new DomainValidationError("decision commit nodeId must be a non-empty string");
  }
  if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every((id) => typeof id === "string" && id.trim() !== "")) {
    throw new DomainValidationError("decision commit evidenceIds must be an array of non-empty strings");
  }
  if (typeof value.runId !== "string" || value.runId.trim() === "") {
    throw new DomainValidationError("decision commit runId must be a non-empty string");
  }
  if (value.confidence !== undefined && !isConfidenceScore(value.confidence)) {
    throw new DomainValidationError("decision commit confidence must be a finite number between 0 and 1");
  }
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.trim() === "")) {
    throw new DomainValidationError("decision commit model must be a non-empty string");
  }
  return {
    type: value.type,
    scope: value.scope,
    subject: value.subject,
    nodeId: value.nodeId,
    evidenceIds: value.evidenceIds,
    runId: value.runId,
    ...(value.confidence !== undefined ? { confidence: value.confidence } : {}),
    ...(value.model !== undefined ? { model: value.model } : {})
  };
}

export function parseDecisionCommitFile(raw: string): DecisionCommitProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DomainValidationError(
      `decision commit file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.commits)) {
    throw new DomainValidationError("decision commit file must be { \"commits\": [...] }");
  }
  if (parsed.commits.length === 0) {
    throw new DomainValidationError("decision commit file has no commits");
  }
  return parsed.commits.map((entry, index) => {
    try {
      return validateDecisionCommitProposal(entry);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DomainValidationError(`commits[${index}]: ${detail}`);
    }
  });
}

export function gitCommitArgs(
  proposal: DecisionCommitProposal,
  options: { sign: boolean }
): readonly string[] {
  void proposal;
  const args = ["commit"];
  if (options.sign) args.push("-S");
  else args.push("--no-gpg-sign");
  args.push("--allow-empty", "-F", "-");
  return args;
}
