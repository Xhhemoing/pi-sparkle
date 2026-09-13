import type { RunId } from "../domain/ids.js";
import {
  evaluateIndependentAcceptance,
  type ClosedLoopAcceptance,
  type SelfReportClaim
} from "./acceptance.js";
import { runIndependentCheck, type IndependentCheckRecord } from "./independent-check.js";
import { saveLoopArtifact, type LoopArtifactRef } from "./loop-artifact.js";
import {
  createIsolatedWorktree,
  disposeIsolatedWorktree,
  readWorktreeRevision,
  type IsolatedWorktree
} from "./worktree.js";

export interface ClosedLoopSession {
  readonly worktree: IsolatedWorktree;
  readonly revisionAtStart: string;
}

export interface OpenClosedLoopInput {
  readonly sourceRepo: string;
  readonly sandboxRoot?: string;
}

/** Open an isolated worktree for a closed-loop run (tools injected separately at the pi-adapter boundary). */
export async function openClosedLoop(input: OpenClosedLoopInput): Promise<ClosedLoopSession> {
  const worktree = await createIsolatedWorktree({
    sourceRepo: input.sourceRepo,
    ...(input.sandboxRoot !== undefined ? { sandboxRoot: input.sandboxRoot } : {})
  });
  const revisionAtStart = readWorktreeRevision(worktree.cwd);
  return { worktree, revisionAtStart };
}

export async function closeClosedLoop(session: ClosedLoopSession): Promise<void> {
  await disposeIsolatedWorktree(session.worktree);
}

export interface RunClosedLoopCheckInput {
  readonly session: ClosedLoopSession;
  readonly stateRoot: string;
  readonly runId: RunId;
  readonly command: string;
  readonly args?: readonly string[];
  readonly selfReport?: SelfReportClaim;
  /** Extra body fields stored alongside the acceptance artifact. */
  readonly note?: string;
}

export interface ClosedLoopResult {
  readonly check: IndependentCheckRecord;
  readonly artifact: LoopArtifactRef;
  readonly acceptance: ClosedLoopAcceptance;
}

/**
 * Independent check → save artifact → record acceptance. Self-report is
 * optional and never sufficient alone.
 */
export async function runClosedLoopCheck(input: RunClosedLoopCheckInput): Promise<ClosedLoopResult> {
  const cwd = input.session.worktree.cwd;
  const revision = readWorktreeRevision(cwd);
  const check = runIndependentCheck({
    cwd,
    command: input.command,
    ...(input.args !== undefined ? { args: input.args } : {})
  });

  const provisional = {
    kind: "ps-p3-closed-loop" as const,
    note: input.note ?? "",
    revision,
    cwd,
    command: input.command,
    args: input.args ?? [],
    check,
    ...(input.selfReport !== undefined ? { selfReport: input.selfReport } : {})
  };
  const artifact = await saveLoopArtifact({
    stateRoot: input.stateRoot,
    runId: input.runId,
    body: provisional
  });

  const acceptance = evaluateIndependentAcceptance({
    ...(input.selfReport !== undefined ? { selfReport: input.selfReport } : {}),
    independentCheck: check,
    artifactHash: artifact.sha256,
    revision,
    cwd,
    command: input.command
  });

  await saveLoopArtifact({
    stateRoot: input.stateRoot,
    runId: input.runId,
    body: { ...provisional, acceptance, artifactHash: artifact.sha256 }
  });

  return { check, artifact, acceptance };
}
