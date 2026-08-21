import { DomainValidationError } from "../domain/errors.js";
import type { ResourceVersionId } from "../domain/ids.js";
import type { ResourceIdentity, ResourceVersion } from "./resource.js";

/** Stable map key for a resource identity (kind + name + scope). */
export function resourceIdentityKey(identity: ResourceIdentity): string {
  const scopeKey =
    identity.scope.kind === "project"
      ? `project:${identity.scope.projectId}`
      : "user-global";
  return `${identity.kind}|${identity.name}|${scopeKey}`;
}

export function assertExpectedActive(
  actual: ResourceVersion | undefined,
  expectedCurrentVersionId: ResourceVersionId
): void {
  if (actual === undefined) {
    throw new DomainValidationError(
      `unknown expected version: ${String(expectedCurrentVersionId)}`
    );
  }
  if (actual.versionId !== expectedCurrentVersionId) {
    throw new DomainValidationError(
      `CAS failed: active version ${actual.versionId} does not match expected ${expectedCurrentVersionId}`
    );
  }
}

/**
 * Compare-and-swap the active pointer. Fails closed on a missing or stale
 * expected version; does not create versions.
 */
export function casActivePointer(
  activeByKey: Map<string, ResourceVersionId>,
  identity: ResourceIdentity,
  expectedCurrentVersionId: ResourceVersionId,
  nextVersionId: ResourceVersionId
): void {
  const key = resourceIdentityKey(identity);
  const current = activeByKey.get(key);
  if (current === undefined) {
    throw new DomainValidationError(
      `unknown expected version: ${String(expectedCurrentVersionId)}`
    );
  }
  if (current !== expectedCurrentVersionId) {
    throw new DomainValidationError(
      `CAS failed: active version ${current} does not match expected ${expectedCurrentVersionId}`
    );
  }
  activeByKey.set(key, nextVersionId);
}
