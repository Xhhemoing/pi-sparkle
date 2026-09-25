import { randomUUID } from "node:crypto";
import { DomainValidationError } from "../domain/errors.js";
import type { EvaluationOutcome } from "../evaluation/types.js";
import { stableStringify } from "./manifest.js";

const OPAQUE_ID = /^[a-z0-9]+_v2_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ReadonlyArmManifest {
  readonly id: "A" | "B" | "C";
  readonly armManifestId: string;
  readonly runtimeIdentity: string;
  readonly toolSchemaReference: string;
  readonly routingMode: "disabled" | "frozen-snapshot";
  readonly routingSnapshotReference?: string | undefined;
  readonly routingSnapshotCanonicalJson?: string | undefined;
  readonly loadedPolicyCanonicalJson?: string | undefined;
  readonly learnedRouting: "disabled" | "frozen-snapshot";
  readonly projection: "off" | "on";
  readonly declaredSchemaDifference?: "projection-recall-tool" | undefined;
}

export interface ReadonlyEvaluatorManifest {
  readonly schemaVersion: "readonly-evaluator-v2";
  readonly manifestId: string;
  readonly experimentId: string;
  readonly taskSetId: string;
  readonly taskSetReference: string;
  readonly repositoryRevisions: readonly { readonly repository: string; readonly revision: string }[];
  readonly evaluatorBundleReference: string;
  readonly evaluatorBundleCanonicalJson: string;
  readonly evaluatorResultSchema: string;
  readonly runtimeIdentity: string;
  readonly toolSchemaReference: string;
  readonly policyReference: string;
  readonly boundaryDesignRecordId: string;
  readonly armManifests: readonly ReadonlyArmManifest[];
  readonly retryPolicy: {
    readonly taskAttemptsPerScheduledRun: 1;
    readonly providerAttemptsUpperBoundPerExecute: 3;
    readonly providerRetryScope: "one-PiAgentExecutor.execute";
    readonly providerRetryIsGlobal: false;
  };
  readonly protocolLimitations: { readonly taskAttemptEnforcement: "not-implemented" };
  readonly routingMode: "disabled" | "frozen-snapshot";
  readonly routingSnapshotReference?: string | undefined;
  readonly routingSnapshotCanonicalJson?: string | undefined;
  readonly loadedPolicyCanonicalJson?: string | undefined;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion?: string | undefined;
  readonly budget: { readonly maxUsd?: number | undefined; readonly maxCalls?: number | undefined };
  readonly environmentReference: string;
  readonly retentionClass: string;
  readonly dataTransferPolicy: string;
  readonly createdAt: string;
  readonly issuesApplyCapability: false;
}

export interface ReadonlyTaskLedgerRow {
  readonly manifestId: string;
  readonly armManifestId: string;
  readonly taskId: string;
  readonly status: "valid" | "INVALID_COLLECTION" | "UNOBSERVED";
}

export interface FrozenReadonlyEvaluatorManifest {
  readonly manifest: ReadonlyEvaluatorManifest;
  readonly canonicalJson: string;
}

export interface ReadonlyPilotResult {
  readonly manifestId: string;
  readonly armManifestId: string;
  readonly taskId: string;
  readonly outcome: EvaluationOutcome;
}

export interface ReadonlyLedgerInput {
  readonly manifest: ReadonlyEvaluatorManifest;
  readonly armId: "A" | "B" | "C";
  readonly taskId: string;
  readonly observedEvaluatorCanonicalJson?: string | undefined;
  readonly observedRoutingCanonicalJson?: string | undefined;
  readonly observedLoadedPolicyCanonicalJson?: string | undefined;
  readonly dataPolicyMatches: boolean;
}

export function opaqueId(prefix: "manifest" | "arm" | "stage0" | "eval" | "taskset" | "route"): string {
  return `${prefix}_v2_${randomUUID()}`;
}

function fail(message: string): never {
  throw new DomainValidationError(message);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is required`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePositiveFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${label} must be positive and finite`);
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireCanonicalJson(value: unknown, label: string): string {
  const text = requireText(value, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail(`${label} must be canonical JSON`);
  }
  if (stableStringify(parsed) !== text) fail(`${label} must be canonical JSON`);
  return text;
}

function requireCanonicalInstant(value: unknown, label: string): string {
  const text = requireText(value, label);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== text) {
    fail(`${label} must be a canonical ISO-8601 instant`);
  }
  return text;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`unknown ${label} field: ${key}`);
  }
}

function requireOpaque(value: unknown, label: string, prefix: string): string {
  const text = requireText(value, label);
  if (!text.startsWith(`${prefix}_v2_`) || !OPAQUE_ID.test(text)) fail(`${label} must be an opaque ${prefix}_v2_ locator`);
  return text;
}

function routingTuple(record: {
  readonly routingMode: string;
  readonly routingSnapshotReference?: string | undefined;
  readonly routingSnapshotCanonicalJson?: string | undefined;
  readonly loadedPolicyCanonicalJson?: string | undefined;
}, label: string): void {
  const present = [
    record.routingSnapshotReference,
    record.routingSnapshotCanonicalJson,
    record.loadedPolicyCanonicalJson
  ].filter((value) => value !== undefined);
  if (record.routingMode === "disabled") {
    if (present.length !== 0) fail(`${label} disabled routing must omit the routing tuple`);
    return;
  }
  if (record.routingMode !== "frozen-snapshot") fail(`${label} routingMode is invalid`);
  if (present.length !== 3 || present.some((value) => typeof value !== "string" || value.trim() === "")) {
    fail(`${label} frozen routing requires the complete canonical tuple`);
  }
  requireOpaque(record.routingSnapshotReference, `${label} routingSnapshotReference`, "route");
}

export function validateReadonlyEvaluatorManifest(manifest: ReadonlyEvaluatorManifest): void {
  if (!isRecord(manifest)) fail("readonly evaluator manifest must be an object");
  rejectUnknownFields(manifest, [
    "schemaVersion", "manifestId", "experimentId", "taskSetId", "taskSetReference",
    "repositoryRevisions", "evaluatorBundleReference", "evaluatorBundleCanonicalJson",
    "evaluatorResultSchema", "runtimeIdentity", "toolSchemaReference", "policyReference",
    "boundaryDesignRecordId", "armManifests", "retryPolicy", "protocolLimitations",
    "routingMode", "routingSnapshotReference", "routingSnapshotCanonicalJson",
    "loadedPolicyCanonicalJson", "provider", "model", "modelVersion", "budget", "environmentReference",
    "retentionClass", "dataTransferPolicy", "createdAt", "issuesApplyCapability"
  ], "manifest");
  if (manifest.schemaVersion !== "readonly-evaluator-v2") fail("unsupported readonly evaluator schema");
  requireOpaque(manifest.manifestId, "manifestId", "manifest");
  requireText(manifest.experimentId, "experimentId");
  requireText(manifest.taskSetId, "taskSetId");
  requireOpaque(manifest.boundaryDesignRecordId, "boundaryDesignRecordId", "stage0");
  requireOpaque(manifest.evaluatorBundleReference, "evaluatorBundleReference", "eval");
  requireOpaque(manifest.taskSetReference, "taskSetReference", "taskset");
  requireCanonicalJson(manifest.evaluatorBundleCanonicalJson, "evaluatorBundleCanonicalJson");
  requireText(manifest.evaluatorResultSchema, "evaluatorResultSchema");
  requireText(manifest.runtimeIdentity, "runtimeIdentity");
  requireText(manifest.toolSchemaReference, "toolSchemaReference");
  requireText(manifest.policyReference, "policyReference");
  requireText(manifest.provider, "provider");
  requireText(manifest.model, "model");
  if (manifest.modelVersion !== undefined) requireText(manifest.modelVersion, "modelVersion");
  requireText(manifest.environmentReference, "environmentReference");
  requireText(manifest.retentionClass, "retentionClass");
  requireText(manifest.dataTransferPolicy, "dataTransferPolicy");
  requireCanonicalInstant(manifest.createdAt, "createdAt");
  if (manifest.issuesApplyCapability !== false) fail("readonly evaluator manifest cannot issue an apply capability");
  if (!Array.isArray(manifest.repositoryRevisions) || manifest.repositoryRevisions.length === 0) fail("repositoryRevisions are required");
  for (const revision of manifest.repositoryRevisions) {
    if (!isRecord(revision)) fail("repositoryRevisions entries must be objects");
    rejectUnknownFields(revision, ["repository", "revision"], "repositoryRevisions");
    requireText(revision.repository, "repositoryRevisions.repository");
    requireText(revision.revision, "repositoryRevisions.revision");
  }
  if (!Array.isArray(manifest.armManifests) || manifest.armManifests.length !== 3) fail("armManifests must contain A, B, and C");
  const arms: ReadonlyArmManifest[] = [];
  for (const candidate of manifest.armManifests) {
    if (!isRecord(candidate)) fail("arm manifest entries must be objects");
    const arm = candidate as unknown as ReadonlyArmManifest;
    rejectUnknownFields(candidate, [
      "id", "armManifestId", "runtimeIdentity", "toolSchemaReference", "routingMode",
      "routingSnapshotReference", "routingSnapshotCanonicalJson", "loadedPolicyCanonicalJson",
      "learnedRouting", "projection", "declaredSchemaDifference"
    ], `${String(candidate.id)} arm`);
    if (arm.id !== "A" && arm.id !== "B" && arm.id !== "C") fail("arm manifest id is invalid");
    arms.push(arm);
    requireOpaque(arm.armManifestId, `${arm.id} armManifestId`, "arm");
    requireText(arm.runtimeIdentity, `${arm.id} runtimeIdentity`);
    requireText(arm.toolSchemaReference, `${arm.id} toolSchemaReference`);
    if (arm.routingSnapshotCanonicalJson !== undefined) {
      requireCanonicalJson(arm.routingSnapshotCanonicalJson, `${arm.id} routingSnapshotCanonicalJson`);
    }
    if (arm.loadedPolicyCanonicalJson !== undefined) {
      requireCanonicalJson(arm.loadedPolicyCanonicalJson, `${arm.id} loadedPolicyCanonicalJson`);
    }
    if (arm.projection !== "off" && arm.projection !== "on") fail(`${arm.id} projection is invalid`);
    routingTuple(arm, arm.id);
    if (arm.learnedRouting !== arm.routingMode) fail(`${arm.id} learnedRouting must match routingMode`);
    if (arm.id === "A" && (arm.routingMode !== "disabled" || arm.projection !== "off")) {
      fail("arm A must disable learned routing and projection");
    }
    if (arm.id === "B" && arm.projection !== "off") fail("arm B must keep projection off");
    if (arm.id !== "C" && arm.declaredSchemaDifference !== undefined) {
      fail("only arm C may declare the projection recall tool difference");
    }
    if (arm.id === "C" && arm.declaredSchemaDifference !== "projection-recall-tool") {
      fail("arm C must declare the projection recall tool difference");
    }
  }
  const ids = arms.map((arm) => arm.id);
  if (ids.join(",") !== "A,B,C") fail("armManifests must be ordered A, B, C");
  const armB = arms[1]!;
  const armC = arms[2]!;
  if (
    armB.routingSnapshotReference !== armC.routingSnapshotReference
    || armB.routingSnapshotCanonicalJson !== armC.routingSnapshotCanonicalJson
    || armB.loadedPolicyCanonicalJson !== armC.loadedPolicyCanonicalJson
  ) {
    fail("arms B and C must share the frozen routing tuple");
  }
  if (manifest.routingSnapshotCanonicalJson !== undefined) {
    requireCanonicalJson(manifest.routingSnapshotCanonicalJson, "routingSnapshotCanonicalJson");
  }
  if (manifest.loadedPolicyCanonicalJson !== undefined) {
    requireCanonicalJson(manifest.loadedPolicyCanonicalJson, "loadedPolicyCanonicalJson");
  }
  routingTuple(manifest, "common");
  if (!isRecord(manifest.retryPolicy)) fail("retryPolicy is required");
  rejectUnknownFields(manifest.retryPolicy, [
    "taskAttemptsPerScheduledRun", "providerAttemptsUpperBoundPerExecute",
    "providerRetryScope", "providerRetryIsGlobal"
  ], "retryPolicy");
  const retry = manifest.retryPolicy;
  if (
    retry.taskAttemptsPerScheduledRun !== 1
    || retry.providerAttemptsUpperBoundPerExecute !== 3
    || retry.providerRetryScope !== "one-PiAgentExecutor.execute"
    || retry.providerRetryIsGlobal !== false
  ) fail("retry policy does not match the frozen read-only contract");
  if (!isRecord(manifest.protocolLimitations)) fail("protocolLimitations is required");
  rejectUnknownFields(manifest.protocolLimitations, ["taskAttemptEnforcement"], "protocolLimitations");
  if (manifest.protocolLimitations.taskAttemptEnforcement !== "not-implemented") {
    fail("task attempt enforcement must stay an explicit protocol limitation");
  }
  if (!isRecord(manifest.budget)) fail("budget is required");
  rejectUnknownFields(manifest.budget, ["maxUsd", "maxCalls"], "budget");
  if (manifest.budget.maxUsd === undefined && manifest.budget.maxCalls === undefined) {
    fail("budget must define maxUsd or maxCalls");
  }
  if (manifest.budget.maxUsd !== undefined) requirePositiveFinite(manifest.budget.maxUsd, "budget.maxUsd");
  if (manifest.budget.maxCalls !== undefined) requirePositiveSafeInteger(manifest.budget.maxCalls, "budget.maxCalls");
}

export function freezeReadonlyEvaluatorManifest(manifest: ReadonlyEvaluatorManifest): FrozenReadonlyEvaluatorManifest {
  validateReadonlyEvaluatorManifest(manifest);
  const canonicalJson = stableStringify(manifest);
  const detached = JSON.parse(canonicalJson) as ReadonlyEvaluatorManifest;
  return deepFreeze({ manifest: deepFreeze(detached), canonicalJson });
}

export function assertEvaluatorUnmodified(input: {
  readonly manifest: ReadonlyEvaluatorManifest;
  readonly observedCanonicalJson: string;
  readonly attemptedWrite: boolean;
}): void {
  if (input.attemptedWrite) fail("candidate write to the authoritative evaluator is refused");
  if (input.observedCanonicalJson !== input.manifest.evaluatorBundleCanonicalJson) {
    fail("evaluator canonical bytes changed");
  }
}

export function collectReadonlyLedgerRow(input: ReadonlyLedgerInput): ReadonlyTaskLedgerRow {
  validateReadonlyEvaluatorManifest(input.manifest);
  const arm = input.manifest.armManifests.find((candidate) => candidate.id === input.armId);
  if (arm === undefined) fail(`unknown arm ${input.armId}`);
  const taskId = input.taskId.trim();
  if (taskId === "") {
    return {
      manifestId: input.manifest.manifestId,
      armManifestId: arm.armManifestId,
      taskId: input.taskId,
      status: "INVALID_COLLECTION"
    };
  }
  if (input.observedEvaluatorCanonicalJson === undefined) {
    return {
      manifestId: input.manifest.manifestId,
      armManifestId: arm.armManifestId,
      taskId,
      status: "UNOBSERVED"
    };
  }
  const routingMatches = arm.routingMode === "disabled"
    ? input.observedRoutingCanonicalJson === undefined && input.observedLoadedPolicyCanonicalJson === undefined
    : (
      input.observedRoutingCanonicalJson === arm.routingSnapshotCanonicalJson
      && input.observedLoadedPolicyCanonicalJson === arm.loadedPolicyCanonicalJson
    );
  const valid = input.dataPolicyMatches
    && routingMatches
    && input.observedEvaluatorCanonicalJson === input.manifest.evaluatorBundleCanonicalJson
    && taskId !== "";
  return {
    manifestId: input.manifest.manifestId,
    armManifestId: arm.armManifestId,
    taskId,
    status: valid ? "valid" : "INVALID_COLLECTION"
  };
}

export function collectReadonlyLedger(inputs: readonly ReadonlyLedgerInput[]): readonly ReadonlyTaskLedgerRow[] {
  const seen = new Set<string>();
  return inputs.map((input) => {
    const taskId = input.taskId.trim();
    const key = `${input.armId}\u0000${taskId}`;
    if (seen.has(key)) fail(`duplicate readonly ledger task: ${input.armId}/${taskId}`);
    seen.add(key);
    return collectReadonlyLedgerRow(input);
  });
}

export function bindReadonlyPilotResult(input: {
  readonly manifest: ReadonlyEvaluatorManifest;
  readonly ledgerRow: ReadonlyTaskLedgerRow;
  readonly outcome: EvaluationOutcome;
}): ReadonlyPilotResult {
  validateReadonlyEvaluatorManifest(input.manifest);
  if (input.ledgerRow.manifestId !== input.manifest.manifestId) fail("pilot result manifestId does not match the frozen manifest");
  const arm = input.manifest.armManifests.find((candidate) => candidate.armManifestId === input.ledgerRow.armManifestId);
  if (arm === undefined) fail("pilot result armManifestId does not match the frozen manifest");
  requireText(input.ledgerRow.taskId, "pilot result taskId");
  if (!["PASS", "FAIL", "ABSTAIN", "UNOBSERVED"].includes(input.outcome)) fail("pilot result outcome is invalid");
  return deepFreeze({
    manifestId: input.ledgerRow.manifestId,
    armManifestId: arm.armManifestId,
    taskId: input.ledgerRow.taskId,
    outcome: input.ledgerRow.status === "valid" ? input.outcome : "UNOBSERVED"
  });
}
