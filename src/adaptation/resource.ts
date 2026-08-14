import type { ProjectId } from "../domain/ids.js";
import type { IsoTimestamp } from "../domain/timestamp.js";
import type { ResourceVersionId } from "../domain/ids.js";

/**
 * The bounded "what" axis of self-optimization: only these resource kinds are
 * representable as improvement candidates. Permission, security, and
 * credential targets exist so the registry can classify them — they can
 * never auto-promote.
 */
export type ResourceKind =
  | "prompt"
  | "routing-policy"
  | "rubric"
  | "skill"
  | "example"
  | "memory"
  | "workflow-template"
  | "permission"
  | "security"
  | "credential";

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  "prompt",
  "routing-policy",
  "rubric",
  "skill",
  "example",
  "memory",
  "workflow-template",
  "permission",
  "security",
  "credential",
];

/** These resource kinds are classified non-auto-promotable, always. */
export const NON_AUTO_PROMOTABLE_KINDS: readonly ResourceKind[] = [
  "permission",
  "security",
  "credential",
];

export function isNonAutoPromotableKind(kind: ResourceKind): boolean {
  return NON_AUTO_PROMOTABLE_KINDS.includes(kind);
}

export type ResourceScope =
  | { readonly kind: "project"; readonly projectId: ProjectId }
  | { readonly kind: "user-global" };

export function scopeEquals(a: ResourceScope, b: ResourceScope): boolean {
  if (a.kind === "user-global" && b.kind === "user-global") {
    return true;
  }
  return a.kind === "project" && b.kind === "project" && a.projectId === b.projectId;
}

export interface AuthorIdentity {
  readonly kind: "human" | "model" | "detector";
  readonly identity: string;
}

export interface ResourceIdentity {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly scope: ResourceScope;
}

export function identityEquals(a: ResourceIdentity, b: ResourceIdentity): boolean {
  return a.kind === b.kind && a.name === b.name && scopeEquals(a.scope, b.scope);
}

/** Immutable version of one resource. The baseline has no parent. */
export interface ResourceVersion {
  readonly versionId: ResourceVersionId;
  readonly identity: ResourceIdentity;
  /** hash32 over the content — the content itself is never stored by the registry. */
  readonly contentHash: string;
  readonly author: AuthorIdentity;
  readonly parentVersionId: ResourceVersionId | undefined;
  readonly createdAt: IsoTimestamp;
}
