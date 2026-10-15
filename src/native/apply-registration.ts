import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { canonicalizeStableJson } from "../domain/canonical-json.js";
import type { ClosedLoopAcceptance } from "../execution/acceptance.js";
import {
  loopArtifactsDir,
  readLoopArtifact,
  saveLoopArtifact,
  type LoopArtifactRef
} from "../execution/loop-artifact.js";
import { assertNativeApplyVerificationSupported, captureNativeDisposeAuthorization, type NativeApplyInput, type NativeDisposeAuthorization } from "./apply.js";
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
 *    exact accepted result is persisted as an opaque-id loop artifact under
 *    the run subtree (`native-apply-registration` record).
 * 2. The apply step accepts only the issued handle (runId +
 *    artifactId + candidatePath) and reconstructs the trusted result from
 *    the persisted artifact bytes (schema + recorded byte length checked on
 *    read; an equal-length replacement is not detected) — never from tool
 *    parameters. Registration records also accept the write path's own final
 *    `ps-p3-closed-loop` artifact when it is uniquely located by recorded
 *    conditions (accepted === true, artifactId === issued address).
 * 3. Disposal is caller-invoked through the apply session's managed-path
 *    check; registration never deletes anything.
 */

const REGISTRATION_KIND = "native-apply-registration" as const;
const REGISTRATION_SCHEMA = 2;
const DISPOSAL_KIND = "native-apply-disposal" as const;
const DISPOSAL_SCHEMA = 1;

interface StoredCandidateArtifact {
  readonly kind: typeof REGISTRATION_KIND;
  readonly registrationSchema: typeof REGISTRATION_SCHEMA;
  readonly sourceRepo: string;
  readonly disposalAuthorization: NativeDisposeAuthorization;
  readonly result: NativeWriteSessionResult;
}

interface StoredDisposalArtifact {
  readonly kind: typeof DISPOSAL_KIND;
  readonly disposalSchema: typeof DISPOSAL_SCHEMA;
  readonly registrationArtifactId: string;
  readonly sourceRepo: string;
  readonly candidatePath: string;
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

/** Inspect descriptors before reading values; never execute a host accessor. */
function ownDataFields(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail("registration input must be a plain object without inherited fields");
  }
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (allowed !== undefined && !allowed.includes(key))) fail("registration input contains an unsupported field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) fail("registration fields must be ordinary enumerable values, not accessors");
    fields[key] = descriptor.value;
  }
  return fields;
}

/** Preserve ordinary JSON metadata while omitting optional undefined fields. */
function copyResultData(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) fail("registration result contains a cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail("registration result must contain plain arrays");
      for (const key of Reflect.ownKeys(value)) {
        if (key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
          fail("registration result array contains an unsupported field");
        }
      }
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) fail("registration result array must contain ordinary values, not accessors or holes");
        copy.push(copyResultData(descriptor.value, ancestors));
      }
      return Object.freeze(copy);
    }
    const copy = ownDataFields(value);
    for (const key of Object.keys(copy)) {
      if (copy[key] === undefined) delete copy[key];
      else copy[key] = copyResultData(copy[key], ancestors);
    }
    return Object.freeze(copy);
  } finally { ancestors.delete(value); }
}

function snapshotResult(value: unknown): NativeWriteSessionResult {
  const result = copyResultData(value);
  // Validate the entire captured data tree without invoking toJSON or treating
  // serialized metadata as an in-process verification capability.
  canonicalizeStableJson(result);
  if (!isAcceptedWriteResult(result)) fail("candidate result is not accepted; refused");
  requiredAbsolutePath(result.candidatePath, "candidate path");
  if (typeof result.runId !== "string" || !result.runId.startsWith("run_")) fail("run id must be a durable run id");
  if (typeof result.acceptance.command !== "string" || result.acceptance.command.trim() === "" ||
      !Array.isArray(result.acceptance.args) || result.acceptance.args.some((arg) => typeof arg !== "string")) {
    fail("candidate result must carry a host command and string argv");
  }
  assertNativeApplyVerificationSupported(result);
  if (!isLoopArtifactRef(result.artifact)) fail("candidate result carries no usable loop artifact reference");
  return result;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) fail(`${label} is required`);
  return value;
}

function requiredAbsolutePath(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (!path.isAbsolute(text)) fail(`${label} must be absolute`);
  return text;
}

function originalSignal(value: unknown): AbortSignal | undefined {
  if (value !== undefined && !(value instanceof AbortSignal)) fail("signal must be an AbortSignal");
  return value;
}

function snapshotHandle(input: unknown, allowSignal: boolean): ApplyIssuedCandidateInput {
  const fields = ownDataFields(input, ["stateRoot", "sourceRepo", "runId", "artifactId", "candidatePath", ...(allowSignal ? ["signal"] : [])]);
  const signal = allowSignal ? originalSignal(fields.signal) : undefined;
  const snapshot = Object.freeze({
    stateRoot: path.resolve(requiredText(fields.stateRoot, "state root")),
    sourceRepo: path.resolve(requiredText(fields.sourceRepo, "source repository")),
    runId: requiredText(fields.runId, "run id"), artifactId: requiredText(fields.artifactId, "artifact id"),
    candidatePath: requiredAbsolutePath(fields.candidatePath, "candidate path"),
    ...(signal === undefined ? {} : { signal })
  });
  validateHandleShape(snapshot);
  return snapshot;
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
    typeof (value as LoopArtifactRef).id === "string" &&
    /^art_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test((value as LoopArtifactRef).id) &&
    (value as LoopArtifactRef).schemaVersion === "loop-artifact-v2"
  );
}

export interface IssuedApplyCandidate {
  readonly runId: NativeWriteSessionResult["runId"];
  readonly artifactId: string;
  readonly candidatePath: string;
  readonly sourceRepo: string;
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
  readonly artifactId: string;
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
  const fields = ownDataFields(input, ["stateRoot", "sourceRepo", "result", "signal"]);
  const signal = originalSignal(fields.signal);
  if (signal?.aborted) fail("apply registration aborted before any work");
  const request = Object.freeze({
    stateRoot: path.resolve(requiredText(fields.stateRoot, "state root")),
    sourceRepo: path.resolve(requiredText(fields.sourceRepo, "source repository")),
    result: snapshotResult(fields.result)
  });

  const body: StoredCandidateArtifact = {
    kind: REGISTRATION_KIND,
    registrationSchema: REGISTRATION_SCHEMA,
    sourceRepo: request.sourceRepo,
    disposalAuthorization: captureNativeDisposeAuthorization(request.sourceRepo, request.result.candidatePath, request.result.sourceRevision),
    result: request.result
  };
  const artifact = await saveLoopArtifact({
    stateRoot: request.stateRoot,
    runId: request.result.runId,
    body
  });
  return {
    runId: request.result.runId,
    artifactId: artifact.id,
    candidatePath: request.result.candidatePath,
    sourceRepo: request.sourceRepo,
    sourceRevision: request.result.sourceRevision,
    accepted: true
  };
}

/**
 * Apply one issued candidate. The trusted result is reconstructed from
 * persisted artifact bytes (schema + recorded byte length checked on read)
 * — never from the caller's arguments — and then handed to the verified
 * apply path.
 */
export async function applyIssuedCandidate(
  input: ApplyIssuedCandidateInput
): Promise<{ status: "APPLIED"; appliedRevision: string; retainedCandidate: true }> {
  const request = snapshotHandle(input, true);
  if (request.signal?.aborted) fail("apply aborted before any work");
  const result = await reconstructIssuedResult(request);
  const { NativeApplySession } = await import("./apply.js");
  const session = new NativeApplySession();
  const applyInput: NativeApplyInput = {
    sourceRepo: request.sourceRepo,
    result,
    ...(request.signal !== undefined ? { signal: request.signal } : {})
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
  if (typeof input.artifactId !== "string" || !/^art_v2_[0-9a-f-]{36}$/.test(input.artifactId)) {
    fail("artifact id must be an opaque art_v2 id");
  }
}

async function readIssuedArtifact(
  stateRoot: string,
  runId: string,
  id: string
): Promise<unknown> {
  try {
    return await readLoopArtifact(stateRoot, runId as Parameters<typeof readLoopArtifact>[1], id);
  } catch (error) {
    fail(
      `candidate result is not issued through this host session (artifact unreadable for ${runId}): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function reconstructIssuedResult(input: ApplyIssuedCandidateInput, requireDisposalIdentity = false): Promise<NativeWriteSessionResult> {
  validateHandleShape(input);
  const body = await readIssuedArtifact(input.stateRoot, input.runId, input.artifactId);
  if (
    body !== null &&
    typeof body === "object" &&
    (body as { kind?: unknown }).kind === REGISTRATION_KIND
  ) {
    const schema = (body as { registrationSchema?: unknown }).registrationSchema;
    if (schema !== REGISTRATION_SCHEMA && (requireDisposalIdentity || schema !== 1)) {
      fail("issued artifact body has an unsupported registration schema");
    }
    const stored = (body as { result: unknown }).result;
    if (!isAcceptedWriteResult(stored)) fail("issued artifact body does not carry an accepted result");
    if (stored.runId !== input.runId) fail("issued artifact body names a different run");
    if (stored.candidatePath !== input.candidatePath) fail("candidate path does not match the issued record");
    const storedSourceRepo = (body as { sourceRepo?: unknown }).sourceRepo;
    if (schema === REGISTRATION_SCHEMA && (typeof storedSourceRepo !== "string" || path.resolve(storedSourceRepo) !== path.resolve(input.sourceRepo))) {
      fail("source repository does not match the issued record");
    }
    return stored;
  }
  fail("issued artifact body is not a native-apply-registration record");
}

/**
 * Locate the write path's own accepted loop artifact for this run: the
 * unique `ps-p3-closed-loop` record whose `acceptance.accepted === true`
 * and whose `acceptance.artifactId` equals the issued (provisional)
 * artifact address. Both conditions are conditions on read-verified
 * artifact bytes, so a wrong record is never selected.
 */
export async function findAcceptedLoopArtifact(
  stateRoot: string,
  runId: string,
  provisionalId: string,
  candidatePath: string
): Promise<NativeWriteSessionResult> {
  validateHandleShape({ ...emptyHandle(), runId, artifactId: provisionalId });
  requiredAbsolutePath(candidatePath, "candidate path");
  const dir = loopArtifactsDir(stateRoot, runId as Parameters<typeof loopArtifactsDir>[1]);
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    if (!/^art_v2_[0-9a-f-]{36}$/.test(id) || id === provisionalId) continue;
    const body = await readIssuedArtifact(stateRoot, runId, id);
    if (
      body === null ||
      typeof body !== "object" ||
      (body as { kind?: unknown }).kind !== "ps-p3-closed-loop"
    ) {
      continue;
    }
    const loop = body as unknown as PsP3LoopArtifact;
    if (loop.acceptance?.accepted !== true) continue;
    if (loop.acceptance.artifactId !== provisionalId) continue;
    if (loop.cwd !== candidatePath) fail("candidate path does not match the accepted artifact");
    return {
      runId: runId as NativeWriteSessionResult["runId"],
      status: "COMPLETED",
      candidatePath: loop.cwd,
      sourceRevision: loop.revision,
      artifact: {
        id,
        byteLength: 0,
        path: "",
        schemaVersion: "loop-artifact-v2"
      },
      acceptance: loop.acceptance,
      reason: "accepted",
      executionEvents: 0
    };
  }
  fail("no accepted closed-loop artifact found for the issued run");
}

function emptyHandle(): ApplyIssuedCandidateInput {
  return { stateRoot: "", sourceRepo: "", runId: "", artifactId: "", candidatePath: "" };
}

export interface DisposeIssuedCandidateInput {
  readonly stateRoot: string;
  readonly sourceRepo: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly candidatePath: string;
}

async function findDisposalReceipt(input: DisposeIssuedCandidateInput): Promise<boolean> {
  validateHandleShape(input as ApplyIssuedCandidateInput);
  const dir = loopArtifactsDir(input.stateRoot, input.runId as Parameters<typeof loopArtifactsDir>[1]);
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -".json".length);
    if (!/^art_v2_[0-9a-f-]{36}$/.test(id)) continue;
    const body = await readIssuedArtifact(input.stateRoot, input.runId, id);
    if (
      body !== null &&
      typeof body === "object" &&
      (body as { kind?: unknown }).kind === DISPOSAL_KIND &&
      (body as StoredDisposalArtifact).disposalSchema === DISPOSAL_SCHEMA &&
      (body as StoredDisposalArtifact).registrationArtifactId === input.artifactId &&
      (body as StoredDisposalArtifact).candidatePath === input.candidatePath &&
      typeof (body as StoredDisposalArtifact).sourceRepo === "string" &&
      path.resolve((body as StoredDisposalArtifact).sourceRepo) === path.resolve(input.sourceRepo)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Dispose one issued candidate through a fresh apply session. The durable
 * registration receipt binds the source repository, accepted base revision,
 * and candidate path; the apply module rechecks the live worktree identity
 * before removal. A disposal receipt makes a successful retry idempotent.
 */
export async function disposeIssuedCandidate(
  input: DisposeIssuedCandidateInput
): Promise<{ status: "DISPOSED"; candidatePath: string }> {
  const request = snapshotHandle(input, false);
  const result = await reconstructIssuedResult(request, true);
  if (await findDisposalReceipt(request)) {
    try {
      await lstat(request.candidatePath);
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { status: "DISPOSED", candidatePath: path.resolve(request.candidatePath) };
      }
      throw error;
    }
    fail("disposed candidate path exists again; replacement retained for inspection");
  }
  const registration = await readIssuedArtifact(request.stateRoot, request.runId, request.artifactId) as StoredCandidateArtifact;
  const authorization = registration.disposalAuthorization;
  if (authorization === null || typeof authorization !== "object"
    || authorization.sourceIdentity === null || typeof authorization.sourceIdentity !== "object"
    || authorization.candidateIdentity === null || typeof authorization.candidateIdentity !== "object"
    || authorization.sourceRevision !== result.sourceRevision) fail("issued disposal identity is missing or invalid");
  const { NativeApplySession } = await import("./apply.js");
  const session = new NativeApplySession();
  const disposed = await session.disposeAuthorized({
    ...authorization,
    sourceRepo: request.sourceRepo,
    sourceRevision: result.sourceRevision,
    candidatePath: request.candidatePath
  });
  await saveLoopArtifact({
    stateRoot: request.stateRoot,
    runId: request.runId as NativeWriteSessionResult["runId"],
    body: {
      kind: DISPOSAL_KIND,
      disposalSchema: DISPOSAL_SCHEMA,
      registrationArtifactId: request.artifactId,
      sourceRepo: path.resolve(request.sourceRepo),
      candidatePath: disposed.candidatePath
    } satisfies StoredDisposalArtifact
  });
  return disposed;
}
