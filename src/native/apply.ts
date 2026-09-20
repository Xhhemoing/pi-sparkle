import { spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { runIndependentCheck } from "../execution/independent-check.js";
import type { NativeWriteSessionResult } from "./write-session.js";
import {
  prepareNativeWrite,
  type NativeWritePreflight,
  type NativeWriteVerificationInput
} from "./write-preflight.js";

/**
 * Candidate application for the retained isolated-write slice.
 *
 * Application is an explicit, separate step: only an independently accepted
 * candidate may be applied, only to a clean source at exactly the candidate's
 * source revision, and the source update is fast-forward-shaped. Disposal is a
 * separate caller decision. This module never touches credentials, permissions,
 * or trust/tool-activation state, and never deletes run artifacts.
 */

export interface NativeApplyInput {
  readonly sourceRepo: string;
  /** The retained result previously returned by `NativeWriteSession.execute`. */
  readonly result: NativeWriteSessionResult;
  readonly signal?: AbortSignal;
}

export interface NativeApplyResult {
  readonly status: "APPLIED";
  readonly appliedRevision: string;
  readonly sourceRevision: string;
  readonly candidatePath: string;
  /** True when the re-verification ran inside the candidate before apply. */
  readonly reverified: boolean;
  readonly retainedCandidate: true;
}

export interface NativeDisposeResult {
  readonly status: "DISPOSED";
  readonly candidatePath: string;
}

function fail(message: string): never {
  throw new DomainValidationError(message);
}

interface GitOk { ok: true; stdout: string }
interface GitErr { ok: false; detail: string }
type GitResult = GitOk | GitErr;

function git(cwd: string, args: readonly string[]): GitResult {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.error !== undefined) return { ok: false, detail: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      detail: (result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`).trim()
    };
  }
  return { ok: true, stdout: result.stdout };
}

function gitOrThrow(cwd: string, args: readonly string[]): string {
  const result = git(cwd, args);
  if (!result.ok) fail(`git ${args[0]} failed: ${result.detail}`);
  return result.stdout.trim();
}

function isAcceptedWriteResult(result: NativeWriteSessionResult): boolean {
  return (
    result !== null &&
    typeof result === "object" &&
    typeof result.candidatePath === "string" &&
    result.candidatePath.trim() !== "" &&
    typeof result.sourceRevision === "string" &&
    /^[0-9a-f]{40}$/.test(result.sourceRevision) &&
    result.acceptance !== null &&
    typeof result.acceptance === "object" &&
    result.acceptance.accepted === true
  );
}

/**
 * Re-run the host verification command inside the candidate worktree before
 * the source is touched. The command/argv come from the acceptance record that
 * the write session froze from trusted host input, not from any model text.
 */
function reverifyCandidate(verification: { command: string; args: readonly string[] }, candidatePath: string): void {
  // Validate the trusted host command shape, then run the real check inside
  // the candidate. This executes candidate code; host policy applies.
  prepareVerification(verification);
  const check = runIndependentCheck({ cwd: candidatePath, command: verification.command, args: [...verification.args] });
  if (!check.ok) {
    fail(`candidate re-verification failed before apply (exitCode=${check.exitCode})`);
  }
}

function prepareVerification(input: NativeWriteVerificationInput): { command: string; args: readonly string[] } {
  if (input === null || typeof input !== "object") fail("verification is required");
  if (typeof input.command !== "string" || input.command.trim() === "") fail("verification command is required");
  const args = input.args === undefined ? [] : input.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) fail("verification args must be strings");
  return { command: input.command, args: [...args] };
}

export class NativeApplySession {
  private readonly managed = new Set<string>();
  private closed = false;

  get managedCount(): number {
    return this.managed.size;
  }

  /**
   * Apply one retained accepted candidate to its source repository. The source
   * must be clean and exactly at the candidate's source revision; the candidate
   * is re-verified in place before any source mutation. On refusal nothing is
   * changed; on mid-apply failure the source is rolled back to its prior
   * revision and the candidate is retained.
   */
  async apply(input: NativeApplyInput): Promise<NativeApplyResult> {
    if (this.closed) fail("native apply session is shut down");
    if (input === null || typeof input !== "object") fail("input is required");
    if (input.signal?.aborted) fail("apply aborted before any work");

    const result = input.result;
    if (!isAcceptedWriteResult(result)) fail("candidate result is not accepted; refused");
    // Reuse the write preflight for source cleanliness validation. The
    // verification snapshot comes from the accepted acceptance record (trusted
    // host input frozen at write time), never from model text.
    const preflight: NativeWritePreflight = prepareNativeWrite({
      sourceRepo: input.sourceRepo,
      objective: "candidate application",
      verification: {
        command: result.acceptance.command,
        args: result.acceptance.args
      },
      ...(input.signal !== undefined ? { signal: input.signal } : {})
    });
    if (result.sourceRevision !== preflight.revision) {
      fail(`stale target: source is at ${preflight.revision}, candidate was built from ${result.sourceRevision}`);
    }

    const candidate = path.resolve(result.candidatePath);
    const candidateStat = await stat(candidate).catch(() => undefined);
    if (candidateStat === undefined) fail("candidate worktree is missing; cannot apply");

    // The candidate must be a git worktree linked to this source repo.
    const candidateHead = git(candidate, ["rev-parse", "HEAD"]);
    if (!candidateHead.ok) fail(`candidate is not a usable git worktree: ${candidateHead.detail}`);

    // Re-verify inside the candidate with the frozen host command before the
    // source is mutated. This executes candidate code; host policy applies.
    reverifyCandidate(preflight.verification, candidate);

    // Bind the candidate's exact working-tree content: stage everything inside
    // the candidate worktree (never the source), then write its tree object.
    // The source checkout's index is never touched by this.
    const stage = git(candidate, ["add", "-A"]);
    if (!stage.ok) fail(`candidate staging failed: ${stage.detail}`);
    const candidateTree = gitOrThrow(candidate, ["write-tree"]);

    // Fast-forward-shaped apply only. No merge commits, no rebase.
    const candidateCommit = this.commitCandidateTree(candidate, candidateTree, preflight);

    const isAncestor = this.isAncestorOf(preflight.sourceRepo, preflight.revision, candidateCommit);
    if (!isAncestor) {
      fail("candidate is not a descendant of the source revision; refusing non-fast-forward apply");
    }

    const previous = preflight.revision;
    // `merge --ff-only` moves the branch/HEAD and updates the working tree in
    // one git-native fast-forward; it refuses without touching anything when
    // the update would not be a fast-forward.
    const applied = git(preflight.sourceRepo, ["merge", "--ff-only", candidateCommit]);
    if (!applied.ok) {
      // The ref update may still have landed when the merge reports failure
      // (e.g. a reference-transaction hook moved HEAD mid-apply). A failed
      // apply must never leave the source elsewhere: roll back to the prior
      // revision before refusing. When nothing was touched this is a no-op.
      const rollback = git(preflight.sourceRepo, ["reset", "--hard", previous]);
      if (!rollback.ok) {
        fail(`source fast-forward failed AND rollback failed: merge=${applied.detail} rollback=${rollback.detail}`);
      }
      const headAfter = git(preflight.sourceRepo, ["rev-parse", "HEAD"]);
      if (!headAfter.ok || headAfter.stdout.trim() !== previous) {
        fail(`source fast-forward failed; rolled back but HEAD verification failed: ${applied.detail}`);
      }
      fail(`source fast-forward failed; rolled back to ${previous}: ${applied.detail}`);
    }
    const headNow = git(preflight.sourceRepo, ["rev-parse", "HEAD"]);
    if (!headNow.ok || headNow.stdout.trim() !== candidateCommit) {
      const rollback = git(preflight.sourceRepo, ["reset", "--hard", previous]);
      if (!rollback.ok) {
        fail(`source did not reach the candidate commit AND rollback failed: ${rollback.detail}`);
      }
      fail(`source did not reach the candidate commit; rolled back to ${previous}`);
    }

    this.managed.add(candidate);
    return {
      status: "APPLIED",
      appliedRevision: candidateCommit,
      sourceRevision: previous,
      candidatePath: candidate,
      reverified: true,
      retainedCandidate: true
    };
  }

  private commitCandidateTree(candidate: string, candidateTree: string, preflight: NativeWritePreflight): string {
    // The candidate worktree is detached at sourceRevision; if the implementer
    // wrote files without committing, HEAD still points at the base commit. A
    // tree hash alone is not a commit; create a commit object binding the
    // candidate tree onto the base revision.
    const commitEnv = { ...process.env, GIT_AUTHOR_NAME: "sparkle-native-apply", GIT_AUTHOR_EMAIL: "native@sparkle.invalid", GIT_COMMITTER_NAME: "sparkle-native-apply", GIT_COMMITTER_EMAIL: "native@sparkle.invalid", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
    const commit = spawnSync("git", ["commit-tree", candidateTree, "-p", preflight.revision, "-m", "sparkle native apply candidate"], { cwd: candidate, encoding: "utf8", windowsHide: true, env: commitEnv });
    if (commit.error !== undefined || commit.status !== 0) {
      fail(`cannot bind candidate tree: ${commit.error?.message ?? commit.stderr ?? "unknown error"}`);
    }
    return commit.stdout.trim();
  }

  private isAncestorOf(repo: string, ancestor: string, descendant: string): boolean {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repo, encoding: "utf8", windowsHide: true });
    if (result.error !== undefined) fail(`ancestry check failed: ${result.error.message}`);
    // Exit 0 = ancestor, exit 1 = not ancestor, other = error.
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    fail(`ancestry check failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }

  /**
   * Explicitly dispose one managed candidate worktree. Refuses paths that were
   * never applied through this session (foreign or already disposed).
   */
  async dispose(candidatePath: string): Promise<NativeDisposeResult> {
    if (this.closed) fail("native apply session is shut down");
    if (typeof candidatePath !== "string" || candidatePath.trim() === "") fail("candidate path is required");
    const resolved = path.resolve(candidatePath);
    if (!this.managed.has(resolved)) {
      fail(`path is not a managed candidate worktree: ${resolved}`);
    }
    // Resolve the owning main repository from the worktree itself, so removal
    // is issued by the repo that owns the worktree registry.
    const listing = git(resolved, ["worktree", "list", "--porcelain"]);
    if (!listing.ok) fail(`cannot list worktrees from candidate: ${listing.detail}`);
    const firstLine = listing.stdout.split(/\r?\n/, 1)[0] ?? "";
    if (!firstLine.startsWith("worktree ")) fail("cannot resolve the owning repository of the candidate");
    const mainRepo = path.resolve(firstLine.slice("worktree ".length));
    const remove = git(mainRepo, ["worktree", "remove", "--force", resolved]);
    if (!remove.ok) {
      // Best-effort fallback: directory may already be gone; still prune.
      await rm(resolved, { recursive: true, force: true }).catch(() => undefined);
      git(mainRepo, ["worktree", "prune"]);
    }
    this.managed.delete(resolved);
    return { status: "DISPOSED", candidatePath: resolved };
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    // Retained candidates are caller-owned evidence; shutdown never deletes.
  }
}

void tmpdir;
void mkdir;
