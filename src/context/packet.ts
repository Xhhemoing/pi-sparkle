import type { TaskId } from "../domain/ids.js";
import { hash32 } from "../domain/hash.js";
import type { RequirementContract } from "../domain/contract.js";
import type { CodeMapEntry, CodeMapOmission, ContextFact, ProjectContextIndex } from "./index.js";

export interface ContextRequest {
  readonly taskId: TaskId;
  readonly contract: RequirementContract;
  readonly index: ProjectContextIndex;
  readonly tokenBudget: number;
  readonly selectorVersion: 1;
  readonly dependencyOutputs?: readonly string[] | undefined;
  readonly secretEvidenceRefs?: readonly string[] | undefined;
}

export interface OmissionRecord {
  readonly key: string;
  readonly reason: "token-budget" | "secret" | "unavailable" | "unrelated-dirty";
  readonly rank: number;
}

export interface PacketCodeMapOmission extends CodeMapOmission {
  readonly source: "index" | "packet";
}

export interface PacketCodeMap {
  readonly schemaVersion: 1;
  readonly tokenBudget: number;
  readonly estimatedTokens: number;
  readonly entries: readonly CodeMapEntry[];
  readonly omissions: readonly PacketCodeMapOmission[];
}

export interface ContextPacket {
  readonly taskId: TaskId;
  readonly contractDigest: string;
  readonly requiredFacts: string[];
  readonly relevantFiles: string[];
  readonly codeMap: PacketCodeMap;
  readonly tokenBudget: number;
  readonly omittedSummary: { reason: string; count: number }[];
  readonly omissions: readonly OmissionRecord[];
  readonly selectorVersion: 1;
}

const RANK_MANDATORY = 1;
const RANK_INSTRUCTION = 10;
const RANK_MANIFEST = 20;
const RANK_INDEX_FACT = 30;
const RANK_DEFAULTED_QUESTION = 40;
const RANK_TEST = 50;
const RANK_GENERATED = 60;
const RANK_RISK = 80;
const RANK_UNRELATED_DIRTY = 90;
const RANK_CODE_MAP = 70;
const RANK_SECRET = 100;

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

interface PacketCandidate {
  readonly key: string;
  readonly text: string;
  readonly destination: "requiredFacts" | "relevantFiles";
  readonly rank: number;
  readonly preOmit: OmissionRecord["reason"] | undefined;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compatibility wrapper: compiles a packet from an index with an empty contract.
 * Prefer {@link compileContextPacket} when a real requirement contract is available.
 */
export function compilePacket(
  taskId: TaskId,
  index: ProjectContextIndex,
  budget = 4000
): ContextPacket {
  return compileContextPacket({
    taskId,
    contract: EMPTY_CONTRACT,
    index,
    tokenBudget: budget,
    selectorVersion: 1
  });
}

export function compileContextPacket(request: ContextRequest): ContextPacket {
  const candidates = collectCandidates(request);
  const selected: PacketCandidate[] = [];
  const omissions: OmissionRecord[] = [];
  const codeMapSelection = selectCodeMap(request.index);
  let used = 0;

  for (const candidate of candidates) {
    if (candidate.preOmit !== undefined) {
      omissions.push({ key: candidate.key, reason: candidate.preOmit, rank: candidate.rank });
      continue;
    }
    const cost = estimateTokens(candidate.text);
    if (used + cost <= request.tokenBudget) {
      selected.push(candidate);
      used += cost;
    } else {
      omissions.push({ key: candidate.key, reason: "token-budget", rank: candidate.rank });
    }
  }

  omissions.sort(compareOmissions);

  const requiredFacts = selected
    .filter((candidate) => candidate.destination === "requiredFacts")
    .map((candidate) => candidate.text);
  const relevantFiles = selected
    .filter((candidate) => candidate.destination === "relevantFiles")
    .map((candidate) => candidate.text);
  const packetCodeMapOmissions: PacketCodeMapOmission[] = codeMapSelection.omissions.map((omission) => ({
    ...omission,
    source: "index"
  }));
  for (const omission of codeMapSelection.omissions) {
    omissions.push({
      key: `code-map:${omission.path}:${omission.symbol}`,
      reason: "token-budget",
      rank: RANK_CODE_MAP
    });
  }
  const codeMapEntries: CodeMapEntry[] = [];
  let codeMapUsed = 0;
  for (const entry of codeMapSelection.entries) {
    const cost = estimateCodeMapEntry(entry);
    if (used + cost <= request.tokenBudget) {
      codeMapEntries.push(entry);
      used += cost;
      codeMapUsed += cost;
    } else {
      const omission = {
        path: entry.path,
        symbol: entry.symbol,
        reason: "token-budget" as const,
        rank: 1,
        source: "packet" as const
      };
      packetCodeMapOmissions.push(omission);
      omissions.push({
        key: `code-map:${entry.path}:${entry.symbol}`,
        reason: "token-budget",
        rank: RANK_CODE_MAP
      });
    }
  }

  packetCodeMapOmissions.sort(compareCodeMapOmissions);
  omissions.sort(compareOmissions);

  return {
    taskId: request.taskId,
    contractDigest: contractDigest(request.contract),
    requiredFacts,
    relevantFiles,
    codeMap: {
      schemaVersion: 1,
      tokenBudget: request.index.codeMap.tokenBudget,
      estimatedTokens: codeMapUsed,
      entries: codeMapEntries,
      omissions: packetCodeMapOmissions
    },
    tokenBudget: request.tokenBudget,
    omittedSummary: summarizeOmissions(omissions),
    omissions,
    selectorVersion: 1
  };
}

function selectCodeMap(index: ProjectContextIndex): {
  readonly entries: readonly CodeMapEntry[];
  readonly omissions: readonly CodeMapOmission[];
} {
  return {
    entries: [...index.codeMap.entries],
    omissions: [...index.codeMap.omissions]
  };
}

function estimateCodeMapEntry(entry: CodeMapEntry): number {
  const compact = `${entry.path}:${entry.symbol}(${entry.kind})${entry.public ? " public" : ""} calls=${entry.calls.join(",")}`;
  return Math.max(1, Math.ceil(compact.length / 4));
}

function compareCodeMapOmissions(a: PacketCodeMapOmission, b: PacketCodeMapOmission): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const path = compareStrings(a.path, b.path);
  if (path !== 0) return path;
  return compareStrings(a.symbol, b.symbol);
}

function collectCandidates(request: ContextRequest): PacketCandidate[] {
  const candidates: PacketCandidate[] = [];
  const occupiedKeys = new Set<string>();

  const take = (candidate: PacketCandidate): void => {
    if (occupiedKeys.has(candidate.key)) return;
    occupiedKeys.add(candidate.key);
    candidates.push(candidate);
  };

  for (const constraint of request.contract.constraints) {
    take({
      key: `constraint:${constraint.id}`,
      text: constraint.description,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined
    });
  }

  for (const grant of request.contract.authority) {
    const actions = grant.actions.length > 0 ? grant.actions.join(", ") : "no actions";
    const expires = grant.expiresAt !== undefined ? ` (expires ${grant.expiresAt})` : "";
    take({
      key: `authority:${grant.scope}`,
      text: `${grant.scope}: ${actions}${expires}`,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined
    });
  }

  for (const question of request.contract.questions) {
    const hasDefault = question.default !== undefined && question.default.trim() !== "";
    const options =
      question.options.length > 0 ? ` [options: ${question.options.join(" | ")}]` : "";
    const defaulted = hasDefault ? ` (default: ${question.default})` : "";
    take({
      key: `question:${question.id}`,
      text: `${question.question}${options}${defaulted}`,
      destination: "requiredFacts",
      rank: hasDefault ? RANK_DEFAULTED_QUESTION : RANK_MANDATORY,
      preOmit: undefined
    });
  }

  for (const route of request.index.validationRoutes) {
    take({
      key: `validation.route:${route}`,
      text: `validation route: ${route}`,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined
    });
  }

  for (const [index, output] of (request.dependencyOutputs ?? []).entries()) {
    take({
      key: `dependency:${index}:${output}`,
      text: `dependency output: ${output}`,
      destination: "requiredFacts",
      rank: RANK_MANDATORY,
      preOmit: undefined
    });
  }

  for (const fact of collapseFacts(request.index.facts)) {
    if (fact.key.startsWith("validation.route:")) {
      if (fact.trust === "unavailable" || fact.freshness === "unavailable") {
        take({
          key: fact.key,
          text: fact.value,
          destination: "requiredFacts",
          rank: RANK_MANDATORY,
          preOmit: "unavailable"
        });
      }
      continue;
    }
    take({
      key: `fact:${fact.key}`,
      text: `${fact.key}=${fact.value}`,
      destination: "requiredFacts",
      rank: RANK_INDEX_FACT,
      preOmit: fact.trust === "unavailable" || fact.freshness === "unavailable" ? "unavailable" : undefined
    });
  }

  for (const path of request.index.instructionPrecedence) {
    take({
      key: `file:instruction:${path}`,
      text: path,
      destination: "relevantFiles",
      rank: RANK_INSTRUCTION,
      preOmit: undefined
    });
  }

  for (const path of Object.keys(request.index.manifests).sort(compareStrings)) {
    take({
      key: `file:manifest:${path}`,
      text: path,
      destination: "relevantFiles",
      rank: RANK_MANIFEST,
      preOmit: undefined
    });
  }

  for (const test of request.index.tests) {
    take({
      key: `test:${test}`,
      text: test,
      destination: "requiredFacts",
      rank: RANK_TEST,
      preOmit: undefined
    });
  }

  for (const hint of request.index.generatedHints) {
    take({
      key: `generated:${hint}`,
      text: hint,
      destination: "relevantFiles",
      rank: RANK_GENERATED,
      preOmit: undefined
    });
  }

  for (const [index, risk] of request.index.risks.entries()) {
    take({
      key: `risk:${index}:${risk}`,
      text: risk,
      destination: "requiredFacts",
      rank: RANK_RISK,
      preOmit: undefined
    });
  }

  for (const path of request.index.dirtyUnrelated) {
    take({
      key: `dirty:${path}`,
      text: path,
      destination: "requiredFacts",
      rank: RANK_UNRELATED_DIRTY,
      preOmit: "unrelated-dirty"
    });
  }

  for (const ref of request.secretEvidenceRefs ?? []) {
    take({
      key: `secret:${ref}`,
      text: ref,
      destination: "requiredFacts",
      rank: RANK_SECRET,
      preOmit: "secret"
    });
  }

  return candidates.sort(compareCandidates);
}

function collapseFacts(facts: readonly ContextFact[]): ContextFact[] {
  const groups = new Map<string, ContextFact[]>();
  for (const fact of facts) {
    const group = groups.get(fact.key);
    if (group === undefined) {
      groups.set(fact.key, [fact]);
    } else {
      group.push(fact);
    }
  }

  const collapsed: ContextFact[] = [];
  const keys = [...groups.keys()].sort(compareStrings);
  for (const key of keys) {
    const group = groups.get(key);
    if (group === undefined) continue;
    const byValue = new Map<string, ContextFact[]>();
    for (const fact of group) {
      const same = byValue.get(fact.value);
      if (same === undefined) {
        byValue.set(fact.value, [fact]);
      } else {
        same.push(fact);
      }
    }
    const values = [...byValue.keys()].sort(compareStrings);
    if (values.length === 1) {
      const value = values[0];
      if (value === undefined) continue;
      const chosen = pickCanonical(byValue.get(value) ?? []);
      if (chosen !== undefined) collapsed.push(chosen);
      continue;
    }
    values.forEach((value, index) => {
      const chosen = pickCanonical(byValue.get(value) ?? []);
      if (chosen === undefined) return;
      collapsed.push({ ...chosen, key: `${key}#${index}` });
    });
  }
  return collapsed;
}

function pickCanonical(facts: readonly ContextFact[]): ContextFact | undefined {
  if (facts.length === 0) return undefined;
  return [...facts].sort((a, b) => {
    const trustDelta = trustRank(a.trust) - trustRank(b.trust);
    if (trustDelta !== 0) return trustDelta;
    const hashDelta = compareStrings(a.sourceHash, b.sourceHash);
    if (hashDelta !== 0) return hashDelta;
    return compareStrings(a.freshness, b.freshness);
  })[0];
}

function trustRank(trust: ContextFact["trust"]): number {
  if (trust === "HIGH") return 0;
  if (trust === "MEDIUM") return 1;
  if (trust === "LOW") return 2;
  return 3;
}

function contractDigest(contract: RequirementContract): string {
  const criterionIds = contract.acceptanceCriteria.map((criterion) => criterion.id).join("\0");
  return hash32(`${contract.objective}\0${criterionIds}`);
}

function summarizeOmissions(omissions: readonly OmissionRecord[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const omission of omissions) {
    counts.set(omission.reason, (counts.get(omission.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function compareCandidates(a: PacketCandidate, b: PacketCandidate): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return compareStrings(a.key, b.key);
}

function compareOmissions(a: OmissionRecord, b: OmissionRecord): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const keyDelta = compareStrings(a.key, b.key);
  if (keyDelta !== 0) return keyDelta;
  return compareStrings(a.reason, b.reason);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Compact grounding block for a child prompt. Secrets stay omitted. */
export function formatPacketForPrompt(packet: ContextPacket): string {
  const lines = ["Grounding (cite these; do not invent files or APIs):"];
  for (const fact of packet.requiredFacts) {
    lines.push(`- ${fact}`);
  }
  for (const file of packet.relevantFiles) {
    lines.push(`- file: ${file}`);
  }
  for (const entry of packet.codeMap.entries) {
    lines.push(`- ${entry.path}:${entry.symbol} (${entry.kind})`);
  }
  if (packet.omissions.length > 0) {
    const counts = packet.omittedSummary.map((row) => `${row.count} ${row.reason}`).join(", ");
    lines.push(`Omitted ${packet.omissions.length} items (${counts || "budget/secrets"}). Request more facts if needed.`);
  }
  if (lines.length === 1) {
    lines.push("- (no extra project facts in budget)");
  }
  return lines.join("\n");
}

const STOPWORDS = new Set([
  "what", "which", "where", "when", "does", "did", "the", "this", "that", "with",
  "from", "about", "into", "should", "could", "would", "there", "have", "has",
  "any", "are", "was", "were", "still", "open", "know", "need", "want", "run"
]);

/**
 * M3-T5: answer downstream questions from the packet and artifact refs alone,
 * without loading the parent transcript. Returns grounding lines (required
 * facts, relevant files, code-map entries) that match the question, best
 * match first. Deterministic.
 */
export function queryPacketGrounding(packet: ContextPacket, question: string): readonly string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  const lines: readonly string[] = [
    ...packet.requiredFacts,
    ...packet.relevantFiles.map((file) => `file: ${file}`),
    ...packet.codeMap.entries.map((entry) => `${entry.path}:${entry.symbol} (${entry.kind})`)
  ];
  const scored = lines.map((line) => {
    const lower = line.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lower.includes(token) || token.includes(lower)) score += 1;
    }
    return { line, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return compareStrings(a.line, b.line);
    })
    .map((item) => item.line);
}
