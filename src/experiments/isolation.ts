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

function normalize(path: string): string {
  return path.replace(/\/+$/, "");
}

/** True when `path` equals `root` or lives strictly inside it. */
function isInside(path: string, root: string): boolean {
  const p = normalize(path);
  const r = normalize(root);
  return p === r || p.startsWith(`${r}/`);
}

export function createIsolationGuard(input: Omit<IsolationGuard, never>): IsolationGuard {
  const guard: IsolationGuard = input;
  const output = normalize(guard.outputRoot);
  if (output === "") {
    throw new DomainValidationError("outputRoot is required");
  }
  for (const root of guard.readOnlyRoots) {
    const r = normalize(root);
    if (r === "") {
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
export function assertWritablePath(guard: IsolationGuard, path: string): void {
  for (const root of guard.readOnlyRoots) {
    if (isInside(path, root)) {
      throw new DomainValidationError(`read-only isolation violation: ${path} is inside ${root}`);
    }
  }
  if (!isInside(path, guard.outputRoot)) {
    throw new DomainValidationError(
      `evaluation artifact ${path} must live inside the isolated output root ${guard.outputRoot}`
    );
  }
}
