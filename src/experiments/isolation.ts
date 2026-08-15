import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";

/**
 * M6-T2 isolation guard: original project state, event logs, and active
 * resources are read-only during evaluation. Every write target must live
 * inside the isolated output root — evaluation artifacts may never touch the
 * source of truth or spill elsewhere.
 */

export interface IsolationGuard {
  /** Original workspaces, event logs, and active-resource roots — read-only. */
  readonly readOnlyRoots: readonly string[];
  /** The only root evaluation artifacts may be written to. */
  readonly outputRoot: string;
}

function resolvePath(value: string): string {
  return path.resolve(value);
}

/** True when `target` equals `root` or lives strictly inside it after resolve. */
function isInside(target: string, root: string): boolean {
  const resolvedTarget = resolvePath(target);
  const resolvedRoot = resolvePath(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function createIsolationGuard(input: Omit<IsolationGuard, never>): IsolationGuard {
  const guard: IsolationGuard = input;
  if (guard.outputRoot.trim() === "") {
    throw new DomainValidationError("outputRoot is required");
  }
  for (const root of guard.readOnlyRoots) {
    if (root.trim() === "") {
      throw new DomainValidationError("read-only roots must not be empty");
    }
    if (isInside(guard.outputRoot, root)) {
      throw new DomainValidationError(
        `output root ${guard.outputRoot} overlaps read-only root ${root}`
      );
    }
    if (isInside(root, guard.outputRoot)) {
      throw new DomainValidationError(
        `read-only root ${root} overlaps output root ${guard.outputRoot}`
      );
    }
  }
  return guard;
}

/**
 * Fail closed when a write would touch the read-only source of truth or land
 * outside the isolated output root.
 */
export function assertWritablePath(guard: IsolationGuard, target: string): void {
  for (const root of guard.readOnlyRoots) {
    if (isInside(target, root)) {
      throw new DomainValidationError(`read-only isolation violation: ${target} is inside ${root}`);
    }
  }
  if (!isInside(target, guard.outputRoot)) {
    throw new DomainValidationError(
      `evaluation artifact ${target} must live inside the isolated output root ${guard.outputRoot}`
    );
  }
}
