import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { DomainValidationError } from "../domain/errors.js";
import { NativeApplySession, type NativeApplyPreparedTarget, type NativeApplyResult, type NativeDisposeResult } from "../native/apply.js";
import { physicalDirectoryWithoutLinks } from "../native/physical-directory.js";
import { assertRetainedCandidate, discardRetainedCandidate, holdRetainedCandidate, type RetainedCandidateHandle } from "../native/retained-candidate.js";
import type { NativeWriteExecutorFactory, NativeWriteSessionResult } from "../native/write-session.js";
import { prepareTrustedVerification, type TrustedVerificationDescriptor } from "../execution/trusted-verification.js";
import { runtimeRoot } from "../persist/state-layout.js";
import { ActionLedger, type ActionClaim, type ActionRecord } from "./action-ledger.js";
import { prepareDevelopmentCheckPlan } from "./check-plan.js";
import { startDevelopmentTaskSpec, type DevelopmentTaskSpecResult } from "./start-task-spec.js";
import { assertTaskSpecStateOutside } from "./task-preflight.js";
import { assertDevelopmentScope } from "./task-policy.js";
import { snapshotDevelopmentTaskSpec, snapshotTaskSpecHostInput, type DevelopmentTaskSpec } from "./task-spec.js";
import type { TaskCheckRefusal } from "./task-check-refusal.js";

export interface TaskExecutionProjection {
  readonly type: "TASKSPEC_EXECUTION";
  readonly status: NativeWriteSessionResult["status"];
  readonly accepted: boolean; readonly effectsSettled: boolean;
  readonly runId: string; readonly taskId: string | undefined;
  readonly artifactId: string; readonly artifactPath: string;
  readonly candidatePath: string; readonly sourceRevision: string; readonly stateRoot: string;
  readonly managed: boolean; readonly preflightArtifactPath?: string;
  readonly refusal?: TaskCheckRefusal;
}
export type TaskApplyProjection = NativeApplyResult & { readonly type: "TASKSPEC_APPLICATION"; readonly runId: string; readonly actionId: string; readonly alreadyRecorded?: true };
export type TaskDiscardProjection = NativeDisposeResult & { readonly type: "TASKSPEC_DISPOSAL"; readonly runId: string; readonly actionId: string; readonly alreadyRecorded?: true };
interface HeldRun {
  readonly spec: DevelopmentTaskSpec; readonly execution: NativeWriteSessionResult;
  readonly sourceRepo: string; readonly sourceBranch: string; readonly whole: TrustedVerificationDescriptor;
  readonly retained?: RetainedCandidateHandle;
  state: "ready" | "unmanaged" | "unsettled" | "applying" | "applied" | "discarding" | "discarded" | "needs-reconciliation";
  applied?: TaskApplyProjection; discarded?: TaskDiscardProjection;
  /** Original Native callback object, never reconstructed from a ledger read. */
  prepared?: NativeApplyPreparedTarget;
}
function fail(message: string): never { throw new DomainValidationError(`TaskSpec session: ${message}`); }
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (result.error !== undefined || result.status !== 0) fail(`Git observation failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
}

/** Live ownership only. Persistence records effects; it never reconstructs verifier/snapshot capabilities. */
export class TaskSpecSession {
  readonly ledger: ActionLedger;
  private readonly stateRoot: string;
  private readonly sandboxRoot: string;
  private readonly runs = new Map<string, HeldRun>();
  private readonly applySession = new NativeApplySession();
  private readonly abort = new AbortController();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  private closing: Promise<void> | undefined;

  constructor(input: { readonly stateRoot: string; readonly sandboxRoot?: string; readonly ledger?: ActionLedger }) {
    input = snapshotTaskSpecHostInput(input, ["stateRoot", "sandboxRoot", "ledger"]);
    if (typeof input.stateRoot !== "string" || input.stateRoot.trim() === "" || input.stateRoot.includes("\0")) fail("state root is required");
    if (input.sandboxRoot !== undefined && (typeof input.sandboxRoot !== "string" || input.sandboxRoot.trim() === "" || input.sandboxRoot.includes("\0"))) fail("invalid sandbox root");
    if (input.ledger !== undefined && !(input.ledger instanceof ActionLedger)) fail("ledger must be a trusted host ActionLedger");
    this.stateRoot = path.resolve(input.stateRoot);
    this.sandboxRoot = path.resolve(input.sandboxRoot ?? path.join(this.stateRoot, "candidates"));
    this.ledger = input.ledger ?? new ActionLedger(path.join(runtimeRoot(this.stateRoot), "task-actions"));
  }

  run(input: { readonly sourceRepo: string; readonly spec: DevelopmentTaskSpec; readonly executorFactory: NativeWriteExecutorFactory;
    readonly signal?: AbortSignal }): Promise<TaskExecutionProjection> {
    if (this.closed) return Promise.reject(new DomainValidationError("TaskSpec session is shut down"));
    input = snapshotTaskSpecHostInput(input, ["sourceRepo", "spec", "executorFactory", "signal"]);
    const spec = snapshotDevelopmentTaskSpec(input.spec), sourceRepo = physicalDirectoryWithoutLinks(input.sourceRepo), factory = input.executorFactory;
    assertTaskSpecStateOutside(sourceRepo, this.stateRoot); assertTaskSpecStateOutside(sourceRepo, this.sandboxRoot);
    const sourceBranch = git(sourceRepo, ["rev-parse", "--symbolic-full-name", "HEAD"]);
    const planned = prepareDevelopmentCheckPlan({ scopePolicy: { allowedScope: spec.write.allow, protectedPaths: spec.write.protect },
      checks: spec.checks.map(({ expect: _expect, ...check }) => check), ...(spec.limits === undefined ? {} : { snapshotLimits: spec.limits.snapshot }) });
    const descriptor = planned.verification.trustedVerification!;
    const whole = prepareTrustedVerification({ command: planned.verification.command, args: planned.verification.args ?? [],
      checkerFiles: descriptor.checkerFiles, snapshotManifest: {}, maxSnapshotFiles: descriptor.maxSnapshotFiles, maxSnapshotBytes: descriptor.maxSnapshotBytes });
    return this.enter(input.signal, async signal => {
      const result = await startDevelopmentTaskSpec({ sourceRepo, stateRoot: this.stateRoot, sandboxRoot: this.sandboxRoot, spec, executorFactory: factory, signal });
      const execution = result.execution;
      const settled = execution.effectsSettled !== false;
      let retained: RetainedCandidateHandle | undefined;
      if (settled && lstatSync(execution.candidatePath, { throwIfNoEntry: false }) !== undefined) {
        try { retained = holdRetainedCandidate({ sourceRepo, candidatePath: execution.candidatePath, sourceRevision: execution.sourceRevision }); }
        catch { /* Keep unholdable candidates and their evidence, without deletion permission. */ }
      }
      this.runs.set(execution.runId, { spec, execution, sourceRepo, sourceBranch, whole,
        ...(retained === undefined ? {} : { retained }), state: !settled ? "unsettled" : retained === undefined ? "unmanaged" : "ready" });
      return this.project(result, retained !== undefined);
    });
  }

  apply(runId: string, signal?: AbortSignal): Promise<TaskApplyProjection> {
    return this.enter(signal, async active => {
      const row = this.requireRun(runId);
      if (row.state === "applied" && row.applied !== undefined) return Object.freeze({ ...row.applied, alreadyRecorded: true as const });
      this.requireReady(row);
      if (!row.execution.acceptance.accepted || row.execution.status !== "COMPLETED") fail("apply requires an accepted candidate");
      this.assertApplyCandidate(row);
      row.state = "applying";
      let claim: ActionClaim | undefined;
      try {
        claim = await this.admit(row, "candidate-apply", active);
        active.throwIfAborted();
        // Admission persists asynchronously. Recheck original ownership before
        // NativeApply observes a new snapshot; never refresh the held handle.
        this.assertApplyCandidate(row);
        active.throwIfAborted();
        const applied = await this.applySession.apply({ sourceRepo: row.sourceRepo, result: row.execution, trustedVerification: row.whole, signal: active,
          onPrepared: async target => {
            claim = await this.ledger.checkpoint(claim!, { result: target,
              evidence: { summary: "prepared target persisted before source mutation", references: [row.execution.artifact.path, `git:${target.appliedRevision}`] } });
            row.prepared = target;
          } });
        if (row.prepared === undefined || row.prepared.appliedRevision !== applied.appliedRevision ||
          row.prepared.candidatePath !== row.execution.candidatePath || row.prepared.sourceRevision !== row.execution.sourceRevision) fail("application does not match the persisted prepared target");
        const projected: TaskApplyProjection = Object.freeze({ ...applied, type: "TASKSPEC_APPLICATION", runId, actionId: claim.actionId });
        await this.ledger.complete(claim, { result: projected,
          evidence: { summary: "source application returned after actual re-verification and mutation", references: [row.execution.artifact.path, `git:${applied.appliedRevision}`] } });
        row.applied = projected; row.state = "applied"; return projected;
      } catch (error) {
        if (claim !== undefined) await this.uncertain(row, claim, "apply"); else row.state = "ready";
        throw new DomainValidationError(`TaskSpec apply ${claim === undefined ? "refused" : "needs reconciliation"}: ${error instanceof Error ? error.message : "operation failed"}`);
      }
    });
  }

  discard(runId: string, signal?: AbortSignal): Promise<TaskDiscardProjection> {
    return this.enter(signal, async active => {
      const row = this.requireRun(runId);
      if (row.state === "discarded" && row.discarded !== undefined) {
        if (lstatSync(row.execution.candidatePath, { throwIfNoEntry: false }) !== undefined) fail("discarded path exists again; replacement retained");
        return Object.freeze({ ...row.discarded, alreadyRecorded: true as const });
      }
      const prior = row.state;
      if (prior !== "applied") this.requireReady(row);
      if (prior === "applied" && row.prepared === undefined) fail("applied candidate has no original prepared target");
      const preparedIndexTree = prior === "applied" ? row.prepared!.candidateTree : undefined;
      assertRetainedCandidate(row.retained!, preparedIndexTree);
      row.state = "discarding"; let claim: ActionClaim | undefined;
      try {
        claim = await this.admit(row, "candidate-discard", active);
        const onPrepared = async (): Promise<void> => { claim = await this.ledger.checkpoint(claim!, {
          result: { sourceRevision: row.execution.sourceRevision, candidatePath: row.execution.candidatePath },
          evidence: { summary: "explicit discard intent persisted before deletion", references: [row.execution.artifact.path] } }); };
        let disposed: NativeDisposeResult;
        if (prior === "applied") {
          await onPrepared(); active.throwIfAborted();
          assertRetainedCandidate(row.retained!, preparedIndexTree);
          disposed = await this.applySession.disposeStrict(row.execution.candidatePath);
        }
        else disposed = await discardRetainedCandidate({ handle: row.retained!, signal: active, onPrepared });
        const projected: TaskDiscardProjection = Object.freeze({ ...disposed, type: "TASKSPEC_DISPOSAL", runId, actionId: claim.actionId });
        await this.ledger.complete(claim, { result: projected, evidence: { summary: "managed candidate removal completed", references: [row.execution.artifact.path] } });
        row.discarded = projected; row.state = "discarded"; return projected;
      } catch (error) {
        if (claim !== undefined) await this.uncertain(row, claim, "discard"); else row.state = prior;
        throw new DomainValidationError(`TaskSpec discard ${claim === undefined ? "refused" : "needs reconciliation"}: ${error instanceof Error ? error.message : "operation failed"}`);
      }
    });
  }

  shutdown(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true; this.abort.abort();
    this.closing = (async () => {
      await Promise.allSettled([...this.pending]); await this.applySession.shutdown();
      // Closing expires live capabilities and releases private byte snapshots;
      // filesystem candidates and durable evidence are retained.
      this.runs.clear();
    })();
    return this.closing;
  }

  private enter<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new DomainValidationError("TaskSpec session is shut down"));
    const combined = signal === undefined ? this.abort.signal : AbortSignal.any([signal, this.abort.signal]);
    const running = (async () => { combined.throwIfAborted(); return operation(combined); })();
    this.pending.add(running); void running.then(() => this.pending.delete(running), () => this.pending.delete(running)); return running;
  }
  private requireRun(runId: string): HeldRun {
    if (typeof runId !== "string" || !/^run_[A-Za-z0-9_-]{1,96}$/.test(runId)) fail("invalid run identity");
    const row = this.runs.get(runId); if (row === undefined) fail("run is not held by this live owner"); return row;
  }
  private requireReady(row: HeldRun): void {
    if (row.state === "needs-reconciliation" || row.state === "unsettled") fail("candidate requires reconciliation; no replay or discard authorized");
    if (row.state !== "ready" || row.retained === undefined) fail("candidate is not a settled live managed candidate");
  }
  private assertApplyCandidate(row: HeldRun): void {
    assertRetainedCandidate(row.retained!);
    if (git(row.sourceRepo, ["rev-parse", "HEAD"]) !== row.execution.sourceRevision ||
      git(row.sourceRepo, ["rev-parse", "--symbolic-full-name", "HEAD"]) !== row.sourceBranch ||
      git(row.sourceRepo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"]) !== "") fail("source revision, branch or clean bytes changed");
    assertDevelopmentScope(row.execution.candidatePath, { allowedScope: row.spec.write.allow, protectedPaths: row.spec.write.protect }, row.execution.sourceRevision);
  }
  private async admit(row: HeldRun, kind: "candidate-apply" | "candidate-discard", signal: AbortSignal): Promise<ActionClaim> {
    if ([...this.runs.values()].some(other => samePath(other.sourceRepo, row.sourceRepo) && ["needs-reconciliation", "unsettled"].includes(other.state))) {
      fail("same-source effects require reconciliation");
    }
    return this.ledger.admit({ idempotencyKey: `task:${row.execution.runId}:${row.execution.artifact.id}:${kind}`, kind,
      input: { sourceRepo: row.sourceRepo, sourceRevision: row.execution.sourceRevision, candidatePath: row.execution.candidatePath,
        runId: row.execution.runId, artifactId: row.execution.artifact.id, verifierDescriptorId: row.whole.id } },
    (record: ActionRecord) => {
      const binding: unknown = JSON.parse(record.inputCanonicalJson);
      return binding === null || typeof binding !== "object" || !("sourceRepo" in binding) || typeof binding.sourceRepo !== "string" || samePath(binding.sourceRepo, row.sourceRepo);
    }, signal);
  }
  private async uncertain(row: HeldRun, claim: ActionClaim, operation: string): Promise<void> {
    row.state = "needs-reconciliation";
    try { await this.ledger.markUncertain(claim, { evidence: {
      summary: `${operation} did not finish with a durable receipt; host reconciliation required`, references: [row.execution.artifact.path] } }); }
    catch { /* A running, advanced or completed durable record is never replayed on a guessed publication outcome. */ }
  }
  private project(result: DevelopmentTaskSpecResult, managed: boolean): TaskExecutionProjection {
    const execution = result.execution;
    return Object.freeze({ type: "TASKSPEC_EXECUTION", status: execution.status, accepted: execution.acceptance.accepted,
      effectsSettled: execution.effectsSettled !== false, runId: execution.runId, taskId: execution.taskId,
      artifactId: execution.artifact.id, artifactPath: execution.artifact.path, candidatePath: execution.candidatePath,
      sourceRevision: execution.sourceRevision, stateRoot: this.stateRoot, managed,
      ...(result.preflight === undefined ? {} : { preflightArtifactPath: result.preflight.artifactPath }),
      ...(result.preflight?.refusal === undefined ? {} : { refusal: result.preflight.refusal }) });
  }
}
