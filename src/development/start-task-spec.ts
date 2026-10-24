import { lstat } from "node:fs/promises";
import { openClosedLoop, closeClosedLoop, type ClosedLoopSession } from "../execution/closed-loop.js";
import { DomainValidationError } from "../domain/errors.js";
import { CommandCleanupIncompleteError } from "../execution/command-runner.js";
import { prepareNativeWrite } from "../native/write-preflight.js";
import type { NativeWriteExecutorFactory, NativeWriteSessionResult } from "../native/write-session.js";
import { prepareDevelopmentCheckPlan } from "./check-plan.js";
import { startDevelopmentTask } from "./start-task.js";
import { snapshotDevelopmentTaskSpec, snapshotTaskSpecHostInput, type DevelopmentTaskSpec } from "./task-spec.js";
import { assertTaskSpecStateOutside, runTaskSpecPreflight, type TaskPreflightResult } from "./task-preflight.js";
export interface StartDevelopmentTaskSpecInput {
  readonly sourceRepo: string; readonly stateRoot: string; readonly sandboxRoot?: string;
  readonly spec: DevelopmentTaskSpec; readonly executorFactory: NativeWriteExecutorFactory; readonly signal?: AbortSignal;
}
export interface DevelopmentTaskSpecResult { readonly execution: NativeWriteSessionResult; readonly preflight?: TaskPreflightResult; }
/** Experimental bounded TaskSpec repair path; accepts a candidate, never applies it. */
export async function startDevelopmentTaskSpec(input: StartDevelopmentTaskSpecInput): Promise<DevelopmentTaskSpecResult> {
  const started = performance.now();
  input = snapshotTaskSpecHostInput(input, ["sourceRepo", "stateRoot", "sandboxRoot", "spec", "executorFactory", "signal"]);
  const spec = snapshotDevelopmentTaskSpec(input.spec);
  assertTaskSpecStateOutside(input.sourceRepo, input.stateRoot);
  const factory = input.executorFactory;
  const stateRoot = input.stateRoot;
  const sourceRepo = input.sourceRepo;
  const sandboxRoot = input.sandboxRoot;
  const scopePolicy = { allowedScope: spec.write.allow, protectedPaths: spec.write.protect };
  const checks = spec.checks.map(({ expect: _expect, ...check }) => check);
  const planned = prepareDevelopmentCheckPlan({ scopePolicy, checks });
  const verification = Object.freeze({ ...planned.verification, timeoutMs: Math.round(spec.budget.checkSeconds * 1000) });
  const deadlineAt = started + Math.round(spec.budget.totalSeconds * 1000);
  const deadline = new AbortController();
  const signal = input.signal === undefined ? deadline.signal : AbortSignal.any([input.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), Math.max(1, deadlineAt - performance.now()));
  timer.unref();
  let preflight: TaskPreflightResult | undefined;
  try {
    const base = prepareNativeWrite({ sourceRepo, objective: spec.objective, verification, checkPlan: planned.checkPlan, signal });
    const remainingMs = Math.floor(deadlineAt - performance.now());
    if (signal.aborted || remainingMs <= 0) throw new DomainValidationError("TaskSpec total time budget exhausted before candidate allocation");
    const execution = await startDevelopmentTask({ sourceRepo, stateRoot, ...(sandboxRoot === undefined ? {} : { sandboxRoot }),
      objective: spec.objective, scopePolicy, checkPlan: planned.checkPlan, verification, signal,
      maxWallTimeMs: remainingMs, workerTimeoutMs: Math.round(spec.budget.workerSeconds * 1000),
      maxAttempts: spec.worker.maxAttempts ?? 1,
      ...((spec.budget.workerTotalSeconds === undefined && spec.budget.checkTotalSeconds === undefined) ? {} : { phaseTimeLimits: {
        ...(spec.budget.workerTotalSeconds === undefined ? {} : { workerTotalMs: Math.round(spec.budget.workerTotalSeconds * 1000) }),
        ...(spec.budget.checkTotalSeconds === undefined ? {} : { checkTotalMs: Math.round(spec.budget.checkTotalSeconds * 1000) }) } }),
      taskContext: { requiredFiles: spec.context, expectedSourceRevision: base.revision, tokenBudget: 16000 },
      executorFactory: async (context) => {
        if (preflight === undefined) preflight = await runTaskSpecPreflight({ candidatePath: context.candidatePath, sourceRevision: context.sourceRevision,
          stateRoot, spec, signal: context.signal, onCommandCleanupUnsettled: context.onCommandCleanupUnsettled,
          ...(context.baseCheckBudget === undefined ? {} : { checkTimeRemainingMs: context.baseCheckBudget.remainingMs,
            onChecksElapsed: context.baseCheckBudget.recordElapsedMs }) });
        if (preflight.unsettledCommand !== undefined) {
          context.onCommandCleanupUnsettled(preflight.unsettledCommand);
          throw new CommandCleanupIncompleteError(preflight.unsettledCommand);
        }
        if (!preflight.ok) throw new DomainValidationError(`TaskSpec preflight refused: ${preflight.reason}; host evidence: ${preflight.artifactPath}`);
        if (context.signal.aborted || performance.now() >= deadlineAt) throw new DomainValidationError("TaskSpec cancelled or total time budget exhausted before worker allocation");
        const fresh = prepareNativeWrite({ sourceRepo, objective: spec.objective, verification, signal: context.signal });
        if (fresh.revision !== base.revision) throw new DomainValidationError("source changed during TaskSpec preparation");
        if (context.signal.aborted || performance.now() >= deadlineAt) throw new DomainValidationError("TaskSpec expired during source freshness verification");
        return factory(context);
      } });
    if (execution.acceptance.accepted && (signal.aborted || performance.now() >= deadlineAt)) throw new DomainValidationError(`TaskSpec cancelled or total time budget exhausted before delivery; run: ${execution.runId}; artifact: ${execution.artifact.id}; candidate: ${execution.candidatePath}`);
    return Object.freeze({ execution, ...(preflight === undefined ? {} : { preflight }) });
  } finally { clearTimeout(timer); }
}

/** A separate zero-model invocation; settled candidates are removed, not reused across CLI calls. */
export async function preflightDevelopmentTaskSpec(input: Omit<StartDevelopmentTaskSpecInput, "executorFactory">): Promise<TaskPreflightResult & {
  readonly candidatePath: string; readonly candidateDisposition: "removed" | "retained-unsettled";
}> {
  const started = performance.now();
  input = snapshotTaskSpecHostInput(input, ["sourceRepo", "stateRoot", "sandboxRoot", "spec", "signal"]);
  const spec = snapshotDevelopmentTaskSpec(input.spec);
  assertTaskSpecStateOutside(input.sourceRepo, input.stateRoot);
  const sourceRepo = input.sourceRepo;
  const scopePolicy = { allowedScope: spec.write.allow, protectedPaths: spec.write.protect };
  const planned = prepareDevelopmentCheckPlan({ scopePolicy, checks: spec.checks.map(({ expect: _expect, ...check }) => check) });
  const deadlineAt = started + Math.round(spec.budget.totalSeconds * 1000);
  const deadline = new AbortController();
  const signal = input.signal === undefined ? deadline.signal : AbortSignal.any([input.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), Math.max(1, deadlineAt - performance.now()));
  timer.unref();
  let candidate: ClosedLoopSession | undefined;
  let retain = false;
  let cleanupAttempted = false;
  let observationPath: string | undefined;
  const dispose = async (): Promise<void> => {
    if (candidate === undefined) return;
    cleanupAttempted = true;
    await closeClosedLoop(candidate);
    try { await lstat(candidate.worktree.cwd); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    throw new DomainValidationError(`preflight candidate cleanup failed; candidate retained at ${candidate.worktree.cwd}; observation: ${observationPath ?? "not issued"}`);
  };
  try {
    const base = prepareNativeWrite({ sourceRepo, objective: spec.objective, ...planned, signal });
    if (signal.aborted || performance.now() >= deadlineAt) throw new DomainValidationError("TaskSpec preflight deadline exhausted before allocation");
    candidate = await openClosedLoop({ sourceRepo: base.sourceRepo, ...(input.sandboxRoot === undefined ? {} : { sandboxRoot: input.sandboxRoot }) });
    if (candidate.revisionAtStart !== base.revision) throw new DomainValidationError("source changed during preflight allocation");
    const result = await runTaskSpecPreflight({ candidatePath: candidate.worktree.cwd, sourceRevision: base.revision,
      stateRoot: input.stateRoot, spec, signal, onCommandCleanupUnsettled: () => { retain = true; } });
    observationPath = result.artifactPath;
    retain ||= !result.effectsSettled;
    if (!retain) await dispose();
    if (signal.aborted || performance.now() >= deadlineAt) throw new DomainValidationError(`standalone preflight cancelled or expired; observation: ${result.artifactPath}; candidate: ${candidate.worktree.cwd}`);
    return Object.freeze({ ...result, candidatePath: candidate.worktree.cwd,
      candidateDisposition: retain ? "retained-unsettled" as const : "removed" as const });
  } catch (error) {
    if (error instanceof CommandCleanupIncompleteError) {
      retain = true;
      error.message += `; preflight candidate retained at ${candidate?.worktree.cwd ?? "unavailable"}`;
    }
    throw error;
  } finally {
    try { if (candidate !== undefined && !retain && !cleanupAttempted) await dispose(); }
    finally { clearTimeout(timer); }
  }
}
