import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DomainValidationError } from "../domain/errors.js";

export interface IsolatedWorktree {
  /** Absolute path of the isolated worktree checkout (mutable target). */
  readonly cwd: string;
  /** Absolute path of the sandbox that owns this worktree (for dispose). */
  readonly sandboxRoot: string;
  /** Absolute path of the source repo the worktree was added from. */
  readonly sourceRepo: string;
  /** Worktree branch/ref name used at create time. */
  readonly ref: string;
}

export interface CreateIsolatedWorktreeInput {
  /** Existing git repository to snapshot from (read; not mutated as the edit target). */
  readonly sourceRepo: string;
  /**
   * Directory under which the worktree is created. When omitted a fresh temp
   * directory is allocated. Never the caller's main checkout.
   */
  readonly sandboxRoot?: string;
  /** Optional branch/commit to check out (default: HEAD of sourceRepo). */
  readonly ref?: string;
  /** Optional leaf directory name inside the sandbox. */
  readonly name?: string;
}

function runGit(cwd: string, args: readonly string[]): { ok: true; stdout: string } | { ok: false; detail: string } {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error !== undefined) {
    return { ok: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`).trim();
    return { ok: false, detail };
  }
  return { ok: true, stdout: result.stdout };
}

function assertGitWorkTree(repo: string): void {
  const check = runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
  if (!check.ok || check.stdout.trim() !== "true") {
    throw new DomainValidationError(
      `sourceRepo is not a git work tree: ${repo}${check.ok ? "" : ` (${check.detail})`}`
    );
  }
}

/**
 * Create an isolated `git worktree` under a sandbox directory. Edits happen
 * only inside the returned `cwd`; the caller's main checkout is never the
 * mutable target.
 */
export async function createIsolatedWorktree(
  input: CreateIsolatedWorktreeInput
): Promise<IsolatedWorktree> {
  const sourceRepo = path.resolve(input.sourceRepo);
  assertGitWorkTree(sourceRepo);

  const sandboxRoot =
    input.sandboxRoot !== undefined
      ? path.resolve(input.sandboxRoot)
      : await mkdtemp(path.join(tmpdir(), "sparkle-wt-sandbox-"));
  const leaf = input.name ?? `wt-${process.pid}-${Date.now().toString(36)}`;
  const cwd = path.join(sandboxRoot, leaf);
  const ref = input.ref ?? "HEAD";

  // Detached worktree at the resolved commit so we never create a shared branch
  // that could race with the caller's main checkout.
  const rev = runGit(sourceRepo, ["rev-parse", ref]);
  if (!rev.ok) {
    throw new DomainValidationError(`cannot resolve ref ${ref}: ${rev.detail}`);
  }
  const sha = rev.stdout.trim();
  const add = runGit(sourceRepo, ["worktree", "add", "--detach", cwd, sha]);
  if (!add.ok) {
    throw new DomainValidationError(`git worktree add failed: ${add.detail}`);
  }

  return { cwd, sandboxRoot, sourceRepo, ref: sha };
}

/** Remove the isolated worktree and prune it from the source repo. */
export async function disposeIsolatedWorktree(worktree: IsolatedWorktree): Promise<void> {
  const remove = runGit(worktree.sourceRepo, ["worktree", "remove", "--force", worktree.cwd]);
  if (!remove.ok) {
    // Best-effort: directory may already be gone; still prune the registry.
    await rm(worktree.cwd, { recursive: true, force: true }).catch(() => undefined);
    runGit(worktree.sourceRepo, ["worktree", "prune"]);
  }
}

/** Current HEAD revision (commit SHA) of a worktree cwd. */
export function readWorktreeRevision(cwd: string): string {
  const result = runGit(cwd, ["rev-parse", "HEAD"]);
  if (!result.ok) {
    throw new DomainValidationError(`cannot read worktree revision: ${result.detail}`);
  }
  return result.stdout.trim();
}

/** Content-addressed tree hash for the current index+worktree state when HEAD is stale. */
export function readWorktreeTreeHash(cwd: string): string {
  // Write a tree from the index so uncommitted edits still bind a fingerprint.
  // Callers that need dirty-tree binding should `git add -A` first via tools.
  const result = runGit(cwd, ["write-tree"]);
  if (!result.ok) {
    throw new DomainValidationError(`cannot read worktree tree hash: ${result.detail}`);
  }
  return result.stdout.trim();
}
