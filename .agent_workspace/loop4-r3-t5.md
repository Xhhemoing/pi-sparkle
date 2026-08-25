claude-opus-5-thinking-high-fast

# Loop 4 · Round 3 — R3-5: terminal events on escaping errors

- **Slot:** R3-5 (P2, disaster-recovery honesty), from `ROUND2-BRIEF.md` §4.
- **Ownership held exactly:** `src/run/flowchart-run.ts`, `src/run/child-coordinator.ts`, `test/unit/run/flowchart-run-abort.test.ts`, `test/integration/m2.5/children-flowchart.test.ts`. No other file touched; nothing committed.
- **Baseline:** `agent/opt-continuous` @ `152bdb4`, Node v22.14.0.

## 1. The defect, reproduced before fixing

R2-1's disclosure is real on both planes:

- **Run plane.** `withRunTeardown` caught an escaping error, called `cancelAndSettle()`, and rethrew. The children stopped, but nothing was appended to `runtime/runs/<id>/events.jsonl`, so `replayRun` returned `RUNNING` for a run no process was running any more — the log just stops after the last node event.
- **Child plane.** A `runTask` throw rejected the handle's `done` promise and unwound to the parent, but the child's own log kept whatever it had (typically `RUN_CREATED`, `RUN_STARTED`) with no terminal event. The existing R2-1 integration scenario hits this exactly: the peer that cannot build its prompt throws out of `runAttempt` before `AGENT_STARTED` is even appended.

Both reproduced as the two negative controls in §4.

## 2. What changed

**`src/run/flowchart-run.ts`** — new module-private `recordCrashTerminal(ctx, error)`, called from `withRunTeardown` after `cancelAndSettle()` (the same "stop paying, then record" order `persistFailed` already uses), before the rethrow. It reuses `RUN_FAILED` with reason `run crashed: <error message>`; no new event type, no payload change. Two properties are load-bearing:

- *Best effort.* The whole body is inside `try { … } catch { }`. An unreadable or torn log, or a rejected append, is swallowed — the error already on its way out is the one the operator needs.
- *In-flight only.* It appends only when the persisted log still replays as `PLANNING` or `RUNNING`. Anything else already has an honest status of its own: `COMPLETED`/`FAILED`/`BLOCKED` would become a duplicate terminal (an anomaly `replayRun` explicitly flags), and `PAUSED`/`WAITING_FOR_USER`/`CANCELLED` are states an operator can still act on — a crash *while tearing down a pause* must not convert a resumable run into a dead one.

The reason string is clamped to 500 characters, matching the coordinator's existing `SUMMARY_LIMIT` posture, so an enormous error message cannot bloat the event log; an empty message degrades to `run crashed: unknown error` (the `RUN_FAILED` payload validator requires a non-empty reason).

**`src/run/child-coordinator.ts`** — the child-side equivalent. `startChildTask`'s promise chain now catches a `runTask` throw, calls the new private `recordCrashTerminal(childRunId, taskId, error)`, and rethrows unchanged. Same best-effort posture; the duplicate guard is a direct terminal-type check on the child's own log (`RUN_COMPLETED` / `RUN_FAILED` / `RUN_CANCEL_REQUESTED`) rather than a replay, because a child log carries no pause or waiting states — those go to the parent store. Reason: `child run crashed: <error message>`, bounded through the file's existing `bounded()`.

R2-1's abort wiring and T6's cancel/wall-time semantics are untouched: `RunAbortScope`, `cancelAndSettle()`, the `onSpawn` post-abort refusal, the attempt/wall timers, `cancelledChildren`, and the existing terminal-event selection at the end of `runTask` are all byte-identical.

## 3. Replay / resume for a crashed run (the pin)

With the terminal appended, `replayRun` returns `FAILED` with no anomalies, and `resumeFlowchartRun` short-circuits: `resumeRestoredRun` sees a terminal status and goes straight to `finish(ctx)`, so a crashed run reports its failure and starts no executor work. Pinned in both owned test files (`resume redoes no work`, asserting the resume executor recorded zero task ids; and the integration resume returning `FAILED`).

Note on the checkpoint: the crash path appends the event only, so `checkpoint.json` keeps the status it had when it was last written. Resume re-materializes and rewrites it from the log inside `finish`, so the two converge on the first resume; deliberately not widened, since writing a checkpoint from a half-unwound supervisor is exactly the kind of thing a best-effort path should not do.

## 4. Verification

Negative controls (owned test files kept, one owned source file reverted to HEAD at a time):

| Control | Result |
|---|---|
| `src/run/flowchart-run.ts` at HEAD | unit tests 5 and 6 fail (no `RUN_FAILED`; replay `RUNNING`), 6/8 pass |
| `src/run/child-coordinator.ts` at HEAD | integration test 3 fails (crashed child's log has no terminal), 2/3 pass |

The two guard tests do not move under those controls by construction, so each was mutation-checked against the new code instead:

| Mutation | Result |
|---|---|
| drop the `PLANNING`/`RUNNING` status guard | test 7 fails — the paused run gets overwritten with `RUN_FAILED` |
| drop the `try`/`catch` swallow in `recordCrashTerminal` | test 8 fails — the torn-log read masks `pause token unreadable` |

Tests added (5 total; all four unit tests are new, plus one integration test):

- *unit* — an escaping error records exactly one `RUN_FAILED` naming the error, and no node ran.
- *unit* — a crashed run replays as `FAILED` with no anomalies and resumes without redoing work.
- *unit* — a crash while resuming a paused run leaves the log `PAUSED` and terminal-free.
- *unit* — a terminal append that cannot land still rethrows the original error and writes nothing.
- *integration* — the escaping-peer scenario: every run log under the state root ends with exactly one terminal event; the parent's reason is `run crashed: profile lookup failed for tester`; the child that died launching (no `AGENT_STARTED`) closes its own log with `child run crashed: …`; resuming the parent yields `FAILED`.

The unit tests drive the crash through a pause controller whose `token()` throws, because the thin-executor node path swallows its own throws (`executeRemainingRunningNodes` catches and degrades to `FAILURE`) and cannot produce an escaping error.

Commands run on this VM:

- `npx eslint` scoped to the four owned files → exit 0, no output.
- `npx tsc --noEmit` whole tree → exit 0, clean.
- Owned files 3× → 11/11 pass each time, no flake.
- Wider blast radius, all green: `test/unit/run/*`, `test/integration/m1`, `m2`, `m2.5`, `m3`, `test/integration/cli`, `test/unit/cluster` → 295 tests, 0 fail, 0 skip.

Shared-tree transient: mid-slot, `tsc --noEmit` reported five errors in `src/cli/doctor.ts` (R3-6) and `src/run/scheduler.ts`'s test call sites (R3-8) while those slots were editing. Attributed by file, not touched; the final whole-tree run is clean.

## 5. Disclosures / residuals

- **The child-side duplicate guard is defensive and unpinned.** Today nothing in `runTask` can throw after its terminal append (only the return object is built), so no test can reach the guard through a public seam. It stays because it costs one read and protects the invariant against a future edit that adds work after the append; a reviewer who prefers a pinned-only posture can drop the check and lose nothing observable today.
- **The gate is released a touch later on the crash path.** The best-effort append is awaited inside the catch, so `ConcurrencyGate.release()` runs after it. One small append on an already-failing path; measurable only in a test that counts event-loop turns.
- **Statuses other than in-flight are deliberately left silent.** A run that crashes while tearing down a `WAITING_FOR_USER` or `PAUSED` state still ends its log with no terminal event — that is the honest outcome (the state it recorded is still true and still actionable), but it means the original "log just stops" shape survives for those cases. Widening it would need a resumability decision, not a smallest fix.
- **No `package.json`, no ADR, no R1/Outcome/auto-promote surface touched. Nothing committed.**
