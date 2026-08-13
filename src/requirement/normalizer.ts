import type { RequirementContract, SourceRef } from "../domain/contract.js";
import { validateRequirementContract } from "../domain/contract.js";

export interface RawSource {
  kind: SourceRef["kind"];
  ref: string;
  content: string;
}

export interface NormalizedSource {
  ref: SourceRef;
  text: string;
  signals: string[];
}

export function normalizeSources(sources: RawSource[]): NormalizedSource[] {
  return sources.map((s) => ({
    ref: { kind: s.kind, ref: s.ref, excerpt: s.content.slice(0, 200) },
    text: s.content,
    signals: extractSignals(s.content)
  }));
}

function extractSignals(text: string): string[] {
  const signals: string[] = [];
  if (/must|shall|required/i.test(text)) signals.push("requirement");
  if (/not|never|avoid/i.test(text)) signals.push("constraint");
  if (/accept|pass|verify|test/i.test(text)) signals.push("acceptance");
  return signals;
}

export function buildContractFromSources(objective: string, sources: RawSource[]): RequirementContract {
  const normalized = normalizeSources(sources);
  const acceptanceCriteria = normalized
    .filter((n) => n.signals.includes("acceptance"))
    .map((n, i) => ({
      id: `acc-${i + 1}`,
      description: n.text.slice(0, 120),
      observableCheck: "manual-or-test"
    }));

  const contract = {
    schemaVersion: 1 as const,
    objective,
    deliverables: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria,
    assumptions: [],
    questions: [],
    authority: [],
    sourceRefs: normalized.map((n) => n.ref)
  };
  return validateRequirementContract(contract);
}
