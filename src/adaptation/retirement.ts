import type { ResourceVersionId } from "../domain/ids.js";
import type { ResourceRegistry } from "./registry.js";
import type { ResourceVersion } from "./resource.js";

/**
 * Retire a resource version so it cannot receive new assignments.
 * The version remains gettable for reproduction. Retiring the current
 * active version is rejected. Already-retired versions succeed idempotently.
 */
export function retireVersion(
  registry: ResourceRegistry,
  versionId: ResourceVersionId
): ResourceVersion {
  return registry.retire(versionId);
}

/** Fail closed when a version is unknown or retired and must not be assigned. */
export function assertAssignable(registry: ResourceRegistry, versionId: ResourceVersionId): void {
  registry.assertAssignable(versionId);
}

export function isRetired(registry: ResourceRegistry, versionId: ResourceVersionId): boolean {
  return registry.isRetired(versionId);
}
