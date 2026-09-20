import { lstatSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";

/** True when `target` equals `root` or lives strictly inside it after resolve. */
export function isPathInside(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function lstatOrNone(p: string): Stats | undefined {
  try {
    return lstatSync(p);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

function assertNoSymlinkEscape(candidate: string, resolvedRoot: string): void {
  // lstat does not follow links. existsSync-before-lstat misses dangling
  // symlinks because existsSync follows the target and reports false.
  let cur = candidate;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const st = lstatOrNone(cur);
    if (st?.isSymbolicLink()) {
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
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
    if (cur === resolvedRoot || !isPathInside(cur, resolvedRoot)) break;
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
