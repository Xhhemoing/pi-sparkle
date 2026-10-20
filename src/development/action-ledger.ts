import { randomUUID } from "node:crypto";
import { canonicalizeStableJson, STABLE_JSON_CONTRACT } from "../domain/canonical-json.js";
import { DomainValidationError } from "../domain/errors.js";
import type { AtomicWriteOptions } from "../persist/atomic-file.js";
import type { FileLockOptions } from "../persist/file-lock.js";
import { ActionStore } from "./action-store.js";

export type ActionKind = "candidate-write" | "candidate-check" | "git-commit" | "pull-request" | "candidate-apply";
export type ActionState = "prepared" | "running" | "completed" | "needs-reconciliation" | "failed";
export type ActionResolution = "completed" | "safe-to-retry";

/** Host-owned actual-state references, never a model's self-reported verdict. */
export interface ActionEvidence {
  readonly summary: string;
  readonly references: readonly string[];
}

export interface ActionTransition {
  readonly version: number;
  readonly state: ActionState;
  readonly attempt: number;
  readonly at: string;
  readonly evidence?: ActionEvidence;
  readonly resolution?: ActionResolution;
  readonly workerStopped?: true;
}

export interface ActionRecord {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly kind: ActionKind;
  /** Immutable strict canonical JSON, directly compared; not a digest. */
  readonly inputCanonicalJson: string;
  readonly state: ActionState;
  readonly version: number;
  readonly attempt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly claimToken?: string;
  /** Latest host checkpoint or final receipt, bounded to 64 KiB. */
  readonly resultCanonicalJson?: string;
  readonly history: readonly ActionTransition[];
}

export interface ActionClaim {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly version: number;
  readonly token: string;
}

/** A refused admission is availability evidence, never permission to retry its effect. */
export class ActionAdmissionConflictError extends DomainValidationError {
  constructor(readonly blockingActionId: string) {
    super(`action ledger: effect ${blockingActionId} requires reconciliation or settlement before overlapping admission`);
    this.name = "ActionAdmissionConflictError";
  }
}

export interface ActionReceipt {
  readonly evidence: ActionEvidence;
  readonly result?: unknown;
}

export interface ActionRecovery {
  readonly expectedVersion: number;
  /** Explicit host attestation, after process/job termination is observed. */
  readonly workerStopped: true;
  readonly evidence: ActionEvidence;
}

export interface ActionReconciliation extends ActionRecovery {
  /** safe-to-retry attests the effect is confirmed absent, not merely unknown. */
  readonly resolution: ActionResolution;
  readonly result?: unknown;
}

export interface ActionLedgerOptions extends FileLockOptions {
  /** Explicit opt-in for a fresh schema2 directory; never migrates schema1. */
  readonly completedCheckArchive?: boolean;
  /** Existing atomic rename test seam. Does not alter fixed snapshot permissions. */
  readonly rename?: AtomicWriteOptions["rename"];
}

interface ActionSnapshotV1 {
  readonly schemaVersion: 1;
  readonly canonicalization: typeof STABLE_JSON_CONTRACT;
  readonly actions: readonly ActionRecord[];
}

interface ActionSnapshotV2 {
  readonly schemaVersion: 2;
  readonly canonicalization: typeof STABLE_JSON_CONTRACT;
  readonly actions: readonly ActionRecord[];
  readonly archivedChecks: readonly ActionRecord[];
}
type ActionSnapshot = ActionSnapshotV1 | ActionSnapshotV2;

const KINDS: readonly ActionKind[] = ["candidate-write", "candidate-check", "git-commit", "pull-request", "candidate-apply"];
const STATES: readonly ActionState[] = ["prepared", "running", "completed", "needs-reconciliation", "failed"];
const ID = /^action_v1_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^claim_v1_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ACTIONS = 1024;
const MAX_ARCHIVED_CHECKS = 4096;
const MAX_HISTORY = 256;

function fail(message: string): never { throw new DomainValidationError(`action ledger: ${message}`); }
function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function text(value: unknown, label: string, maxBytes: number): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || Buffer.byteLength(value) > maxBytes) {
    fail(`${label} must be nonempty and at most ${maxBytes} bytes`);
  }
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(`unknown ${label} field`);
}
function json(value: unknown, label: string): string {
  const canonical = canonicalizeStableJson(value);
  if (Buffer.byteLength(canonical) > 65_536) fail(`${label} exceeds 64 KiB`);
  return canonical;
}
function canonicalField(value: unknown, label: string): asserts value is string {
  text(value, label, 65_536);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail(`${label} is invalid JSON`); }
  if (json(parsed, label) !== value) fail(`${label} is not canonical JSON`);
}
function evidence(value: unknown): ActionEvidence {
  // Snapshot before any await; reject accessors and unsupported JS values.
  const snapshot = object(JSON.parse(json(value, "evidence")), "evidence");
  text(snapshot.summary, "evidence summary", 2_048);
  if (!Array.isArray(snapshot.references) || snapshot.references.length < 1 || snapshot.references.length > 32) {
    fail("evidence requires 1..32 host-state references");
  }
  for (const ref of snapshot.references) text(ref, "evidence reference", 2_048);
  if (Object.keys(snapshot).some((key) => key !== "summary" && key !== "references")) fail("unknown evidence field");
  return snapshot as unknown as ActionEvidence;
}
function receipt(value: ActionReceipt): { evidence: ActionEvidence; resultCanonicalJson?: string } {
  return { evidence: evidence(value.evidence), ...(value.result === undefined ? {} : { resultCanonicalJson: json(value.result, "result") }) };
}
function version(value: number): void { if (!integer(value, 1)) fail("expectedVersion must be a positive safe integer"); }
function stopped(value: unknown): void { if (value !== true) fail("host must attest the previous worker stopped"); }
function timestamp(value: unknown): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid action timestamp");
}

function validateSnapshot(value: unknown, archive: boolean): ActionSnapshot {
  const snapshot = object(value, "snapshot");
  if (snapshot.schemaVersion !== (archive ? 2 : 1) || snapshot.canonicalization !== STABLE_JSON_CONTRACT) fail("unsupported action schema");
  fields(snapshot, archive ? ["schemaVersion", "canonicalization", "actions", "archivedChecks"] : ["schemaVersion", "canonicalization", "actions"], "snapshot");

  if (!Array.isArray(snapshot.actions) || snapshot.actions.length > MAX_ACTIONS) fail("invalid action collection");
  const archivedChecks = archive ? snapshot.archivedChecks : [];
  if (!Array.isArray(archivedChecks) || archivedChecks.length > MAX_ARCHIVED_CHECKS) fail("invalid archived check collection");
  for (const value of archivedChecks) {
    const record = object(value, "archived check");
    if (record.kind !== "candidate-check" || record.state !== "completed") fail("only completed candidate-check records may be archived");
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const raw of [...snapshot.actions, ...archivedChecks]) {
    const record = object(raw, "action");
    fields(record, ["actionId", "idempotencyKey", "kind", "inputCanonicalJson", "state", "version", "attempt", "createdAt", "updatedAt", "claimToken", "resultCanonicalJson", "history"], "action");
    text(record.actionId, "actionId", 64);
    text(record.idempotencyKey, "idempotencyKey", 256);
    if (!ID.test(record.actionId) || ids.has(record.actionId) || keys.has(record.idempotencyKey)) fail("invalid or duplicate action identity");
    ids.add(record.actionId); keys.add(record.idempotencyKey);
    if (!KINDS.includes(record.kind as ActionKind) || !STATES.includes(record.state as ActionState)) fail("invalid action kind/state");
    canonicalField(record.inputCanonicalJson, "inputCanonicalJson");
    if (record.resultCanonicalJson !== undefined) canonicalField(record.resultCanonicalJson, "resultCanonicalJson");
    if (!integer(record.version, 1) || !integer(record.attempt, 0)) fail("invalid action version/attempt");
    timestamp(record.createdAt); timestamp(record.updatedAt);
    if (record.state === "running") {
      if (typeof record.claimToken !== "string" || !TOKEN.test(record.claimToken)) fail("running action has no valid claim");
    } else if (record.claimToken !== undefined) fail("inactive action carries a claim");
    if (!Array.isArray(record.history) || record.history.length !== record.version || record.history.length > MAX_HISTORY) fail("invalid action history");
    let prior: ActionTransition | undefined;
    for (const [index, entry] of record.history.entries()) {
      const rawStep = object(entry, "transition");
      fields(rawStep, ["version", "state", "attempt", "at", "evidence", "resolution", "workerStopped"], "transition");
      const step = rawStep as unknown as ActionTransition;
      if (step.version !== index + 1 || !STATES.includes(step.state) || !integer(step.attempt, 0)) fail("invalid transition version/state");
      timestamp(step.at);
      if (step.evidence !== undefined) evidence(step.evidence);
      if (step.workerStopped !== undefined && step.workerStopped !== true) fail("invalid worker attestation");
      if (prior === undefined) {
        if (step.state !== "prepared" || step.attempt !== 0 || step.at !== record.createdAt) fail("action must begin prepared");
        if (step.evidence !== undefined || step.resolution !== undefined || step.workerStopped !== undefined) fail("initial prepared transition has unexpected metadata");
      } else {
        const valid = prior.state === "prepared" ? step.state === "running"
          : prior.state === "running" ? ["running", "completed", "failed", "needs-reconciliation"].includes(step.state)
            : prior.state === "needs-reconciliation" ? ["prepared", "completed"].includes(step.state)
              : false;
        if (!valid) fail("invalid action state transition");
        const expectedAttempt = prior.attempt + (prior.state === "prepared" && step.state === "running" ? 1 : 0);
        if (step.attempt !== expectedAttempt) fail("invalid transition attempt");
        if (prior.state === "prepared" && (step.evidence !== undefined || step.resolution !== undefined || step.workerStopped !== undefined)) fail("claim transition has unexpected metadata");
        if (!(prior.state === "prepared" && step.state === "running") && step.evidence === undefined) fail("transition requires host evidence");
        if (prior.state === "needs-reconciliation") {
          if (step.workerStopped !== true || step.resolution !== (step.state === "prepared" ? "safe-to-retry" : "completed")) fail("reconciliation requires explicit host resolution");
        } else if (step.resolution !== undefined) fail("unexpected reconciliation resolution");
        if (step.workerStopped !== undefined && prior.state !== "needs-reconciliation" && !(prior.state === "running" && step.state === "needs-reconciliation")) fail("unexpected worker attestation metadata");
      }
      prior = step;
    }
    if (prior === undefined || prior.state !== record.state || prior.attempt !== record.attempt || prior.at !== record.updatedAt) fail("action history does not match current state");
  }
  return snapshot as unknown as ActionSnapshot;
}

function allActions(snapshot: ActionSnapshot): readonly ActionRecord[] {
  return snapshot.schemaVersion === 1 ? snapshot.actions : [...snapshot.actions, ...snapshot.archivedChecks];
}

/** Only new full-capacity admission may compact, in one atomic snapshot. */
function admissionSnapshot(snapshot: ActionSnapshot): ActionSnapshot {
  if (snapshot.actions.length < MAX_ACTIONS) return snapshot;
  if (snapshot.schemaVersion !== 2) fail("action collection limit reached");
  let remaining = MAX_ARCHIVED_CHECKS - snapshot.archivedChecks.length;
  const actions: ActionRecord[] = []; const moved: ActionRecord[] = [];
  for (const record of snapshot.actions) {
    if (remaining > 0 && record.kind === "candidate-check" && record.state === "completed") {
      moved.push(record); remaining--;
    } else actions.push(record);
  }
  if (moved.length === 0) fail("action collection limit reached; completed-check archive capacity unavailable");
  return { ...snapshot, actions, archivedChecks: [...snapshot.archivedChecks, ...moved] };
}

export function createActionIdempotencyKey(): string { return `idempotency_v1_${randomUUID()}`; }

/**
 * An explicit host effect ledger. prepare and claim MUST resolve before the
 * caller invokes its effect. No method invokes, retries, or authorizes effects.
 * Running records survive restart unchanged and require host reconciliation.
 */
export class ActionLedger {
  private readonly store: ActionStore<ActionSnapshot>;
  constructor(directory: string, options: ActionLedgerOptions = {}) {
    if (options === null || typeof options !== "object" || Array.isArray(options) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
        Reflect.ownKeys(options).some((key) => typeof key !== "string" || !["timeoutMs", "retryMs", "completedCheckArchive", "rename"].includes(key)) ||
        Object.values(Object.getOwnPropertyDescriptors(options)).some((field) => field.get !== undefined || field.set !== undefined)) fail("invalid ledger options");
    if (options.completedCheckArchive !== undefined && typeof options.completedCheckArchive !== "boolean") fail("invalid completed-check archive mode");
    if (options.rename !== undefined && typeof options.rename !== "function") fail("invalid atomic publication option");
    const archive = options.completedCheckArchive === true;
    const lock = Object.freeze({ ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.retryMs === undefined ? {} : { retryMs: options.retryMs }) });
    this.store = new ActionStore(directory, (value) => validateSnapshot(value, archive),
      (): ActionSnapshot => archive ? { schemaVersion: 2, canonicalization: STABLE_JSON_CONTRACT, actions: [], archivedChecks: [] }
        : { schemaVersion: 1, canonicalization: STABLE_JSON_CONTRACT, actions: [] }, lock,
      { persistEmpty: archive, ...(options.rename === undefined ? {} : { rename: options.rename }) });
  }

  async prepare(input: { idempotencyKey: string; kind: ActionKind; input: unknown }): Promise<ActionRecord> {
    text(input.idempotencyKey, "idempotencyKey", 256);
    if (!KINDS.includes(input.kind)) fail("unknown action kind");
    const idempotencyKey = input.idempotencyKey;
    const kind = input.kind;
    const inputCanonicalJson = json(input.input, "input");
    return this.store.update((snapshot) => {
      const prior = allActions(snapshot).find((action) => action.idempotencyKey === idempotencyKey);
      if (prior !== undefined) {
        if (prior.kind !== kind || prior.inputCanonicalJson !== inputCanonicalJson) fail("idempotency key identity mismatch");
        return { state: snapshot, result: prior, changed: false };
      }
      const admitted = admissionSnapshot(snapshot);
      const at = new Date().toISOString();
      const record: ActionRecord = { actionId: `action_v1_${randomUUID()}`, idempotencyKey, kind, inputCanonicalJson,
        state: "prepared", version: 1, attempt: 0, createdAt: at, updatedAt: at,
        history: [{ version: 1, state: "prepared", attempt: 0, at }] };
      return { state: { ...admitted, actions: [...admitted.actions, record] }, result: record, changed: true };
    });
  }

  /**
   * Host-only atomic admission across actions. The synchronous conflict predicate
   * sees running/uncertain records under the existing metadata lock. No rejected
   * attempt leaves a prepared row, and no effect executes while the lock is held.
   * A returned claim must be retained even if cancellation follows publication.
   */
  async admit(
    input: { idempotencyKey: string; kind: ActionKind; input: unknown },
    conflictsWith: (record: ActionRecord) => boolean,
    signal?: AbortSignal
  ): Promise<ActionClaim> {
    text(input.idempotencyKey, "idempotencyKey", 256);
    if (!KINDS.includes(input.kind)) fail("unknown action kind");
    if (typeof conflictsWith !== "function") fail("host conflict predicate is required");
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail("invalid admission signal");
    const { idempotencyKey, kind } = input;
    const inputCanonicalJson = json(input.input, "input");
    return this.store.update((snapshot) => {
      if (signal?.aborted) fail("admission cancelled before publication");
      const prior = allActions(snapshot).find((record) => record.idempotencyKey === idempotencyKey);
      if (prior !== undefined && (prior.kind !== kind || prior.inputCanonicalJson !== inputCanonicalJson)) fail("idempotency key identity mismatch");
      if (prior !== undefined && prior.state !== "prepared") fail("only a prepared action may be admitted; reconcile running/uncertain actions; terminal effects are never replayed");
      const conflict = snapshot.actions.find((record) =>
        (record.state === "running" || record.state === "needs-reconciliation") && conflictsWith(record));
      if (conflict !== undefined) throw new ActionAdmissionConflictError(conflict.actionId);
      const admitted = prior === undefined ? admissionSnapshot(snapshot) : snapshot;
      const at = new Date().toISOString();
      const prepared: ActionRecord = prior ?? { actionId: `action_v1_${randomUUID()}`, idempotencyKey, kind, inputCanonicalJson,
        state: "prepared", version: 1, attempt: 0, createdAt: at, updatedAt: at,
        history: [{ version: 1, state: "prepared", attempt: 0, at }] };
      const running = this.next(prepared, "running", { claimToken: `claim_v1_${randomUUID()}`, attempt: prepared.attempt + 1 });
      return { state: { ...admitted, actions: prior === undefined ? [...admitted.actions, running]
        : admitted.actions.map((record) => record.actionId === prior.actionId ? running : record) },
      result: this.asClaim(running), changed: true };
    });
  }

  async get(actionId: string): Promise<ActionRecord | undefined> {
    return allActions(await this.store.read()).find((action) => action.actionId === actionId);
  }
  async list(): Promise<readonly ActionRecord[]> { return allActions(await this.store.read()); }

  async claim(actionId: string, expectedVersion: number): Promise<ActionClaim> {
    const record = await this.change(actionId, expectedVersion, (current) => {
      if (current.state !== "prepared") fail("only a prepared action may be claimed; reconcile running/uncertain actions");
      return this.next(current, "running", { claimToken: `claim_v1_${randomUUID()}`, attempt: current.attempt + 1 });
    });
    return this.asClaim(record);
  }

  async checkpoint(claim: ActionClaim, value: ActionReceipt): Promise<ActionClaim> {
    const checked = receipt(value);
    return this.asClaim(await this.settle(claim, "running", checked));
  }
  async complete(claim: ActionClaim, value: ActionReceipt): Promise<ActionRecord> { return this.settle(claim, "completed", receipt(value)); }
  async fail(claim: ActionClaim, value: ActionReceipt): Promise<ActionRecord> { return this.settle(claim, "failed", receipt(value)); }
  async markUncertain(claim: ActionClaim, value: ActionReceipt): Promise<ActionRecord> { return this.settle(claim, "needs-reconciliation", receipt(value)); }

  async recoverInterrupted(actionId: string, input: ActionRecovery): Promise<ActionRecord> {
    stopped(input.workerStopped);
    const proof = evidence(input.evidence);
    return this.change(actionId, input.expectedVersion, (current) => {
      if (current.state !== "running") fail("only a running action requires interrupted-worker recovery");
      return this.next(current, "needs-reconciliation", { evidence: proof, workerStopped: true });
    });
  }

  async reconcile(actionId: string, input: ActionReconciliation): Promise<ActionRecord> {
    stopped(input.workerStopped);
    const checked = receipt(input);
    const resolution = input.resolution;
    if (resolution !== "completed" && resolution !== "safe-to-retry") fail("explicit host reconciliation resolution required");
    return this.change(actionId, input.expectedVersion, (current) => {
      if (current.state !== "needs-reconciliation") fail("only needs-reconciliation actions may be reconciled");
      return this.next(current, resolution === "completed" ? "completed" : "prepared", { ...checked, resolution, workerStopped: true });
    });
  }

  private async settle(claim: ActionClaim, state: ActionState, checked: { evidence: ActionEvidence; resultCanonicalJson?: string }): Promise<ActionRecord> {
    const token = claim.token;
    const key = claim.idempotencyKey;
    return this.change(claim.actionId, claim.version, (current) => {
      if (current.state !== "running" || current.claimToken !== token || current.idempotencyKey !== key) fail("stale or invalid action claim");
      return this.next(current, state, { ...checked, ...(state === "running" ? { claimToken: token } : {}) });
    });
  }

  private async change(actionId: string, expectedVersion: number, update: (record: ActionRecord) => ActionRecord): Promise<ActionRecord> {
    version(expectedVersion);
    if (!ID.test(actionId)) fail("invalid actionId");
    return this.store.update((snapshot) => {
      const current = allActions(snapshot).find((record) => record.actionId === actionId);
      if (current === undefined) fail("unknown actionId");
      if (current.version !== expectedVersion) fail("stale action version");
      if (snapshot.schemaVersion === 2 && snapshot.archivedChecks.some((record) => record.actionId === actionId)) fail("archived completed check is terminal and cannot transition");
      const record = update(current);
      return { state: { ...snapshot, actions: snapshot.actions.map((entry) => entry.actionId === actionId ? record : entry) }, result: record, changed: true };
    });
  }

  private next(current: ActionRecord, state: ActionState, fields: {
    claimToken?: string; attempt?: number; evidence?: ActionEvidence; resultCanonicalJson?: string; resolution?: ActionResolution; workerStopped?: true;
  }): ActionRecord {
    if (current.history.length >= MAX_HISTORY) fail("action history limit reached; explicit host intervention required");
    const at = new Date().toISOString();
    const nextVersion = current.version + 1;
    const attempt = fields.attempt ?? current.attempt;
    const { claimToken: _oldClaim, ...base } = current;
    const transition: ActionTransition = { version: nextVersion, state, attempt, at,
      ...(fields.evidence === undefined ? {} : { evidence: fields.evidence }),
      ...(fields.resolution === undefined ? {} : { resolution: fields.resolution }),
      ...(fields.workerStopped === undefined ? {} : { workerStopped: fields.workerStopped }) };
    return { ...base, state, version: nextVersion, attempt, updatedAt: at,
      ...(fields.claimToken === undefined ? {} : { claimToken: fields.claimToken }),
      ...(fields.resultCanonicalJson === undefined ? {} : { resultCanonicalJson: fields.resultCanonicalJson }),
      history: [...current.history, transition] };
  }

  private asClaim(record: ActionRecord): ActionClaim {
    if (record.claimToken === undefined) fail("running claim missing after publication");
    return { actionId: record.actionId, idempotencyKey: record.idempotencyKey, version: record.version, token: record.claimToken };
  }
}
