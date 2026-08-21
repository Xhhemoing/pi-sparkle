import { DomainValidationError } from "../domain/errors.js";
import {
  validateRequirementContract,
  type RequirementContract
} from "../domain/contract.js";
import type { ContractCritique } from "./critic.js";
import {
  normalizeSources,
  type NormalizedSource,
  type RawSource
} from "./normalizer.js";

export interface LatentRequirement {
  readonly statement: string;
  readonly corroboratedSourceRefs: readonly string[];
  readonly confidence: number;
}

export interface LabeledInference extends LatentRequirement {
  readonly status: "corroborated" | "needs-confirmation";
}

export interface AuthorityGrounding {
  readonly authorityIndex: number;
  readonly sourceRefs: readonly string[];
}

export interface ExtractionResult {
  readonly contract: RequirementContract;
  readonly confidence: number;
  readonly inferences: readonly LatentRequirement[];
  readonly authorityGrounding: readonly AuthorityGrounding[];
}

export interface RequirementExtractor {
  readonly roleId: string;
  extract(input: {
    readonly objective: string;
    readonly sources: readonly NormalizedSource[];
  }): Promise<ExtractionResult>;
}

export interface ContractCritic {
  readonly roleId: string;
  critique(input: {
    readonly contract: RequirementContract;
    readonly sources: readonly NormalizedSource[];
  }): Promise<ContractCritique>;
}

export interface ContractCandidate {
  readonly contract: RequirementContract;
  readonly critique: ContractCritique;
  readonly extractorRoleId: string;
  readonly criticRoleId: string;
  readonly confidence: number;
  readonly inferences: readonly LabeledInference[];
  readonly requiresUserDecision: boolean;
}

export async function buildContractCandidate(input: {
  readonly objective: string;
  readonly sources: readonly RawSource[];
  readonly extractor: RequirementExtractor;
  readonly critic: ContractCritic;
  readonly minimumConfidence?: number;
}): Promise<ContractCandidate> {
  if (input.extractor.roleId.trim() === "" || input.critic.roleId.trim() === "") {
    throw new DomainValidationError("extractor and critic role ids are required");
  }
  if (input.extractor.roleId === input.critic.roleId) {
    throw new DomainValidationError("extractor and critic must use independently versioned roles");
  }

  const sources = normalizeSources([...input.sources]);
  const extracted = await input.extractor.extract({ objective: input.objective, sources });
  validateConfidence(extracted.confidence, "extraction confidence");
  const minimumConfidence = input.minimumConfidence ?? 0.8;
  validateConfidence(minimumConfidence, "minimum confidence");
  const contract = validateRequirementContract(extracted.contract);
  assertAuthorityGrounding(contract, extracted.authorityGrounding, sources);
  const critique = await input.critic.critique({ contract, sources });
  const sourceRefs = new Set(sources.map((source) => source.ref.ref));
  const inferences = extracted.inferences.map((inference): LabeledInference => {
    validateConfidence(inference.confidence, "inference confidence");
    const corroborated =
      inference.corroboratedSourceRefs.length > 0 &&
      inference.corroboratedSourceRefs.every((ref) => sourceRefs.has(ref));
    return {
      ...inference,
      status: corroborated ? "corroborated" : "needs-confirmation"
    };
  });
  const requiresUserDecision =
    extracted.confidence < minimumConfidence ||
    inferences.some((inference) => inference.status === "needs-confirmation") ||
    critique.contradictions.length > 0 ||
    critique.omissions.length > 0;

  return {
    contract,
    critique,
    extractorRoleId: input.extractor.roleId,
    criticRoleId: input.critic.roleId,
    confidence: extracted.confidence,
    inferences,
    requiresUserDecision
  };
}

function validateConfidence(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainValidationError(`${label} must be between 0 and 1`);
  }
}

function assertAuthorityGrounding(
  contract: RequirementContract,
  grounding: readonly AuthorityGrounding[],
  sources: readonly NormalizedSource[]
): void {
  const sourcesByRef = new Map(sources.map((source) => [source.ref.ref, source]));
  for (let authorityIndex = 0; authorityIndex < contract.authority.length; authorityIndex += 1) {
    const entry = grounding.find((item) => item.authorityIndex === authorityIndex);
    const trusted = entry?.sourceRefs.some((ref) => sourcesByRef.get(ref)?.canGrantAuthority === true) ?? false;
    if (!trusted) {
      throw new DomainValidationError(
        `authority grant ${authorityIndex} requires a user or approved-project source`
      );
    }
  }
}
