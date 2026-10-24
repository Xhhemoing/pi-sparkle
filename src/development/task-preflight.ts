import { realpathSync, lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildTaskContext } from "../context/task-context.js";
import { DomainValidationError } from "../domain/errors.js";
import { CommandCleanupIncompleteError, runAuthorizedCommand, type AuthorizedCommandRunResult } from "../execution/command-runner.js";
import { captureExactSnapshot, sameExactSnapshot } from "../execution/exact-snapshot.js";
import { captureWorktreeFingerprint } from "../execution/worktree-snapshot.js";
import { snapshotDevelopmentTaskSpec, snapshotTaskSpecHostInput, type DevelopmentTaskSpec } from "./task-spec.js";
import { DEFAULT_RECIPE_OUTPUT_BYTES, DEFAULT_RECIPE_TIMEOUT_MS } from "./work-items.js";
export interface TaskPreflightInput {
  readonly candidatePath: string;
  readonly sourceRevision: string;
  readonly stateRoot: string;
  readonly spec: DevelopmentTaskSpec;
  readonly signal?: AbortSignal;
  readonly onCommandCleanupUnsettled?: (result: AuthorizedCommandRunResult) => void;
}
export interface TaskPreflightResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly effectsSettled: boolean;
  readonly artifactPath: string;
  readonly preparationMs: number;
  readonly checksMs: number;
  readonly unsettledCommand?: AuthorizedCommandRunResult;
}
/** Resolve existing ancestors before checking native path containment (including Windows case aliases). */
export function assertTaskSpecStateOutside(rootPath: string, statePath: string): void {
  if (typeof rootPath !== "string" || typeof statePath !== "string") throw new DomainValidationError("TaskSpec source/candidate and state paths are required");
  const canonical = (value: string): string => {
    let ancestor = path.resolve(value);
    const missing: string[] = [];
    for (;;) {
      try { return path.resolve(realpathSync.native(ancestor), ...missing.reverse()); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try { lstatSync(ancestor); throw new DomainValidationError("TaskSpec state path has an unresolved link"); }
        catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError; }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        missing.push(path.basename(ancestor)); ancestor = parent;
      }
    }
  };
  const relative = path.relative(canonical(rootPath), canonical(statePath));
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new DomainValidationError("TaskSpec state must be outside the source repository and candidate");
  }
}
interface PreflightCommand { readonly id: string; readonly result: AuthorizedCommandRunResult; readonly durationMs: number; readonly expected: boolean; }
function complete(result: AuthorizedCommandRunResult): boolean {
  return result.status === "completed" && result.signal === null && !result.cleanupUnsettled &&
    Buffer.byteLength(result.stdoutText) === result.stdoutByteLength && Buffer.byteLength(result.stderrText) === result.stderrByteLength;
}
function expectedCheck(result: AuthorizedCommandRunResult, check: DevelopmentTaskSpec["checks"][number]): boolean {
  if (!complete(result)) return false;
  if (check.expect.baseline === "pass") return result.ok && result.exitCode === 0;
  // This narrow trusted-checker convention classifies the final business
  // assertion, not arbitrary exit 1. A real import/compiler stack on stderr
  // must not masquerade as that assertion even after matching stdout.
  if (result.exitCode !== 1 || result.stderrByteLength !== 0) return false;
  try {
    const report: unknown = JSON.parse(result.stdoutText);
    return report !== null && typeof report === "object" && !Array.isArray(report) &&
      Object.keys(report).length === 2 && Object.hasOwn(report, "assertion") && Object.hasOwn(report, "outcome") &&
      (report as { assertion: unknown }).assertion === check.expect.failureAssertion &&
      (report as { outcome: unknown }).outcome === "failed";
  } catch { return false; }
}
/** Actual zero-model commands in an already-owned candidate; never allocates a worker. */
export async function runTaskSpecPreflight(input: TaskPreflightInput): Promise<TaskPreflightResult> {
  const started = performance.now();
  input = snapshotTaskSpecHostInput(input, ["candidatePath", "sourceRevision", "stateRoot", "spec", "signal", "onCommandCleanupUnsettled"]);
  const spec = snapshotDevelopmentTaskSpec(input.spec);
  const candidate = path.resolve(input.candidatePath);
  const state = path.resolve(input.stateRoot);
  assertTaskSpecStateOutside(candidate, state);
  const deadlineAt = started + Math.round(spec.budget.totalSeconds * 1000);
  const deadline = new AbortController();
  const signal = input.signal === undefined ? deadline.signal : AbortSignal.any([input.signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), spec.budget.totalSeconds * 1000);
  timer.unref();
  const preparation: PreflightCommand[] = [];
  const checks: PreflightCommand[] = [];
  let preparationMs = 0;
  let checksMs = 0;
  let unsettledCommand: AuthorizedCommandRunResult | undefined;
  let reason = "expected base checks observed";
  let ok = false;
  const expired = (): boolean => signal.aborted || performance.now() >= deadlineAt;
  const ensureActive = (): void => { if (expired()) throw new DomainValidationError("preflight cancelled or total time budget exhausted"); };
  try {
    ensureActive();
    const initial = captureWorktreeFingerprint(candidate);
    if (initial.headRevision !== input.sourceRevision || initial.entries.length !== 0) throw new DomainValidationError("preflight requires the unchanged candidate base revision");
    await buildTaskContext({ candidatePath: candidate, sourceRevision: input.sourceRevision, objective: spec.objective,
      acceptanceMetadata: [], input: { requiredFiles: spec.context, expectedSourceRevision: input.sourceRevision, tokenBudget: 16000 }, signal });
    const manifest = { includePrefixes: spec.write.protect, optionalIncludePrefixes: spec.write.allow };
    const limits = { maxFiles: 1024, maxBytes: 16 * 1024 * 1024 };
    const before = captureExactSnapshot(candidate, manifest, limits);
    const unchanged = (): void => {
      const current = captureWorktreeFingerprint(candidate);
      if (current.headRevision !== input.sourceRevision || current.entries.length !== 0 ||
          !sameExactSnapshot(before, captureExactSnapshot(candidate, manifest, limits))) {
        throw new DomainValidationError("preflight changed observed source or protected bytes; retain failed candidate");
      }
    };
    const run = async (command: { id: string; command: string; args: readonly string[] }, timeoutMs: number,
      maxStdoutBytes: number, maxStderrBytes: number): Promise<{ result: AuthorizedCommandRunResult; durationMs: number }> => {
      ensureActive();
      if (timeoutMs <= 0) throw new DomainValidationError("preflight phase time budget exhausted");
      const commandStart = performance.now();
      const result = await runAuthorizedCommand({ executable: command.command, args: command.args, cwd: candidate, env: {},
        timeoutMs: Math.max(1, Math.floor(timeoutMs)), maxStdoutBytes, maxStderrBytes, signal });
      if (result.cleanupUnsettled) {
        unsettledCommand = result;
        input.onCommandCleanupUnsettled?.(result);
      }
      return { result, durationMs: performance.now() - commandStart };
    };
    const preparationStart = performance.now();
    try {
      for (const command of spec.prepare) {
        const observed = await run(command, spec.budget.prepareSeconds * 1000 - (performance.now() - preparationStart), 4096, 4096);
        const expected = complete(observed.result) && observed.result.ok && observed.result.exitCode === 0;
        preparation.push({ id: command.id, ...observed, expected });
        if (!expected) throw new DomainValidationError(`preparation ${command.id} did not complete successfully`);
        unchanged();
      }
    } finally { preparationMs = performance.now() - preparationStart; }
    const checksStart = performance.now();
    try {
      for (const check of spec.checks) {
        const observed = await run(check, Math.min(check.timeoutMs ?? DEFAULT_RECIPE_TIMEOUT_MS,
          spec.budget.checkSeconds * 1000 - (performance.now() - checksStart)),
        check.maxStdoutBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES, check.maxStderrBytes ?? DEFAULT_RECIPE_OUTPUT_BYTES);
        const expected = expectedCheck(observed.result, check);
        checks.push({ id: check.id, ...observed, expected });
        if (!expected) throw new DomainValidationError(`base check ${check.id} did not establish its expected ${check.expect.baseline} result`);
        unchanged();
      }
    } finally { checksMs = performance.now() - checksStart; }
    unchanged();
    ensureActive();
    ok = true;
  } catch (error) { reason = error instanceof Error ? error.message : String(error); }
  const artifactDirectory = path.join(state, "preflight");
  let artifactPath = path.join(artifactDirectory, `${randomUUID()}.json`);
  const record = () => ({ kind: "development-preflight", sourceRevision: input.sourceRevision,
    candidatePath: candidate, ok, reason, effectsSettled: unsettledCommand === undefined,
    preparation, checks, unobservedChecks: spec.checks.slice(checks.length).map((check) => check.id),
    preparationMs, checksMs, totalMs: performance.now() - started, modelInvocations: 0, costUsd: null });
  const correctExpired = (): void => {
    if (ok && expired()) { ok = false; reason = "preflight cancelled or total time budget exhausted during persistence"; }
  };
  try {
    await mkdir(artifactDirectory, { recursive: true });
    correctExpired();
    await writeFile(artifactPath, `${JSON.stringify(record(), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (ok && expired()) {
      const supersedesArtifactPath = artifactPath;
      correctExpired();
      artifactPath = path.join(artifactDirectory, `${randomUUID()}.json`);
      await writeFile(artifactPath, `${JSON.stringify({ ...record(), supersedesArtifactPath }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    return Object.freeze({ ok, reason, effectsSettled: unsettledCommand === undefined, artifactPath, preparationMs, checksMs,
      ...(unsettledCommand === undefined ? {} : { unsettledCommand }) });
  } catch (error) {
    // Persistence failure must not erase the runner's unresolved effects.
    if (unsettledCommand !== undefined) {
      const unsettled = new CommandCleanupIncompleteError(unsettledCommand);
      unsettled.cause = error;
      throw unsettled;
    }
    throw error;
  } finally { clearTimeout(timer); }
}