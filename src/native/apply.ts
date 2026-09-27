import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
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
  const result = spawnSync("git", ["--no-optional-locks", ...args], { cwd, encoding: "utf8", windowsHide: true });
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

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function realPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    fail(`worktree path is missing or inaccessible: ${value}`);
  }
}

function directoryIdentity(value: string): string {
  const info = statSync(value, { bigint: true });
  if (!info.isDirectory()) fail(`worktree path is not a directory: ${value}`);
  return `${info.dev}:${info.ino}`;
}

interface RepositoryIdentity {
  readonly root: string;
  readonly commonDir: string;
  readonly gitDir: string;
  readonly directoryId: string;
  readonly gitDirectoryId: string;
}

function repositoryIdentity(repo: string): RepositoryIdentity {
  const root = realPath(repo);
  if (pathKey(repo) !== pathKey(root)) fail("worktree path aliases are refused");
  const top = realPath(gitOrThrow(root, ["rev-parse", "--show-toplevel"]));
  if (pathKey(root) !== pathKey(top)) fail("worktree path must be the Git toplevel");
  const commonDir = realPath(path.resolve(root, gitOrThrow(root, ["rev-parse", "--git-common-dir"])));
  const gitDir = realPath(path.resolve(root, gitOrThrow(root, ["rev-parse", "--git-dir"])));
  return { root, commonDir, gitDir, directoryId: directoryIdentity(root), gitDirectoryId: directoryIdentity(gitDir) };
}

function sameRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return pathKey(left.root) === pathKey(right.root)
    && pathKey(left.commonDir) === pathKey(right.commonDir)
    && pathKey(left.gitDir) === pathKey(right.gitDir)
    && left.directoryId === right.directoryId
    && left.gitDirectoryId === right.gitDirectoryId;
}

function candidateIdentity(candidate: string, source: RepositoryIdentity, revision: string): RepositoryIdentity {
  const identity = repositoryIdentity(candidate);
  if (pathKey(identity.root) === pathKey(source.root)) fail("candidate must not be the source repository");
  if (pathKey(identity.commonDir) !== pathKey(source.commonDir)) fail("candidate belongs to a foreign repository");
  if (pathKey(identity.gitDir) === pathKey(identity.commonDir)) fail("candidate must be a linked worktree");

  // Use NUL-delimited porcelain so spaces, quotes and newlines in paths are
  // not mistaken for Git's display quoting or record separators.
  const listing = git(source.root, ["worktree", "list", "--porcelain", "-z"]);
  if (!listing.ok) fail(`cannot read candidate worktree registration: ${listing.detail}`);
  const entries = listing.stdout.split("\0\0").map((record) => record.split("\0"));
  const entry = entries.find((fields) => fields.some((field) =>
    field.startsWith("worktree ") && pathKey(field.slice("worktree ".length)) === pathKey(identity.root)
  ));
  if (entry === undefined || !entry.includes("detached") || entry.some((field) => field.startsWith("prunable"))) {
    fail("candidate is not a registered detached worktree");
  }
  const backlink = readFileSync(path.join(identity.gitDir, "gitdir"), "utf8").trim();
  if (pathKey(realPath(backlink)) !== pathKey(realPath(path.join(identity.root, ".git")))) {
    fail("candidate worktree registration points to a different path");
  }
  if (!entry.includes(`HEAD ${revision}`) || gitOrThrow(candidate, ["rev-parse", "HEAD"]) !== revision) {
    fail("candidate worktree is no longer at its accepted base revision");
  }
  return identity;
}

interface SourceState { readonly revision: string; readonly branch: string; readonly status: string }

function sourceState(repo: string): SourceState {
  return {
    revision: gitOrThrow(repo, ["rev-parse", "HEAD"]),
    branch: gitOrThrow(repo, ["rev-parse", "--symbolic-full-name", "HEAD"]),
    status: gitOrThrow(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"])
  };
}

function assertUnchangedSource(identity: RepositoryIdentity, expected: SourceState): void {
  if (!sameRepository(identity, repositoryIdentity(identity.root))) fail("source repository identity changed before apply; candidate not applied");
  const current = sourceState(identity.root);
  if (current.revision !== expected.revision || current.branch !== expected.branch || current.status !== "") {
    fail("source branch, HEAD, index or working tree changed before apply; candidate not applied; source changes preserved");
  }
}

function assertCandidateCheckout(identity: RepositoryIdentity, before: SourceState, candidateCommit: string): void {
  if (!sameRepository(identity, repositoryIdentity(identity.root))) fail("source repository identity changed during checkout");
  const current = sourceState(identity.root);
  if (current.revision !== before.revision || current.branch !== before.branch) {
    fail("source branch or HEAD changed during checkout or ref publication");
  }
  const index = git(identity.root, ["diff", "--cached", "--quiet", candidateCommit, "--"]);
  const working = git(identity.root, ["diff", "--quiet", "--"]);
  const untracked = gitOrThrow(identity.root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const ignored = gitOrThrow(identity.root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  if (!index.ok || !working.ok || untracked !== "" || ignored !== "") {
    fail("source index or working tree changed during checkout or ref publication");
  }
}

function refuseAfterMutation(identity: RepositoryIdentity, before: SourceState, candidateCommit: string, detail: string): never {
  // A Git failure can follow a ref update or another writer's changes. Read
  // the result, but never reset, clean, or otherwise try to undo unowned work.
  let outcome = "ambiguous or partial update; cannot automatically determine whether the candidate was applied";
  try {
    if (sameRepository(identity, repositoryIdentity(identity.root))) {
      const current = sourceState(identity.root);
      if (current.branch === before.branch && current.status === "") {
        if (current.revision === candidateCommit) outcome = `candidate is applied at ${candidateCommit}, but Git reported a failure`;
        else if (current.revision === before.revision) outcome = "candidate not applied";
      }
    }
  } catch {
    // Unreadable state is also ambiguous and must remain available to inspect.
  }
  fail(`source update failed: ${outcome}; source state preserved without rollback and candidate retained: ${detail}`);
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
   * is re-verified in place before any source mutation. Concurrent changes
   * cause refusal. A mid-apply failure preserves the observed source state
   * and retained candidate; an ambiguous outcome needs caller inspection.
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

    const sourceIdentity = repositoryIdentity(preflight.sourceRepo);
    const before = sourceState(preflight.sourceRepo);
    if (before.revision !== preflight.revision || before.status !== "") fail("source changed during apply preflight; candidate not applied");
    if (!before.branch.startsWith("refs/heads/")) fail("apply requires a named source branch; detached source HEAD is refused before verification");
    const candidate = path.resolve(result.candidatePath);
    const identity = candidateIdentity(candidate, sourceIdentity, preflight.revision);

    // Re-verify inside the candidate with the frozen host command before the
    // source is mutated. This executes candidate code; host policy applies.
    reverifyCandidate(preflight.verification, candidate);

    if (!sameRepository(identity, candidateIdentity(candidate, sourceIdentity, preflight.revision))) {
      fail("candidate worktree identity changed during verification; candidate not applied");
    }
    assertUnchangedSource(sourceIdentity, before);

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
    assertUnchangedSource(sourceIdentity, before);
    // Checkout before any ref hooks run. `merge --ff-only` may invoke an
    // ORIG_HEAD hook and then overwrite index edits made by that hook from a
    // stale index view. Two-tree read-tree uses Git's index lock and refuses
    // dirty-path conflicts; subsequent ref operations never write file bytes
    // or the index. This is not an atomic checkout/ref or crash protocol.
    const checkout = git(preflight.sourceRepo, ["read-tree", "-m", "-u", previous, candidateCommit]);
    if (!checkout.ok) {
      refuseAfterMutation(sourceIdentity, before, candidateCommit, checkout.detail);
    }
    try {
      assertCandidateCheckout(sourceIdentity, before, candidateCommit);
    } catch (error) {
      refuseAfterMutation(sourceIdentity, before, candidateCommit, String(error));
    }

    const original = git(preflight.sourceRepo, ["update-ref", "ORIG_HEAD", previous]);
    if (!original.ok) {
      refuseAfterMutation(sourceIdentity, before, candidateCommit, original.detail);
    }
    try {
      assertCandidateCheckout(sourceIdentity, before, candidateCommit);
    } catch (error) {
      refuseAfterMutation(sourceIdentity, before, candidateCommit, String(error));
    }

    // Publish the originally observed branch with Git's expected-old-value
    // check, rather than resolving a possibly switched HEAD at update time.
    const applied = git(preflight.sourceRepo, ["update-ref", before.branch, candidateCommit, previous]);
    if (!applied.ok) {
      refuseAfterMutation(sourceIdentity, before, candidateCommit, applied.detail);
    }
    try {
      assertUnchangedSource(sourceIdentity, { ...before, revision: candidateCommit });
    } catch {
      refuseAfterMutation(sourceIdentity, before, candidateCommit, "source did not retain the expected candidate revision and clean checkout");
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
