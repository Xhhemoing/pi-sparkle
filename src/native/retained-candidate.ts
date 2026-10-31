import { assertPreparedDelivery, preparedDeliverySnapshot, preparedNodeArtifactIdentity, preparedNodeArtifactLinks,
  type PreparedNodeArtifacts, type DeliveryProof } from "../execution/prepared-node-artifacts.js";
import { detachNodeOfflineLinks } from "../development/node-offline-preparation.js";
import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { captureExactSnapshot, sameExactSnapshot, type ExactSnapshot } from "../execution/exact-snapshot.js";
import { captureNativeDisposeAuthorization, type NativeDisposeAuthorization, type NativeDisposeResult, type RepositoryIdentity } from "./apply.js";

export interface RetainedCandidateHandle {
  readonly sourceRepo: string;
  readonly sourceRevision: string;
  readonly candidatePath: string;
}
interface HeldCandidate {
  readonly authorization: NativeDisposeAuthorization;
  readonly snapshot: ExactSnapshot;
  readonly indexTree: string;
  readonly prepared?: { readonly artifacts: PreparedNodeArtifacts; readonly delivery: DeliveryProof };
}
const heldCandidates = new WeakMap<RetainedCandidateHandle, HeldCandidate>();
// Whole-tree ownership and apply use the same finite capacity; scoped checker limits stay independent.
export const WHOLE_CANDIDATE_SNAPSHOT_LIMITS = Object.freeze({ maxFiles: 4096, maxBytes: 32 * 1024 * 1024 });
function fail(message: string): never { throw new DomainValidationError(`retained candidate: ${message}`); }
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024
  });
  if (result.error !== undefined || result.status !== 0) fail(`Git ${args[0]} failed; candidate retained for inspection: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
function pathKey(value: string): string { const resolved = path.resolve(value); return process.platform === "win32" ? resolved.toLowerCase() : resolved; }
function sameIdentity(a: RepositoryIdentity, b: RepositoryIdentity): boolean {
  return (["root", "commonDir", "gitDir"] as const).every(key => pathKey(a[key]) === pathKey(b[key]))
    && a.directoryId === b.directoryId && a.gitDirectoryId === b.gitDirectoryId;
}
function record(sourceRepo: string, candidatePath: string): string[] | undefined {
  return git(sourceRepo, ["worktree", "list", "--porcelain", "-z"]).split("\0\0").map(value => value.split("\0"))
    .find(fields => fields.some(field => field.startsWith("worktree ") && pathKey(field.slice(9)) === pathKey(candidatePath)));
}
function assertUnlocked(sourceRepo: string, candidatePath: string): void {
  const selected = record(sourceRepo, candidatePath);
  if (selected === undefined || selected.some(field => field === "locked" || field.startsWith("locked "))) fail("managed worktree is missing or locked");
}

/** A genuine private snapshot grants no authority to serialized handle copies. */
export function holdRetainedCandidate(input: RetainedCandidateHandle,
  prepared?: { readonly artifacts: PreparedNodeArtifacts; readonly delivery: DeliveryProof }): RetainedCandidateHandle {
  prepared = prepared === undefined ? undefined : Object.freeze({ artifacts: prepared.artifacts, delivery: prepared.delivery });
  const authorization = captureNativeDisposeAuthorization(input.sourceRepo, input.candidatePath, input.sourceRevision);
  const handle = Object.freeze({ sourceRepo: authorization.sourceIdentity.root, sourceRevision: input.sourceRevision,
    candidatePath: authorization.candidateIdentity.root });
  assertUnlocked(handle.sourceRepo, handle.candidatePath);
  if (prepared !== undefined) {
    const identity = preparedNodeArtifactIdentity(prepared.artifacts);
    if (pathKey(identity.sourceRepo) !== pathKey(handle.sourceRepo) || pathKey(identity.candidatePath) !== pathKey(handle.candidatePath) ||
        identity.sourceRevision !== handle.sourceRevision) fail("prepared ownership does not match retained candidate");
    assertPreparedDelivery(prepared.artifacts, prepared.delivery);
  }
  const snapshot = prepared === undefined ? captureExactSnapshot(handle.candidatePath, {}, WHOLE_CANDIDATE_SNAPSHOT_LIMITS) : preparedDeliverySnapshot(prepared.artifacts, prepared.delivery);
  const indexTree = git(handle.candidatePath, ["write-tree"]).trim();
  heldCandidates.set(handle, { authorization, snapshot, indexTree, ...(prepared === undefined ? {} : { prepared }) });
  assertRetainedCandidate(handle);
  return handle;
}

/** Observe live identity, full bytes/modes and staged content without refreshing ownership. */
export function assertRetainedCandidate(handle: RetainedCandidateHandle, preparedIndexTree?: string): void {
  const held = heldCandidates.get(handle);
  if (held === undefined) fail("requires the original live managed handle");
  if (preparedIndexTree !== undefined && !/^[0-9a-f]{40}$/.test(preparedIndexTree)) fail("invalid host-prepared index tree");
  const current = captureNativeDisposeAuthorization(handle.sourceRepo, handle.candidatePath, handle.sourceRevision);
  if (!sameIdentity(current.sourceIdentity, held.authorization.sourceIdentity) ||
    !sameIdentity(current.candidateIdentity, held.authorization.candidateIdentity)) fail("repository or candidate identity changed");
  assertUnlocked(handle.sourceRepo, handle.candidatePath);
  if (held.prepared === undefined) {
    if (!sameExactSnapshot(held.snapshot, captureExactSnapshot(handle.candidatePath, {}, WHOLE_CANDIDATE_SNAPSHOT_LIMITS))) fail("held candidate bytes or file set changed");
  } else assertPreparedDelivery(held.prepared.artifacts, held.prepared.delivery);
  if (git(handle.candidatePath, ["write-tree"]).trim() !== (preparedIndexTree ?? held.indexTree)) fail("held candidate index changed");
}

/** Exactly one explicit removal; Git failure never invokes prune or recursive fallback. */
export async function discardRetainedCandidate(input: { readonly handle: RetainedCandidateHandle; readonly signal?: AbortSignal;
  readonly onPrepared?: () => void | Promise<void> }): Promise<NativeDisposeResult> {
  input.signal?.throwIfAborted();
  const handle = input.handle;
  assertRetainedCandidate(handle);
  if (input.onPrepared !== undefined) await input.onPrepared();
  input.signal?.throwIfAborted();
  assertRetainedCandidate(handle);
  const prepared = heldCandidates.get(handle)!.prepared;
  if (prepared !== undefined) detachNodeOfflineLinks(handle.candidatePath, preparedNodeArtifactLinks(prepared.artifacts));
  git(handle.sourceRepo, [...(prepared !== undefined && process.platform === "win32" ? ["-c", "core.longpaths=true"] : []), "worktree", "remove", "--force", "--", handle.candidatePath]);
  if (lstatSync(handle.candidatePath, { throwIfNoEntry: false }) !== undefined || record(handle.sourceRepo, handle.candidatePath) !== undefined) {
    fail("discard outcome is unresolved; remaining data retained without fallback");
  }
  heldCandidates.delete(handle);
  return Object.freeze({ status: "DISPOSED", candidatePath: handle.candidatePath });
}
