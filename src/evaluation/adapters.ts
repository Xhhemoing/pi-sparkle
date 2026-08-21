import type { EpisodeId, RunId, TaskId } from "../domain/ids.js";
import type { EvaluationOutcome } from "./types.js";

export type AdapterTrustClass = "deterministic" | "observed" | "inferred";

export type AdapterUnavailable = "ABSTAIN" | "UNOBSERVED" | "FAIL";

export interface AdapterDeclaration {
  readonly supportedCriteria: readonly string[];
  readonly inputContract: string;
  readonly trustClass: AdapterTrustClass;
  readonly timeoutMs: number;
  readonly unavailableSemantics: AdapterUnavailable;
  readonly evidenceOwner: "system" | "user" | "agent";
}

export interface AdapterContext {
  readonly episodeId: EpisodeId;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
  readonly workingDirectory: string;
  readonly revision: string;
  readonly changeSet: readonly string[];
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly command: string;
  readonly cwd: string;
  /** Revision the result was produced against; a mismatch marks the result stale. */
  readonly revision?: string | undefined;
  /** Declared execution environment policy; omit when none was recorded. */
  readonly environmentPolicy?: string | undefined;
  /** Change set the result was produced against; a mismatch marks the result stale. */
  readonly changeSet?: readonly string[] | undefined;
}

export interface DiffScope {
  readonly episodeOwned: readonly string[];
  readonly unrelatedUser: readonly string[];
  readonly generated: readonly string[];
  readonly unknown: readonly string[];
}

export interface DeliveryEvidence {
  readonly manualAcceptance?: boolean;
  readonly userComment?: string;
  readonly rollbackDetected?: boolean;
  readonly reopenDetected?: boolean;
}

export interface AdapterEvaluation {
  readonly outcome: EvaluationOutcome;
  readonly evidenceRef?: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ProjectAdapter {
  readonly declaration: AdapterDeclaration;
  evaluate(
    context: AdapterContext,
    input: unknown
  ): Promise<AdapterEvaluation>;
}
