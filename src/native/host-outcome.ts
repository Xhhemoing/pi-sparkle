import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseStableJsonBytes } from "../domain/canonical-json.js";
import { DomainValidationError } from "../domain/errors.js";
import type { RunId, TaskId } from "../domain/ids.js";
import { nowIso } from "../domain/timestamp.js";
import { formatModelRef } from "../config/model-ref.js";
import type { AgentExecutor } from "../execution/contract.js";
import { hasTrustedVerificationEvidence, type IndependentCheckRecord } from "../execution/independent-check.js";
import type { LoopArtifactRef } from "../execution/loop-artifact.js";
import type { TrustedVerificationDescriptor } from "../execution/trusted-verification.js";
import { fingerprintsCompatible } from "../execution/worktree-snapshot.js";
import { HOST_TERMINAL_OUTCOME_SCHEMA, type HostTerminalOutcomeAssessment } from "./host-outcome-types.js";
import { episodeIdFromEvents } from "../run/episode-bind.js";
import type { RunOutcome } from "../run/coordinator.js";
import { isInvocation, type ModelInvocation } from "../telemetry/model-invocation.js";

/** Host configuration only; no task/result JSON supplies model or source facts. */
export interface NativeHostEvaluator {
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly rubricId: string;
  readonly rubricVersion: string;
  readonly evaluatorDefinitionCanonicalJson: string;
  readonly modelFailureExitCodes: readonly number[];
}
export interface NativeHostAttempt {
  readonly number: number;
  /** Parent run owning the checker and artifacts. */
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly projectId: string;
  readonly episodeId?: string;
  readonly executions: readonly { readonly runId: RunId; readonly taskId: TaskId; readonly agentInstanceId: string }[];
}
export interface NativeHostObservation {
  readonly logicalTaskId: string;
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly sourceRevision: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly attempts: readonly NativeHostAttempt[];
  readonly invocations: readonly ModelInvocation[];
  readonly executorClass: "pi" | "faux" | "unknown" | "mixed";
  readonly assessment: HostTerminalOutcomeAssessment;
  readonly artifact: LoopArtifactRef;
}
export function snapshotNativeHostEvaluator(input: NativeHostEvaluator | undefined): NativeHostEvaluator | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new DomainValidationError("host evaluator must be a plain object");
  }
  const data = (value: object, key: string): unknown => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !("value" in property)) throw new DomainValidationError("host evaluator fields must be own data properties");
    return property.value;
  };
  const text = (key: string): string => {
    const value = data(input, key);
    if (typeof value !== "string" || value.trim() === "" || value.length > 16_384) throw new DomainValidationError("host evaluator identity and canonical definition are required and bounded");
    return value;
  };
  const copy = { evaluatorId: text("evaluatorId"), evaluatorVersion: text("evaluatorVersion"),
    rubricId: text("rubricId"), rubricVersion: text("rubricVersion"), evaluatorDefinitionCanonicalJson: text("evaluatorDefinitionCanonicalJson") };
  parseStableJsonBytes(new TextEncoder().encode(copy.evaluatorDefinitionCanonicalJson));
  const exits = data(input, "modelFailureExitCodes");
  if (!Array.isArray(exits) || Object.getPrototypeOf(exits) !== Array.prototype || exits.length > 255) {
    throw new DomainValidationError("host evaluator model failure exits must be unique integers from 1 to 255");
  }
  const codes: number[] = [];
  for (let index = 0; index < exits.length; index++) {
    const code = data(exits, String(index));
    if (typeof code !== "number" || !Number.isSafeInteger(code) || code < 1 || code > 255 || codes.includes(code)) {
      throw new DomainValidationError("host evaluator model failure exits must be unique integers from 1 to 255");
    }
    codes.push(code);
  }
  return Object.freeze({ ...copy, modelFailureExitCodes: Object.freeze(codes) });
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) throw new Error("invalid telemetry object");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new Error("telemetry accessor");
  return descriptor.value;
}
function pick(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, own(value, key)]));
}
function snapshotInvocation(value: unknown): ModelInvocation | undefined {
  try {
    const row = { ...pick(value, ["id", "taskId", "runId", "agentInstanceId", "responseHash", "tokensIn", "tokensOut", "latencyMs",
      "occurredAt", "attempt", "cacheHit", "callOutcome", "executorClass"]),
    config: pick(own(value, "config"), ["provider", "model", "modelVersion", "parameterHash"]),
    ...(own(value, "pricing") === undefined ? {} : { pricing: pick(own(value, "pricing"), ["catalogVersion", "inputUsdPerMTok", "outputUsdPerMTok"]) }) };
    if (Object.values(row as Record<string, unknown>).some((field) => typeof field === "string" && field.length > 1024) ||
        Object.values(row.config).some((field) => typeof field === "string" && field.length > 1024) ||
        (row.pricing !== undefined && typeof row.pricing.catalogVersion === "string" && row.pricing.catalogVersion.length > 1024) || !isInvocation(row)) return undefined;
    formatModelRef(row.config.provider, row.config.model);
    Object.freeze(row.config); if (row.pricing !== undefined) Object.freeze(row.pricing);
    return Object.freeze(row);
  } catch { return undefined; }
}

interface AttemptState {
  readonly requests: { readonly runId: RunId; readonly taskId: TaskId; readonly agentInstanceId: string }[];
  readonly rows: ModelInvocation[];
  identity?: NativeHostAttempt;
}
interface FinalCheck {
  readonly runId: RunId;
  readonly check: IndependentCheckRecord;
  readonly descriptor: TrustedVerificationDescriptor | undefined;
  readonly cwd: string;
  readonly revision: string;
  readonly artifact: LoopArtifactRef;
}

/** Internal session assembly. Same-process host code is trusted, not sandboxed. */
export class NativeHostOutcomeCollector {
  readonly logicalTaskId = `logical_task_${randomUUID()}`;
  readonly startedAt = nowIso();
  private readonly attempts: AttemptState[] = [];
  private readonly rows = new Map<string, ModelInvocation>();
  private fault: string | undefined;
  private finalCheck: FinalCheck | undefined;
  private sealed = false;
  constructor(private readonly evaluator: NativeHostEvaluator | undefined) {}

  beginAttempt(): { readonly onInvocation: (row: ModelInvocation) => void; readonly wrap: (executor: AgentExecutor) => AgentExecutor;
    readonly complete: (outcome: RunOutcome, taskId: TaskId) => void } {
    this.finalCheck = undefined;
    const attempt: AttemptState = { requests: [], rows: [] }; this.attempts.push(attempt);
    const collector = this;
    return {
      onInvocation(row) {
        if (collector.sealed) return;
        const snapshot = snapshotInvocation(row);
        if (snapshot === undefined) { collector.fail("malformed-invocation"); return; }
        const prior = collector.rows.get(snapshot.id);
        if (prior !== undefined) {
          if (!isDeepStrictEqual(prior, snapshot)) collector.fail("conflicting-invocation");
          if (!attempt.rows.includes(prior)) collector.fail("foreign-invocation");
          return;
        }
        if (collector.rows.size >= 256) { collector.fail("invocation-overflow"); return; }
        collector.rows.set(snapshot.id, snapshot); attempt.rows.push(snapshot);
        if (snapshot.callOutcome !== "ok") collector.fail(snapshot.callOutcome === "timeout" ? "timeout" :
          snapshot.callOutcome === "cancelled" ? "cancelled" : snapshot.callOutcome === "error" ? "provider-failure" : "unknown-call-outcome");
      },
      wrap(executor) {
        return {
          ...(executor.supportedModelIds === undefined ? {} : { supportedModelIds: executor.supportedModelIds }),
          ...(executor.steerText === undefined ? {} : { steerText: executor.steerText.bind(executor) }),
          async *execute(request, signal) {
            attempt.requests.push(Object.freeze({ runId: request.runId, taskId: request.taskId, agentInstanceId: request.agentInstanceId }));
            try {
              for await (const event of executor.execute(request, signal)) {
                if (event.type === "TOOL_FINISHED" && event.isError) collector.fail("tool-failure");
                if (event.type === "EXECUTION_FINISHED" && event.outcome !== "SUCCESS") collector.fail(event.outcome === "CANCELLED" ? "cancelled" : "run-failure");
                yield event;
              }
            } catch (error) { collector.fail("run-failure"); throw error; }
          }
        };
      },
      complete(outcome, taskId) {
        const episodeId = episodeIdFromEvents(outcome.events);
        attempt.identity = Object.freeze({ number: collector.attempts.length, runId: outcome.runId, taskId,
          projectId: outcome.project.id, ...(episodeId === undefined ? {} : { episodeId }), executions: Object.freeze([...attempt.requests]) });
        if (outcome.status !== "COMPLETED") collector.fail(outcome.status === "CANCELLED" ? "cancelled" : "run-failure");
      }
    };
  }

  checked(check: IndependentCheckRecord, descriptor: TrustedVerificationDescriptor | undefined,
    cwd: string, revision: string, artifact: LoopArtifactRef, runId: RunId): void {
    this.finalCheck = { runId, check, descriptor, cwd, revision, artifact };
    const exclusion = this.checkExclusion(this.finalCheck);
    if (exclusion !== undefined) this.fail(exclusion);
    else if (this.evaluator === undefined) this.fail("evaluator-unavailable");
    else if (check.exitCode !== 0 && !this.evaluator.modelFailureExitCodes.includes(check.exitCode)) this.fail("evaluator-unavailable-exit");
  }
  exclude(reason: string): void { this.fail(reason); }
  private fail(reason: string): void { this.fault ??= reason; }
  private checkExclusion(input: FinalCheck): string | undefined {
    const { check, descriptor, cwd, revision } = input;
    if (descriptor === undefined || !hasTrustedVerificationEvidence(check, descriptor)) return "original-exact-evidence-required";
    if (path.resolve(check.cwd) !== path.resolve(cwd) || check.revision !== revision ||
        check.contentFingerprintBefore.headRevision !== revision || check.contentFingerprintAfter.headRevision !== revision ||
        check.command !== descriptor.command || !isDeepStrictEqual(check.args, descriptor.args) ||
        !fingerprintsCompatible(check.contentFingerprintBefore, check.contentFingerprintAfter, check.snapshotManifest).ok) return "exact-binding-mismatch";
    if (check.processStatus !== "completed" || check.processCleanupUnsettled === true || check.processSignal !== null ||
        check.processExitCode !== check.exitCode) return "unsettled-check";
    return undefined;
  }

  /** Safe references only; deliberately no persisted object can reissue authority. */
  references(): object {
    return { kind: "native-host-observation", logicalTaskId: this.logicalTaskId, startedAt: this.startedAt,
      attempts: this.attempts.flatMap((attempt) => attempt.identity === undefined ? [] : [attempt.identity]),
      invocationIds: [...this.rows.keys()], ...(this.finalCheck === undefined ? {} : {
        checkId: this.finalCheck.check.checkId, checkArtifactId: this.finalCheck.artifact.id, checkRunId: this.finalCheck.runId }) };
  }

  /** Called synchronously after the session's last persistence await/cancel check. */
  project(input: { readonly runId: RunId; readonly taskId: TaskId; readonly sourceRevision: string;
    readonly artifact: LoopArtifactRef; readonly cancelled: boolean; readonly timedOut: boolean; readonly effectsSettled: boolean;
    readonly accepted: boolean; readonly terminalReason: string }): NativeHostObservation {
    this.sealed = true;
    const attempts = Object.freeze(this.attempts.flatMap((attempt) => attempt.identity === undefined ? [] : [attempt.identity]));
    const invocations = Object.freeze([...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)));
    const classes = new Set(invocations.map((row) => row.executorClass ?? "unknown"));
    const executorClass = classes.size === 1 ? [...classes][0]! : classes.size === 0 ? "unknown" : "mixed";
    const final = attempts.at(-1); const checked = this.finalCheck;
    let reason = input.timedOut ? "timeout" : input.cancelled ? "cancelled" : !input.effectsSettled ? "unsettled-effects" : this.fault;
    if (reason === undefined && this.evaluator === undefined) reason = "evaluator-unavailable";
    if (reason === undefined && (final === undefined || final.episodeId === undefined || checked === undefined)) reason = "missing-host-check-or-identity";
    if (reason === undefined && (final!.runId !== input.runId || final!.taskId !== input.taskId || checked!.runId !== input.runId || checked!.revision !== input.sourceRevision)) reason = "host-identity-mismatch";
    const completeTelemetry = this.attempts.every((attempt) => attempt.identity !== undefined && attempt.requests.length > 0 && attempt.rows.length > 0 &&
      attempt.rows.every((row) => attempt.requests.some((request) => request.runId === row.runId && request.taskId === row.taskId && request.agentInstanceId === row.agentInstanceId)) &&
      attempt.requests.every((request) => attempt.rows.some((row) => request.runId === row.runId && request.taskId === row.taskId && request.agentInstanceId === row.agentInstanceId)));
    if (reason === undefined && !completeTelemetry) reason = "missing-or-foreign-invocation";
    const identities = new Set(invocations.map((row) => JSON.stringify([row.config.provider, row.config.model, row.config.modelVersion])));
    if (reason === undefined && (invocations.length === 0 || identities.size !== 1 || invocations.some((row) => row.config.modelVersion === undefined))) reason = "unknown-or-mixed-model-version";
    if (reason === undefined && checked !== undefined) reason = this.checkExclusion(checked);
    if (reason === undefined && checked !== undefined && checked.check.exitCode !== 0 && !this.evaluator!.modelFailureExitCodes.includes(checked.check.exitCode)) reason = "evaluator-unavailable-exit";
    if (reason === undefined && checked?.check.exitCode === 0 && (!checked.check.ok || !input.accepted)) reason = `run-failure: ${input.terminalReason}`;
    const row = invocations[0];
    const execution = final?.executions.at(-1);
    const assessment: HostTerminalOutcomeAssessment = reason !== undefined ? Object.freeze({ eligible: false, outcome: "UNOBSERVED", reason }) : Object.freeze({
      eligible: true, outcome: checked!.check.exitCode === 0 ? "PASSED" : "FAILED",
      record: Object.freeze({ schemaVersion: HOST_TERMINAL_OUTCOME_SCHEMA, sourceKind: "host-evaluator", outcomeRef: input.artifact.id,
        bindingRef: `${input.runId}/${checked!.check.checkId}`, projectId: final!.projectId, projectVersion: input.sourceRevision,
        episodeId: final!.episodeId!, runId: execution!.runId, taskId: input.taskId, modelId: formatModelRef(row!.config.provider, row!.config.model),
        modelVersion: row!.config.modelVersion!, targetArtifactId: checked!.artifact.id, targetArtifactVersion: checked!.check.checkId,
        evaluatorId: this.evaluator!.evaluatorId, evaluatorVersion: this.evaluator!.evaluatorVersion,
        rubricId: this.evaluator!.rubricId, rubricVersion: this.evaluator!.rubricVersion,
        evaluatorDefinitionCanonicalJson: this.evaluator!.evaluatorDefinitionCanonicalJson,
        outcome: checked!.check.exitCode === 0 ? "PASSED" : "FAILED", failureAttribution: checked!.check.exitCode === 0 ? "none" : "model-evaluated",
        evidenceRefs: Object.freeze([checked!.check.checkId, checked!.artifact.id]) }) });
    const observation = Object.freeze({ logicalTaskId: this.logicalTaskId, runId: input.runId, taskId: input.taskId,
      sourceRevision: input.sourceRevision, startedAt: this.startedAt, completedAt: nowIso(), attempts, invocations, executorClass,
      assessment, artifact: Object.freeze({ ...input.artifact }) });
    return observation;
  }
}
