import type { TaskId } from "../domain/ids.js";
import type { Event } from "./events.js";
import { replayedTerminalStatus } from "./replay.js";

/**
 * Normal terminal recording inside the caller's existing single-writer scope.
 * The caller retains lifecycle locks, cancellation ownership, checkpoint and
 * crash handling. This module neither acquires a lock nor finishes a run.
 */
export interface FlowchartTerminalContext {
  readonly eventStore: { readAll(): Promise<{ events: readonly Event[] }> };
  readonly supervisor: {
    snapshot(): {
      ledger: {
        round: number;
        consecutiveStalls: number;
        requiredEvidence: readonly { description: string }[];
      };
    };
  };
  readonly abort: { cancelAndSettle(): Promise<void> };
  readonly append: (event: Event) => Promise<void>;
  readonly make: (type: Event["type"], payload: unknown, taskId?: TaskId) => Event;
}

/**
 * The run's terminal is whatever its log already replays.
 *
 * The three terminal recorders below all consult this before appending, so a run
 * records exactly one terminal — the first one that landed. The case that forced
 * the rule: a clustered child that returns `outcome: SUCCESS` with
 * `verification: { kind: "FAILED" }` drives the three-line gate to
 * `queue_analysis`, which appends `RUN_BLOCKED` ("terminal BLOCKED until an
 * explicit unblock", per `gate-apply.ts`), and the same result fails the node, so
 * the loop then reached {@link persistFailed}. The log said BLOCKED and FAILED at
 * once, `replayRun` flagged it, and the FAILED buried a state
 * `RESUMABLE_CRASH_STATUSES` and `INJECTABLE_STATUSES` in `flowchart-run.ts`
 * both treat as operator-actionable. The gate wins: that run ends BLOCKED with the analysis
 * queued, and stays resumable.
 *
 * Refusing is silent by construction — a terminal the log already carries is not
 * news, and the loop reports the status it replays either way.
 */
async function alreadyTerminal(ctx: FlowchartTerminalContext): Promise<boolean> {
  const read = await ctx.eventStore.readAll();
  return replayedTerminalStatus(read.events) !== undefined;
}

export async function persistBlocked(ctx: FlowchartTerminalContext): Promise<void> {
  if (await alreadyTerminal(ctx)) return;
  const ledger = ctx.supervisor.snapshot().ledger;
  const requiredEvidence = ledger.requiredEvidence.map((entry) => entry.description);
  await ctx.append(
    ctx.make("STALL_DETECTED", {
      round: ledger.round,
      consecutiveStalls: ledger.consecutiveStalls,
      requiredEvidence
    })
  );
  await ctx.append(ctx.make("RUN_BLOCKED", { reason: "no progress for too many rounds", requiredEvidence }));
}

export async function persistCompleted(ctx: FlowchartTerminalContext): Promise<void> {
  if (await alreadyTerminal(ctx)) return;
  await ctx.append(ctx.make("RUN_COMPLETED", {}));
}

export async function persistFailed(ctx: FlowchartTerminalContext, reason: string): Promise<void> {
  // Stop paying for children before recording the failure, not after.
  await ctx.abort.cancelAndSettle();
  if (await alreadyTerminal(ctx)) return;
  await ctx.append(ctx.make("RUN_FAILED", { reason }));
}
