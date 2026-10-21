import { lstat } from "node:fs/promises";
import path from "node:path";
import { canonicalizeStableJson } from "../domain/canonical-json.js";
import { DomainValidationError } from "../domain/errors.js";
import { parseRunId, parseTaskId, type RunId } from "../domain/ids.js";
import { loopArtifactPath, readLoopArtifact } from "../execution/loop-artifact.js";
import { EventStore } from "../run/event-store.js";
import type { Event } from "../run/events.js";
import { ActionLedger } from "./action-ledger.js";
import { WorkItemStore } from "./work-item-store.js";
import { freezeWorkItemValue, validateWorkItemEvidence, type WorkItemDefinition, type WorkItemStatus } from "./work-items.js";

export interface DevelopmentCandidateReviewInput {
  readonly sourceRepo: string;
  readonly queuePath: string;
  readonly stateRoot: string;
  readonly actionId: string;
}
export interface DevelopmentAttemptReview {
  readonly number: number;
  readonly runId: string;
  readonly artifactRef: string;
  readonly accepted: boolean;
  readonly criterionIds: readonly string[];
  /** Definitions are not per-criterion measured verdicts. */
  readonly perCriterionVerification: "UNOBSERVED";
  readonly taskContractArtifactRef?: string;
  readonly check?: {
    readonly checkId: string;
    readonly ok: boolean;
    readonly exitCode: number;
    readonly processStatus: string;
  };
}
export interface DevelopmentCandidateReview {
  readonly schemaVersion: 1;
  readonly historicalOnly: true;
  readonly reverified: false;
  readonly sourceApplied: false;
  readonly evidenceStatus: "available" | "unavailable";
  readonly queueId: string;
  readonly queueRevision: number;
  readonly actionId: string;
  readonly actionVersion: number;
  readonly itemId: string;
  readonly itemStatus: WorkItemStatus;
  readonly baseRevision: string;
  readonly runId: string;
  readonly candidatePath: string;
  readonly historicalAccepted: boolean;
  readonly criterionIds: readonly string[];
  readonly finalArtifactRef?: string;
  readonly loopArtifactRef?: string;
  readonly stopReason?: string;
  readonly attempts: readonly DevelopmentAttemptReview[];
}

const PREFIX = "candidate review: ";
const READ_LIMITS = Object.freeze({ maxBytes: 512 * 1024,
  eventLogLimits: Object.freeze({ maxBytes: 2 * 1024 * 1024, maxRecords: 10_000 }) });
const STOP_REASONS = ["accepted", "attempt-limit", "no-progress", "cancelled", "time-budget", "executor-failed",
  "verification-unavailable", "snapshot-unavailable", "source-changed"];
const PROCESS_STATUSES = ["completed", "cancelled", "timed_out", "output_limit", "spawn_error"];
function fail(reason: string): never { throw new DomainValidationError(`${PREFIX}${reason}`); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid evidence object");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum || /[\0\r\n]/.test(value)) fail("invalid bounded identity");
  return value;
}
function same(a: unknown, b: unknown): boolean { return canonicalizeStableJson(a) === canonicalizeStableJson(b); }
function reference(value: unknown): { ref: string; runId: RunId; id: string } {
  const ref = text(value, 160);
  const pieces = ref.split("/");
  if (pieces.length !== 2) fail("invalid artifact reference");
  const runId = parseRunId(pieces[0]);
  const id = pieces[1]!;
  // Reuse the existing opaque artifact identity validator, not persisted paths.
  loopArtifactPath(".", runId, id);
  return { ref, runId, id };
}
function nestedReference(runId: RunId, value: unknown): string {
  const stored = object(value);
  if (stored.schemaVersion !== "loop-artifact-v2" || !Number.isSafeInteger(stored.byteLength) ||
      (stored.byteLength as number) < 1 || (stored.byteLength as number) > READ_LIMITS.maxBytes) fail("invalid or oversized artifact descriptor");
  return reference(`${runId}/${text(stored.id, 80)}`).ref;
}
function verifyRecipeBinding(value: unknown, definition: WorkItemDefinition): Record<string, unknown> {
  const verifier = object(value);
  text(verifier.command);
  if (!Array.isArray(verifier.args) || verifier.args.length < 2 || verifier.args.length > 8 ||
      verifier.args.some((arg) => typeof arg !== "string" || arg.length > 65536)) fail("invalid host verifier binding");
  const script = verifier.args.at(-2) as string;
  if (!/^recipe-check\.(?:ts|js)$/.test(path.basename(script))) fail("host recipe verifier binding mismatch");
  let recipes: unknown;
  try { recipes = JSON.parse(verifier.args.at(-1) as string); } catch { fail("invalid host recipe definition"); }
  if (!same(recipes, definition.acceptance)) fail("host recipe definition binding mismatch");
  return verifier;
}
function sameInvocation(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return a.command === b.command && same(a.args, b.args);
}

/** Historical evidence projection only: never executes, accepts, applies or repairs. */
export async function reviewDevelopmentCandidate(rawInput: DevelopmentCandidateReviewInput): Promise<DevelopmentCandidateReview> {
  try {
    const input = object(JSON.parse(canonicalizeStableJson(rawInput)));
    if (Object.keys(input).some((key) => !["sourceRepo", "queuePath", "stateRoot", "actionId"].includes(key))) fail("unsupported input");
    const sourceRepo = path.resolve(text(input.sourceRepo));
    const queuePath = path.resolve(text(input.queuePath));
    const stateRoot = path.resolve(text(input.stateRoot));
    const actionId = text(input.actionId, 64);
    if (!/^action_v1_[0-9a-f-]{36}$/.test(actionId)) fail("invalid action identity");
    const store = new WorkItemStore(queuePath);
    const ledgerDirectory = path.join(path.dirname(queuePath), "actions");
    // ActionStore.read may initialize a missing directory. Refuse absent state
    // here so review cannot create a new action store while reporting history.
    const actionFile = await lstat(path.join(ledgerDirectory, "actions.json"));
    if (!actionFile.isFile() || actionFile.isSymbolicLink()) fail("action snapshot is missing or invalid");
    const ledger = new ActionLedger(ledgerDirectory);
    const queue = await store.load();
    const action = await ledger.get(actionId);
    if (action === undefined || action.kind !== "candidate-write" || action.state !== "completed" ||
        action.resultCanonicalJson === undefined) fail("action has no completed candidate receipt");
    const binding = object(JSON.parse(action.inputCanonicalJson));
    const receipt = object(JSON.parse(action.resultCanonicalJson));
    const itemId = text(receipt.itemId, 64);
    const item = queue.items.find((record) => record.definition.id === itemId);
    if (item?.claim === undefined || item.claim.token !== receipt.claimToken) fail("stale or missing task claim");
    if (binding.queueId !== queue.id || binding.itemId !== itemId || binding.claimToken !== receipt.claimToken ||
        binding.sourceRepo !== sourceRepo || binding.sourceRevision !== receipt.sourceRevision ||
        binding.owner !== item.claim.owner || receipt.sourceRevision !== item.claim.baseRevision ||
        !same(binding.definition, item.definition) || action.idempotencyKey !== `${queue.id}:${itemId}:${item.claim.token}`) {
      fail("action/task definition or claim binding mismatch");
    }
    const runId = parseRunId(text(receipt.runId, 64));
    const candidatePath = text(receipt.candidatePath);
    if (!path.isAbsolute(candidatePath) || path.resolve(candidatePath) !== candidatePath || candidatePath === sourceRepo ||
        typeof receipt.accepted !== "boolean" || !Array.isArray(receipt.evidence)) fail("invalid receipt candidate or outcome");
    const evidence = receipt.accepted ? validateWorkItemEvidence(receipt.evidence, item.definition, item.claim, item.claim.baseRevision) : [];
    if (!receipt.accepted && receipt.evidence.length !== 0) fail("unsuccessful receipt carries accepted evidence");
    if (item.evidence !== undefined && !same(item.evidence, evidence)) fail("queue/receipt evidence binding mismatch");
    const criterionIds = item.definition.acceptance.map((recipe) => recipe.id);
    if (criterionIds.length < 1 || criterionIds.length > 8) fail("criterion bound exceeded");
    const common = { schemaVersion: 1 as const, historicalOnly: true as const, reverified: false as const, sourceApplied: false as const,
      queueId: queue.id, queueRevision: queue.revision, actionId, actionVersion: action.version, itemId, itemStatus: item.status,
      baseRevision: item.claim.baseRevision, runId, candidatePath, historicalAccepted: receipt.accepted, criterionIds };
    const stable = async (): Promise<void> => {
      const afterQueue = await store.load();
      const afterAction = await ledger.get(actionId);
      if (afterQueue.revision !== queue.revision || !same(afterQueue, queue) || afterAction?.version !== action.version ||
          !same(afterAction, action)) fail("queue or action version/content changed during review");
    };
    if (receipt.finalArtifactRef === undefined) {
      if (receipt.loopArtifactRef !== undefined) fail("loop reference lacks a final artifact binding");
      await stable();
      return freezeWorkItemValue({ ...common, evidenceStatus: "unavailable", attempts: [] });
    }
    const final = reference(receipt.finalArtifactRef);
    if (final.runId !== runId) fail("final artifact/run binding mismatch");
    const artifacts = new Map<string, Record<string, unknown>>();
    const logs = new Map<RunId, readonly Event[]>();
    const read = async (ref: string, expectedBytes?: unknown): Promise<Record<string, unknown>> => {
      const located = reference(ref);
      if (expectedBytes !== undefined &&
          (await lstat(loopArtifactPath(stateRoot, located.runId, located.id))).size !== expectedBytes) fail("stale artifact byte-length reference");
      const cached = artifacts.get(ref);
      if (cached !== undefined) return cached;
      if (artifacts.size >= 11) fail("artifact reference bound exceeded");
      let body: unknown;
      try { body = await readLoopArtifact(stateRoot, located.runId, located.id, READ_LIMITS); }
      catch { fail("declared artifact is missing, corrupt, oversized or unreadable"); }
      const value = object(body);
      artifacts.set(ref, value);
      return value;
    };
    const requests = async (id: RunId) => {
      let events = logs.get(id);
      if (events === undefined) {
        events = (await new EventStore(stateRoot, id).readAll(READ_LIMITS.eventLogLimits)).events;
        logs.set(id, events);
      }
      return events.filter((event) => event.type === "CHILD_MESSAGE" && event.payload.message.type === "TASK_REQUEST")
        .map((event) => (event as Extract<Event, { type: "CHILD_MESSAGE" }>).payload.message)
        .filter((message) => message.type === "TASK_REQUEST");
    };
    const expectedCriteria = item.definition.acceptance.map((recipe) => ({ id: recipe.id, description: `Host criterion ${recipe.id}`,
      observableCheck: `${recipe.command} ${recipe.args.join(" ")}`.slice(0, 512).trim() }));
    const expectedRequestCriteria = expectedCriteria.map((criterion) => ({ id: criterion.id,
      description: `${criterion.description}; check: ${criterion.observableCheck}` }));
    let loopVerifier: Record<string, unknown> | undefined;
    let stopReason: string | undefined;
    let loopArtifactRef: string | undefined;
    let rows: Record<string, unknown>[];
    if (receipt.loopArtifactRef === undefined) {
      rows = [{ number: 1, runId, accepted: receipt.accepted }];
    } else {
      const located = reference(receipt.loopArtifactRef);
      if (located.runId !== runId || located.ref === final.ref) fail("loop artifact/run binding mismatch");
      loopArtifactRef = located.ref;
      const loop = await read(located.ref);
      if (loop.kind !== "native-write-loop" || loop.schemaVersion !== 1 || loop.candidatePath !== candidatePath ||
          loop.sourceRevision !== item.claim.baseRevision || !Array.isArray(loop.attempts) || loop.attempts.length < 1 ||
          loop.attempts.length > 5 || !Number.isSafeInteger(loop.maxAttempts) || (loop.maxAttempts as number) < loop.attempts.length ||
          (loop.maxAttempts as number) > 5 || !Number.isSafeInteger(loop.maxWallTimeMs) || (loop.maxWallTimeMs as number) < 1 ||
          (loop.maxWallTimeMs as number) > 1_800_000 || typeof loop.stopReason !== "string" || !STOP_REASONS.includes(loop.stopReason)) {
        fail("invalid loop bound, candidate or base binding");
      }
      stopReason = loop.stopReason;
      if ((stopReason === "accepted") !== receipt.accepted) fail("loop/receipt outcome binding mismatch");
      loopVerifier = verifyRecipeBinding(loop.verification, item.definition);
      rows = loop.attempts.map(object);
    }
    const seenRuns = new Set<string>();
    const seenChecks = new Set<string>();
    const attempts: DevelopmentAttemptReview[] = [];
    for (const [index, row] of rows.entries()) {
      const attemptRunId = parseRunId(text(row.runId, 64));
      if (row.number !== index + 1 || seenRuns.has(attemptRunId) || typeof row.accepted !== "boolean" ||
          (index < rows.length - 1 && row.accepted)) fail("invalid attempt identity/order/outcome");
      seenRuns.add(attemptRunId);
      if (row.artifactRef !== undefined) fail("unexpected shadow artifact reference");
      const artifactRef = loopArtifactRef === undefined ? final.ref : nestedReference(attemptRunId, row.artifact);
      if (index === rows.length - 1 && (attemptRunId !== runId || artifactRef !== final.ref || (receipt.accepted && !row.accepted))) {
        fail("last attempt/final receipt binding mismatch");
      }
      if (index === rows.length - 1 && row.accepted && !receipt.accepted && stopReason !== "cancelled" && stopReason !== "time-budget") {
        fail("last accepted attempt contradicts loop stop outcome");
      }
      const body = await read(artifactRef, loopArtifactRef === undefined ? undefined : object(row.artifact).byteLength);
      const verifier = verifyRecipeBinding(body.kind === "ps-p3-closed-loop" ? body : body.verification, item.definition);
      if (loopVerifier !== undefined && !sameInvocation(loopVerifier, verifier)) fail("attempt verifier binding mismatch");
      let check: DevelopmentAttemptReview["check"];
      if (body.kind === "ps-p3-closed-loop") {
        const stored = object(body.check);
        const checkId = text(stored.checkId, 128);
        if (stored.kind !== "command-check" || stored.schemaVersion !== "g1a-v1" || body.schemaVersion !== "g1a-v1" ||
            body.cwd !== candidatePath || body.revision !== item.claim.baseRevision || stored.cwd !== candidatePath ||
            stored.revision !== item.claim.baseRevision || !sameInvocation(stored, verifier) || seenChecks.has(checkId) ||
            !/^check_v2_[0-9a-f-]{36}$/.test(checkId) || typeof stored.ok !== "boolean" || !Number.isSafeInteger(stored.exitCode) ||
            typeof stored.processStatus !== "string" || !PROCESS_STATUSES.includes(stored.processStatus)) fail("check identity/candidate/base binding mismatch");
        for (const fingerprint of [stored.contentFingerprintBefore, stored.contentFingerprintAfter]) {
          if (object(fingerprint).headRevision !== item.claim.baseRevision) fail("check fingerprint/base binding mismatch");
        }
        if (stored.ok && (stored.exitCode !== 0 || stored.processStatus !== "completed" || stored.processSignal !== null || stored.processExitCode !== 0)) {
          fail("check success contradicts host exit evidence");
        }
        if (row.accepted && !stored.ok) fail("attempt acceptance contradicts host check");
        const descriptor = loopVerifier?.trustedVerification;
        if (descriptor !== undefined && object(stored.trustedVerification).descriptorId !== object(descriptor).id) fail("trusted checker identity binding mismatch");
        if (row.accepted && stored.trustedVerification !== undefined && object(stored.trustedVerification).ok !== true) fail("accepted trusted check failed");
        seenChecks.add(checkId);
        check = { checkId, ok: stored.ok, exitCode: stored.exitCode as number, processStatus: stored.processStatus };
      } else if (body.kind !== "native-write-failure" || body.candidatePath !== candidatePath ||
          body.sourceRevision !== item.claim.baseRevision || row.accepted) fail("failure artifact candidate/base binding mismatch");
      const taskRequests = await requests(attemptRunId);
      if (taskRequests.length !== 1 || !same(taskRequests[0]!.acceptanceCriteria, expectedRequestCriteria)) fail("run task/criterion binding mismatch");
      let taskContractArtifactRef: string | undefined;
      if (row.taskContractArtifact !== undefined) {
        taskContractArtifactRef = nestedReference(attemptRunId, row.taskContractArtifact);
        const contract = await read(taskContractArtifactRef, object(row.taskContractArtifact).byteLength);
        if (contract.kind !== "native-write-task-contract" || contract.schemaVersion !== 1 || contract.runId !== attemptRunId ||
            contract.candidatePath !== candidatePath || contract.sourceRevision !== item.claim.baseRevision ||
            contract.definitionOnly !== true || contract.perCriterionVerification !== "UNOBSERVED" ||
            parseTaskId(text(contract.taskId, 64)) !== taskRequests[0]!.taskId || !same(contract.acceptanceCriteria, expectedCriteria) ||
            !sameInvocation(verifyRecipeBinding(contract.verification, item.definition), verifier)) fail("task contract/criterion binding mismatch");
      } else if (loopArtifactRef !== undefined) fail("loop attempt has no declared task contract reference");
      attempts.push({ number: index + 1, runId: attemptRunId, artifactRef, accepted: row.accepted, criterionIds,
        perCriterionVerification: "UNOBSERVED", ...(check === undefined ? {} : { check }),
        ...(taskContractArtifactRef === undefined ? {} : { taskContractArtifactRef }) });
    }
    const finalCheck = attempts.at(-1)!.check;
    for (const entry of evidence) {
      if (entry.artifactRef !== final.ref || entry.checkId !== finalCheck?.checkId || finalCheck.ok !== true || finalCheck.exitCode !== entry.exitCode) {
        fail("receipt evidence/check binding mismatch");
      }
    }
    await stable();
    return freezeWorkItemValue({ ...common, evidenceStatus: "available", finalArtifactRef: final.ref, attempts,
      ...(loopArtifactRef === undefined ? {} : { loopArtifactRef }), ...(stopReason === undefined ? {} : { stopReason }) });
  } catch (error) {
    if (error instanceof DomainValidationError && error.message.startsWith(PREFIX)) throw error;
    // Stored failures, provider text and raw argv are never reflected in errors.
    fail("stored identity, queue, action or evidence is missing or invalid");
  }
}
