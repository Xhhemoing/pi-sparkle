import type { RequirementContract, SourceRef } from "../domain/contract.js";
import { validateRequirementContract } from "../domain/contract.js";

export type SourceOrigin =
  | "user-turn"
  | "approved-spec"
  | "approved-plan"
  | "approved-adr"
  | "repository-fact"
  | "code"
  | "log"
  | "quoted-web"
  | "tool-output";

export type SourceAuthority = "user" | "approved-project" | "repository" | "untrusted-data";

const TRUSTED_SOURCE = Symbol("pi-sparkle.trusted-source");

export interface RawSource {
  kind: SourceRef["kind"];
  ref: string;
  content: string;
  origin?: SourceOrigin;
  readonly [TRUSTED_SOURCE]?: true;
}

export function createTrustedSource(source: Omit<RawSource, typeof TRUSTED_SOURCE>): RawSource {
  return Object.freeze({ ...source, [TRUSTED_SOURCE]: true as const });
}

export interface NormalizedSource {
  ref: SourceRef;
  text: string;
  signals: string[];
  origin: SourceOrigin;
  authority: SourceAuthority;
  canGrantAuthority: boolean;
}

export function normalizeSources(sources: RawSource[]): NormalizedSource[] {
  return sources.map((source) => {
    const origin = source.origin ?? defaultOrigin(source.kind);
    assertOriginMatchesKind(source.kind, origin);
    const trusted = source[TRUSTED_SOURCE] === true;
    const authority = trusted ? authorityFor(origin) : "untrusted-data";
    return {
      ref: { kind: source.kind, ref: source.ref, excerpt: source.content.slice(0, 200) },
      text: source.content,
      signals: extractSignals(source.content),
      origin,
      authority,
      canGrantAuthority: authority === "user" || authority === "approved-project"
    };
  });
}

function assertOriginMatchesKind(kind: SourceRef["kind"], origin: SourceOrigin): void {
  if (origin === "user-turn" && kind !== "message") {
    throw new Error(`source origin user-turn is not valid for ${kind}`);
  }
  if (
    (origin === "approved-spec" || origin === "approved-plan" || origin === "approved-adr") &&
    kind !== "spec"
  ) {
    throw new Error(`source origin ${origin} is not valid for ${kind}`);
  }
}

function defaultOrigin(kind: SourceRef["kind"]): SourceOrigin {
  if (kind === "message") return "user-turn";
  if (kind === "spec") return "approved-spec";
  return "repository-fact";
}

function authorityFor(origin: SourceOrigin): SourceAuthority {
  if (origin === "user-turn") return "user";
  if (origin === "approved-spec" || origin === "approved-plan" || origin === "approved-adr") {
    return "approved-project";
  }
  if (origin === "repository-fact") return "repository";
  return "untrusted-data";
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
