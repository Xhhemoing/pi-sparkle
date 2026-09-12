import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";

/** True when `target` equals `root` or lives strictly inside it after resolve. */
export function isPathInside(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a caller-supplied path against `root` and refuse escape (absolute
 * outside root, `..` climb, symlink-style absolute segments). Permissions live
 * in tool code, not prompts.
 */
export function resolveInsideRoot(root: string, relativeOrAbsolute: string): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? path.resolve(relativeOrAbsolute)
    : path.resolve(resolvedRoot, relativeOrAbsolute);
  if (!isPathInside(candidate, resolvedRoot)) {
    throw new DomainValidationError(
      `path escape refused: ${relativeOrAbsolute} is outside worktree root ${resolvedRoot}`
    );
  }
  return candidate;
}
