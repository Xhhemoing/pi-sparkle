import { DomainValidationError } from "../domain/errors.js";
import type { ResourceKind } from "./resource.js";
import { NON_AUTO_PROMOTABLE_KINDS, RESOURCE_KINDS, isNonAutoPromotableKind } from "./resource.js";

const PROFILE_ID_PATTERN = /^apr_[A-Za-z0-9_-]{1,64}$/;

export interface ApprovalProfile {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly defaultMode: "proposal-first";
  /** Low-risk classes the user opted in. Must not include permission|security|credential. */
  readonly autoPromoteClasses: readonly ResourceKind[];
  readonly neverAutoPromote: readonly ResourceKind[];
  readonly budget: { readonly maxAutoPromotions: number };
}

export function createDefaultApprovalProfile(): ApprovalProfile {
  return {
    profileId: "apr_default",
    profileVersion: 1,
    defaultMode: "proposal-first",
    autoPromoteClasses: [],
    neverAutoPromote: [...NON_AUTO_PROMOTABLE_KINDS],
    budget: { maxAutoPromotions: 0 }
  };
}

/**
 * Profile used after the package/skill is installed. Live runs still cannot
 * rewrite policy. Auto-loop may collect and propose only; CAS promotion stays
 * explicit. Permission/security/credential stay forbidden.
 */
export function createInstalledAutoAdaptProfile(): ApprovalProfile {
  return {
    profileId: "apr_plugin-auto",
    profileVersion: 1,
    defaultMode: "proposal-first",
    autoPromoteClasses: [],
    neverAutoPromote: [...NON_AUTO_PROMOTABLE_KINDS],
    budget: { maxAutoPromotions: 0 }
  };
}

/** Collect + propose kill switch. `0` / `false` / `off` still collects; auto-loop never CAS-promotes. */
export function isAutoAdaptEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.SPARKLE_AUTO_ADAPT;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function validateApprovalProfile(profile: ApprovalProfile): void {
  if (!PROFILE_ID_PATTERN.test(profile.profileId)) {
    throw new DomainValidationError(
      `invalid approval profile id: ${profile.profileId} (expected apr_<suffix>)`
    );
  }
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 1) {
    throw new DomainValidationError("approval profile version must be a positive integer");
  }
  if (profile.defaultMode !== "proposal-first") {
    throw new DomainValidationError("approval profile defaultMode must be proposal-first");
  }
  if (!Number.isInteger(profile.budget.maxAutoPromotions) || profile.budget.maxAutoPromotions < 0) {
    throw new DomainValidationError("approval profile budget.maxAutoPromotions must be an integer >= 0");
  }
  for (const kind of profile.autoPromoteClasses) {
    if (!RESOURCE_KINDS.includes(kind)) {
      throw new DomainValidationError(`invalid autoPromote class: ${String(kind)}`);
    }
    if (isNonAutoPromotableKind(kind)) {
      throw new DomainValidationError(
        `${kind} can never auto-promote and must not appear in autoPromoteClasses`
      );
    }
  }
  for (const kind of profile.neverAutoPromote) {
    if (!RESOURCE_KINDS.includes(kind)) {
      throw new DomainValidationError(`invalid neverAutoPromote class: ${String(kind)}`);
    }
  }
  for (const required of NON_AUTO_PROMOTABLE_KINDS) {
    if (!profile.neverAutoPromote.includes(required)) {
      throw new DomainValidationError(
        `neverAutoPromote must include ${required}`
      );
    }
  }
  for (const kind of profile.autoPromoteClasses) {
    if (profile.neverAutoPromote.includes(kind)) {
      throw new DomainValidationError(
        `${kind} cannot be both auto-promotable and never-auto-promote`
      );
    }
  }
}

/**
 * True only when the user opted this kind into auto-promote, the kind is not
 * in the never-auto set, and the bounded budget still has room. Default
 * proposal-first profiles with an empty class list never auto-promote.
 */
export function canAutoPromote(
  profile: ApprovalProfile,
  kind: ResourceKind,
  autoPromotionsUsed: number
): boolean {
  if (isNonAutoPromotableKind(kind)) {
    return false;
  }
  if (profile.neverAutoPromote.includes(kind)) {
    return false;
  }
  if (profile.defaultMode !== "proposal-first") {
    return false;
  }
  if (profile.autoPromoteClasses.length === 0) {
    return false;
  }
  if (!profile.autoPromoteClasses.includes(kind)) {
    return false;
  }
  if (!Number.isInteger(profile.budget.maxAutoPromotions) || profile.budget.maxAutoPromotions < 0) {
    return false;
  }
  if (!Number.isInteger(autoPromotionsUsed) || autoPromotionsUsed < 0) {
    return false;
  }
  if (autoPromotionsUsed >= profile.budget.maxAutoPromotions) {
    return false;
  }
  return true;
}
