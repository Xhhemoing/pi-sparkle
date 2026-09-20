import { readdir } from "node:fs/promises";
import { DomainValidationError } from "../domain/errors.js";
import type { ClosedLoopAcceptance } from "../execution/acceptance.js";
import {
  loopArtifactsDir,
  readLoopArtifact,
  saveLoopArtifact,
  type LoopArtifactRef
} from "../execution/loop-artifact.js";
import type { NativeApplyInput } from "./apply.js";
import type { NativeWriteSessionResult } from "./write-session.js";

/**
 * Host-facing registration boundary for `NativeApplySession`.
 *
 * A Pi session never passes a `NativeWriteSessionResult` from the model:
 * that object carries `acceptance.command`/`args`, and the apply path
 * executes them inside the candidate. A model-controlled result would be a
 * model-controlled command. Instead:
 *
 * 1. The host issues a registration from a result it already holds. The
 *    exact accepted result is persisted as a content-addressed loop
 *    artifact under the run subtree (`native-apply-registration` record).
 * 2. The apply step accepts only the issued handle (runId +
 *    artifactSha256 + candidatePath) and reconstructs the trusted result
 *    from the persisted, hash-verified bytes — never from tool parameters.
 *    Registration records also accept the write path's own final
 *    `ps-p3-closed-loop` artifact when it is uniquely located by content
 *    conditions (accepted === true, artifactHash === issued address).
 * 3. Disposal is caller-invoked through the apply session's managed-path
 *    check; registration never deletes anything.
 */

const REGISTRATION_KIND = "native-apply-registration" as const;
const REGISTRATION_SCHEMA = 1;

interface StoredCandidateArtifact {
  readonly kind: typeof REGISTRATION_KIND;
  readonly registrationSchema: typeof REGISTRATION_SCHEMA;
  readonly result: NativeWriteSessionResult;
}

interface PsP3LoopArtifact {
  readonly kind: "ps-p3-closed-loop";
  readonly revision: string;
  readonly cwd: string;
  readonly acceptance: ClosedLoopAcceptance;
}

function fail(message: string): never {
  throw new DomainValidationError(message);
}

function isAcceptedWriteResult(result: unknown): result is NativeWriteSessionResult {
  return (
    result !== null &&
    typeof result === "object" &&
    typeof (result as NativeWriteSessionResult).candidatePath === "string" &&
    (result as NativeWriteSessionResult).candidatePath.trim() !== "" &&
    typeof (result as NativeWriteSessionResult).sourceRevision === "string" &&
    /^[0-9a-f]{40}$/.test((result as NativeWriteSessionResult).sourceRevision) &&
    (result as NativeWriteSessionResult).acceptance !== null &&
    typeof (result as NativeWriteSessionResult).acceptance === "object" &&
    (result as NativeWriteSessionResult).acceptance.accepted === true
  );
}

function isLoopArtifactRef(value: unknown): value is LoopArtifactRef {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as LoopArtifactRef).sha256 === "string" &&
    /^[0-9a-f]{64}$/.test((value as LoopArtifactRef).sha256) &&
    (value as LoopArtifactRef).schemaVersion === "loop-artifact-v1"
  );
}

export interface IssuedApplyCandidate {
  readonly runId: NativeWriteSessionResult["runId"];
  readonly artifactSha256: string;
  readonly candidatePath: string;
  readonly sourceRevision: string;
  readonly accepted: true;
}

export interface IssueApplyRegistrationInput {
  readonly stateRoot: string;
  readonly sourceRepo: string;
  readonly result: NativeWriteSessionResult;
  readonly signal?: AbortSignal;
}

export interface ApplyIssuedCandidateInput {
  readonly stateRoot: string;
  readonly sourceRepo: string;
  readonly runId: string;
  readonly artifactSha256: string;
  readonly candidatePath: string;
  readonly signal?: AbortSignal;
}

/**
 * Register one trusted write result for later application. The result must
 * be accepted; its exact shape is persisted under the run's artifact
 * subtree so apply-time reconstruction cannot drift from what the host
 * accepted at write time. Returns the handle the apply step consumes.
 */
export async function issueApplyRegistration(
  input: IssueApplyRegistrationInput
): Promise<IssuedApplyCandidate> {
  if (input === null || typeof input !== "object") fail("input is required");
  if (input.signal?.aborted) fail("apply registration aborted before any work");
  if (typeof input.stateRoot !== "string" || input.stateRoot.trim() === "") fail("state root is required");
  if (typeof input.sourceRepo !== "string" || input.sourceRepo.trim() === "") fail("source repository is required");
  if (!isAcceptedWriteResult(input.result)) fail("candidate result is not accepted; refused");
  if (!isLoopArtifactRef(input.result.artifact)) fail("candidate result carries no usable loop artifact reference");

  const body: StoredCandidateArtifact = {
    kind: REGISTRATION_KIND,
    registrationSchema: REGISTRATION_SCHEMA,
    result: input.result
  };
  const artifact = await saveLoopArtifact({
    stateRoot: input.stateRoot,
    runId: input.result.runId,
    body
  });
  return {
    runId: input.result.runId,
    artifactSha256: artifact.sha256,
    candidatePath: input.result.candidatePath,
    sourceRevision: input.result.sourceRevision,
    accepted: true
  };
}

/**
 * Apply one issued candidate. The trusted result is reconstructed from
 * persisted, hash-verified artifact bytes — never from the caller's
 * arguments — and then handed to the verified apply path.
 */
export async function applyIssuedCandidate(
  input: ApplyIssuedCandidateInput
): Promise<{ status: "APPLIED"; appliedRevision: string; retainedCandidate: true }> {
  if (input === null || typeof input !== "object") fail("input is required");
  if (input.signal?.aborted) fail("apply aborted before any work");
  const result = await reconstructIssuedResult(input);
  const { NativeApplySession } = await import("./apply.js");
  const session = new NativeApplySession();
  const applyInput: NativeApplyInput = {
    sourceRepo: input.sourceRepo,
    result,
    ...(input.signal !== undefined ? { signal: input.signal } : {})
  };
  const applied = await session.apply(applyInput);
  return {
    status: applied.status,
    appliedRevision: applied.appliedRevision,
    retainedCandidate: applied.retainedCandidate
  };
}

function validateHandleShape(input: ApplyIssuedCandidateInput): void {
  if (typeof input.runId !== "string" || !input.runId.startsWith("run_")) {
    fail("run id must be a durable run id");
  }
  if (typeof input.artifactSha256 !== "string" || !/^[0-9a-f]{64}$/.test(input.artifactSha256)) {
    fail("artifact sha256 must be 64 hex chars");
  }
}

async function readIssuedArtifact(
  stateRoot: string,
  runId: string,
  sha256: string
): Promise<unknown> {
  try {
    return await readLoopArtifact(stateRoot, runId as Parameters<typeof readLoopArtifact>[1], sha256);
  } catch (error) {
    fail(
      `candidate result is not issued through this host session (artifact unreadable for ${runId}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function reconstructIssuedResult(input: ApplyIssuedCandidateInput): Promise<NativeWriteSessionResult> {
  validateHandleShape(input);
  const body = await readIssuedArtifact(input.stateRoot, input.runId, input.artifactSha256);
  if (
    body !== null &&
    typeof body === "object" &&
    (body as { kind?: unknown }).kind === REGISTRATION_KIND
  ) {
    if ((body as StoredCandidateArtifact).registrationSchema !== REGISTRATION_SCHEMA) {
      fail("issued artifact body has an unsupported registration schema");
    }
    const stored = (body as { result: unknown }).result;
    if (!isAcceptedWriteResult(stored)) fail("issued artifact body does not carry an accepted result");
    if (stored.runId !== input.runId) fail("issued artifact body names a different run");
    if (stored.candidatePath !== input.candidatePath) fail("candidate path does not match the issued record");
    return stored;
  }
  fail("issued artifact body is not a native-apply-registration record");
}

/**
 * Locate the write path's own accepted loop artifact for this run: the
 * unique `ps-p3-closed-loop` record whose `acceptance.accepted === true`
 * and whose `acceptance.artifactHash` equals the issued (provisional)
 * artifact address. Both conditions are content conditions on
 * hash-verified bytes, so a wrong record is never selected.
 */
export async function findAcceptedLoopArtifact(
  stateRoot: string,
  runId: string,
  provisionalSha256: string,
  candidatePath: string
): Promise<NativeWriteSessionResult> {
  validateHandleShape({ ...emptyHandle(), runId, artifactSha256: provisionalSha256 });
  const dir = loopArtifactsDir(stateRoot, runId as Parameters<typeof loopArtifactsDir>[1]);
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const sha = entry.slice(0, -".json".length);
    if (!/^[0-9a-f]{64}$/.test(sha) || sha === provisionalSha256) continue;
    const body = await readIssuedArtifact(stateRoot, runId, sha);
    if (
      body === null ||
      typeof body !== "object" ||
      (body as { kind?: unknown }).kind !== "ps-p3-closed-loop"
    ) {
      continue;
    }
    const loop = body as unknown as PsP3LoopArtifact;
    if (loop.acceptance?.accepted !== true) continue;
    if (loop.acceptance.artifactHash !== provisionalSha256) continue;
    if (loop.cwd !== candidatePath) fail("candidate path does not match the accepted artifact");
    return {
      runId: runId as NativeWriteSessionResult["runId"],
      status: "COMPLETED",
      candidatePath: loop.cwd,
      sourceRevision: loop.revision,
      artifact: {
        id: `loop_${sha}`,
        sha256: sha,
        byteLength: 0,
        path: "",
        schemaVersion: "loop-artifact-v1"
      },
      acceptance: loop.acceptance,
      reason: "accepted",
      executionEvents: 0
    };
  }
  fail("no accepted closed-loop artifact found for the issued run");
}

function emptyHandle(): ApplyIssuedCandidateInput {
  return { stateRoot: "", sourceRepo: "", runId: "", artifactSha256: "", candidatePath: "" };
}

export interface DisposeIssuedCandidateInput {
  readonly candidatePath: string;
}

/**
 * Dispose one candidate through a fresh apply session's managed-path check.
 * Only worktree paths that an apply session previously applied (managed)
 * can be removed; foreign paths are refused by the apply module.
 */
export async function disposeIssuedCandidate(
  input: DisposeIssuedCandidateInput
): Promise<{ status: "DISPOSED"; candidatePath: string }> {
  if (input === null || typeof input !== "object") fail("input is required");
  if (typeof input.candidatePath !== "string" || input.candidatePath.trim() === "") {
    fail("candidate path is required");
  }
  const { NativeApplySession } = await import("./apply.js");
  const session = new NativeApplySession();
  const disposed = await session.dispose(input.candidatePath);
  return { status: disposed.status, candidatePath: disposed.candidatePath };
}
