import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";

/** True when `target` equals `root` or lives strictly inside it after resolve. */
export function isPathInside(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlinkEscape(candidate: string, resolvedRoot: string): void {
  // Walk every prefix; refuse if any existing component is a symlink whose
  // real path escapes the worktree root (covers parent-dir junction tricks).
  let cur = candidate;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    if (existsSync(cur)) {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) {
        let real: string;
        try {
          real = realpathSync(cur);
        } catch {
          throw new DomainValidationError(`path escape refused: broken symlink at ${cur}`);
        }
        if (!isPathInside(real, resolvedRoot)) {
          throw new DomainValidationError(
            `path escape refused: symlink at ${cur} resolves outside worktree root ${resolvedRoot}`
          );
        }
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
    // Stop once we reach the root boundary
    if (cur === resolvedRoot || !isPathInside(cur, resolvedRoot)) break;
  }

  // If the final path exists, also require realpath stays inside.
  if (existsSync(candidate)) {
    try {
      const real = realpathSync(candidate);
      if (!isPathInside(real, resolvedRoot)) {
        throw new DomainValidationError(
          `path escape refused: realpath outside worktree root ${resolvedRoot}`
        );
      }
    } catch (err) {
      if (err instanceof DomainValidationError) throw err;
      // dangling / race: lexical check already passed
    }
  }
}

/**
 * Resolve a caller-supplied path against `root` and refuse escape (absolute
 * outside root, `..` climb, and symlink/junction targets outside root).
 * Lexical checks alone are not enough; this also inspects link components.
 * Residual TOCTOU: a link can still be swapped after this check returns.
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
  assertNoSymlinkEscape(candidate, resolvedRoot);
  return candidate;
}
