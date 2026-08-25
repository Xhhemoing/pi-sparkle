# R6-1 — The gate's BLOCKED and the loop's FAILED disagree · option (a) shipped

**Result: DONE.** The flowchart loop now respects the tracking gate. A clustered child that returns
`outcome: SUCCESS` with `verification: { kind: "FAILED" }` ends the run **BLOCKED** with the analysis
queued and the episode left waiting — resumable, injectable, and replaying with `anomalies: []` —
instead of `RUN_BLOCKED` followed by a `RUN_FAILED` that replay flagged as a double terminal.

Branch `agent/opt-continuous`, no commit. Task-assigned HEAD was `b4cc072`; the parent advanced the
branch to `e472359` mid-slot (R6-4/6/8/10 landings) and everything below was verified at `e472359`
with the other slots' in-flight edits in the tree.

- Owned diff: `src/run/flowchart-run.ts`, `src/run/replay.ts`, `test/unit/run/replay.test.ts`, new
  `test/unit/run/gate-outcome.test.ts`.
- `gate-apply.ts` untouched, as instructed. Its comment ("replay/resume treat `RUN_BLOCKED` as
  terminal BLOCKED until an explicit unblock") was already true; the loop is what disagreed with it.

## 1. Census, before trusting the brief

Reproduced the reviewer's finding first, unmodified, one node through `compileChildrenToFlowchart`
with a clustered child whose `TASK_RESULT` is `SUCCESS` + `verification: FAILED`:

```
PROJECT_DISCOVERED -> RUN_CREATED -> EPISODE_OPENED -> RUN_ATTACHED -> RUN_STARTED -> MODEL_ROUTED
  -> CHILD_RUN_CREATED -> CHILD_MESSAGE -> CHILD_MESSAGE
  -> TRACKING_ASSESSMENT -> GATE_TRANSITION -> RUN_BLOCKED -> LEDGER_UPDATED -> RUN_FAILED -> EPISODE_CLOSED
status: FAILED   checkpoint.status: FAILED   anomalies: ["multiple terminal events"]
RUN_BLOCKED {"reason":"ANALYSIS_QUEUED","requiredEvidence":["evd_vf-tsk_verify"]}
RUN_FAILED  {"reason":"flowchart node failed: tsk_verify"}
```

The brief's line numbers and mechanics all check out: `applyChildThreeLine` →
`assessChildObservation` (a FAILED verification is `deterministicFail`, so `evaluateGates` returns a
hard gate) → `mapGateDirective` → `queue_analysis` → `RUN_BLOCKED`; the same result maps to a node
`FAILURE` through `childNodeResultFromExecution`, so the supervisor reads FAILED and the loop reached
`persistFailed`, whose only guard was a prior `RUN_FAILED`.

Two census findings that changed how I scoped the fix:

1. **The flowchart loop was the outlier, not the gate.** The sibling embedder `startParentRun`
   (`coordinator.ts:587-597`) already consumes the same `applyChildThreeLine` and, on
   `queue_analysis`, sets `trackingBlocked` and **breaks out of the terminal-append branch entirely**
   — a gate-blocked parent run appends no `RUN_COMPLETED`/`RUN_FAILED`. And
   `recordCrashTerminal` (`crash-terminal.ts:63`) records a terminal only for a log replaying
   `PLANNING`/`RUNNING`, so the crash path already refused to write over a BLOCKED log. Option (a)
   makes the flowchart loop the third plane to follow a contract two planes already kept, rather
   than inventing one.
2. **The supervised plane cannot hit this.** `supervisor.ts`'s only gate call is
   `settleSupervisedOutcome`, which returns early unless `trackingAssessment` is supplied — a no-op
   on every production path (R5-2 residual 2, R6-9's known suspect). No collision there today.

## 2. The decision, as implemented

**The run's terminal is the first terminal its log replays.** One definition of "terminal", exported
from `replay.ts` and consumed by both the anomaly rule and the writers:

```ts
export const TERMINAL_REPLAY_STATUSES: ReadonlySet<RunStatus> = new Set(["COMPLETED", "FAILED", "BLOCKED"]);
export function replayedTerminalStatus(events: readonly Event[]): RunStatus | undefined;
```

That set is exactly the statuses `replayRun` sets `sawTerminal` for, so the loop and the anomaly rule
cannot drift: if one side learns a new terminal, the other must too (pinned twice).

In `flowchart-run.ts`, all three terminal recorders — `persistBlocked`, `persistCompleted`,
`persistFailed` — now consult one private helper `alreadyTerminal(ctx)` and refuse when the log
already replays a terminal. The refusal is silent by construction: a terminal the log already carries
is not news, and `finish()` reports the status the log replays either way. Each recorder's old
single-event guard (`hasEvent(RUN_FAILED)` etc.) is *subsumed* — a log carrying `RUN_FAILED` replays
FAILED — so idempotence is preserved, not replaced. `hasEvent` had no other caller and is gone.

Ordering inside `persistFailed` is unchanged: `cancelAndSettle()` still runs **before** the read, so a
refused failure still stops paying for children first.

### The decided log shape, pinned

```
… CHILD_MESSAGE -> TRACKING_ASSESSMENT -> GATE_TRANSITION -> RUN_BLOCKED -> LEDGER_UPDATED -> EPISODE_WAITING
status: BLOCKED   checkpoint.status: BLOCKED   anomalies: []   terminals: ["RUN_BLOCKED"]
GATE_TRANSITION  to: "BLOCKED", directive: "queue_analysis", reasonCode: "deterministic-fail"
RUN_BLOCKED      reason: "ANALYSIS_QUEUED", requiredEvidence: ["evd_vf-tsk_verify"]
```

`EPISODE_WAITING` rather than `EPISODE_CLOSED` falls out of `settleBoundEpisode`'s existing
`episodeCloseStatus` mapping (BLOCKED → WAITING) — the episode is left open for the operator, which
is what "resumable after an unblock" has to mean at the episode plane too. Nothing in
`episode-bind.ts` was touched.

## 3. Coherence with the frozen contracts

- **`preserveResumableState` (frozen):** untouched. `RESUMABLE_CRASH_STATUSES` already contained
  BLOCKED, which is precisely the state the old `RUN_FAILED` buried; the change makes the loop agree
  with a rule the crash path already followed.
- **Crash-terminal in-flight-only (frozen):** untouched, and unchanged in effect — it was already
  strictly stronger than the loop's guard.
- **`withRunLifecycleLock` source pin (frozen):** all four call sites untouched; `runLockPath` is
  still never rebuilt in this file. `test/unit/run/run-lifecycle-lock.test.ts` green (7 pins).
- **`applyRetry` sole BLOCKED→READY producer (frozen):** untouched. Note the honest scope below.
- **Exactly-one-terminal:** now enforced at the writer, not just observed at the reader. Pinned as
  `terminals(events)` deep-equal to a one-element array in four of the five new run-level tests.

## 4. Reachability, measured — including what the change does *not* fix

`persistCompleted`'s new refusal covers the sharper direction (a run reporting COMPLETED over a log
the gate had BLOCKED — the false-success direction). **I could not reach it today, and I am not
claiming it as a fixed defect.** Measured, not assumed: `applyChildThreeLine` is the only gate
producer on the flowchart plane, and `assessChildObservation` only applies at all for verification
`PASSED` or `FAILED`. I probed five PASSED shapes (rich, tester-with-required-checks, no
artifacts/empty summary, PARTIAL outcome, mandatory contract constraints) and every one scored 1.0
with `gate.kind: "none"`; a FAILED verification always maps the node to `FAILURE`, so the supervisor
can never read COMPLETED for the node the gate blocked. So `persistCompleted`'s guard is
defence-in-depth against a future gate producer, not a reachable bug closed. Stated so the next
reader does not over-credit it.

**What is genuinely still open (not this slot's, by ownership):**

- **There is no unblock event.** `replayRun` has nothing that clears `RUN_BLOCKED`, so a run that
  reaches BLOCKED replays BLOCKED forever. `injectFlowchartRun` accepts a BLOCKED run
  (`INJECTABLE_STATUSES`) and `resumeFlowchartRun` re-drives it, so the operator surface is there and
  the state is genuinely actionable — but "resumable after an unblock" is today "resumable and still
  reported BLOCKED". The pre-existing stall-block behaves identically (`m2.5/flowchart-run.ts`:
  blocked → resume → BLOCKED), so this change introduces no new dead end; it moves one more case into
  a posture the tree already had. An explicit unblock event is a schema decision for a later round.
- **`coordinator.ts`'s catch-all** (`:618-621`) appends `RUN_FAILED` unconditionally on an escaping
  error, without the in-flight check `recordCrashTerminal` applies. Same double-terminal hazard, crash
  path only, in a file unowned this round. Handing it to the parent as Round 7 evidence.

## 5. Tests

**New: `test/unit/run/gate-outcome.test.ts` (6 tests).** The reviewer's repro is the seed: one node,
`compileChildrenToFlowchart`, a clustered child spec, an executor whose `TASK_RESULT` is
`SUCCESS` + `verification: FAILED`.

1. *a verification-failed clustered child ends BLOCKED with the analysis queued* — status,
   checkpoint status, the six-event tail deep-equal, `GATE_TRANSITION.directive`/`.to`,
   `RUN_BLOCKED.reason === "ANALYSIS_QUEUED"` and its `requiredEvidence`, exactly one terminal,
   `anomalies: []`.
2. *the blocked run stays operator-actionable* — `EPISODE_WAITING` present, `EPISODE_CLOSED` absent,
   and a real `injectFlowchartRun` fact injection succeeds against the blocked run without moving its
   terminal. This is the state the old `RUN_FAILED` buried, exercised rather than asserted.
3. *resuming the blocked run repeats the block rather than burying it* — resume → BLOCKED, no second
   terminal, no `RUN_FAILED`, `anomalies: []`. (The node is still FAILED in the restored supervisor,
   so this is the idempotence that matters.)
4. **Negative control** — *a node that fails without a gate block still records `RUN_FAILED`*: an
   executor that reports no result at all gives FAILED with `RUN_FAILED` and no `GATE_TRANSITION`.
   The refusal is keyed on the log's replayed terminal, not on "a failed node never fails the run".
5. **Negative control** — *a verification-passed clustered child still completes*: COMPLETED with
   `RUN_COMPLETED`.
6. **Source pin** — the loop's refusal and replay's anomaly rule read the same terminal set.

Falsification check: with `persistFailed` reverted to its old `hasEvent(RUN_FAILED)` guard, tests 1–3
fail and 4–6 pass. The pins bite on exactly the changed behaviour and the controls prove the change
is narrow.

**Additive in `test/unit/run/replay.test.ts` (2 tests, existing 10 untouched).**

- *`RUN_BLOCKED` is a terminal, so a `RUN_FAILED` after it is a second one* — pins the ordering the
  loop must never produce (`anomalies: ["multiple terminal events"]`) alongside the clean BLOCKED-only
  log. Replay stays the arbiter; the writers consult it, not the other way round.
- *`replayedTerminalStatus` names the terminal a log already carries* — `undefined` for empty,
  RUNNING, paused, and cancel-requested logs (a cancel request sets no `sawTerminal`, so it names
  none here either); COMPLETED/FAILED/BLOCKED for each terminal; the set contents pinned.

### Census: suites asserting `anomalies` deep-equals `[]`

The brief asked me to fix or annotate these. **None needed either** — none of them drives a
verification-failed clustered child, so none saw the anomaly at HEAD, and all stay green:
`flowchart-run-abort.test.ts` (5 sites), `m2/supervisor-crash.test.ts` (4),
`m1-replay.test.ts` (2), `replay.test.ts` (3). The ambiguity they "relied on" was coverage, not an
assertion — the new file is what closes it. `src/cli/main.ts:1115` prints anomalies in `inspect`; that
operator surface is unchanged and now shows nothing for this case, which is the point.

## 6. Verification

- `npx eslint` on the four owned files — clean, exit 0.
- `npx tsc --noEmit` whole tree — clean, exit 0.
- `test/unit/run` + `test/unit/tracking` **3×**: 220/220 pass each run (the run plane spawns child
  coordinators, so it is the timing-sensitive set).
- `test/unit/run/gate-outcome.test.ts` + `replay.test.ts` + `flowchart-run-abort.test.ts` +
  `test/integration/m2.5` + `test/integration/m3` **3×**: 90/90 pass each run.
- Whole `test/unit`: 1499 tests, 1498 pass, 1 fail — *foreign*: `bandit reaches the live closure as a
  reward writer, never as a selector` (`test/unit/episode/closure.test.ts`, a concurrent slot's
  in-flight `src/episode/closure.ts` edit; imports nothing of mine).
- Whole `test/integration`: 256 tests, 254 pass, 1 skip (the standing `PI_SMOKE=1` gate — I introduced
  no second skip), 1 fail — *foreign*: `real process kills preserve persistence recovery invariants`
  (`test/integration/persist/crash-recovery.test.ts` expects the pre-R6-8 probe case list and now sees
  R6-8's added `sigkill-run-lock-operator-recovery`; the test only spawns `scripts/crash-probe.mjs`
  and imports nothing of mine).
- Both foreign failures attributed by file, not by report hearsay. I additionally re-ran
  `flowchart-run-abort.test.ts` with **only my two `src/` files reverted to HEAD** to confirm an
  earlier R6-2 in-flight failure there was not mine (it failed identically without my change; R6-2 has
  since fixed it — that suite is 20/20 now).
- No full gate (parent's job). No scratch files in the repo.

## 7. Disclosures

1. **`run --children` stderr changes for this case (`src/cli/main.ts`, R6-5's file — not edited).**
   The run now returns BLOCKED, so `main.ts:908`'s `if (outcome.status === "FAILED")` branch no longer
   fires: the operator loses the `reason: flowchart node failed: …` line and the `error:`/`next: pnpm
   cli inspect --run …` block. **The exit code is unchanged** — `flowchartExitCode("BLOCKED")` is
   `CLI_EXIT.error` (1), exactly as FAILED was. `printFlowchartOutcome` still shows
   `Run <id>: BLOCKED` and `flowchart: FAILED (tsk_x=FAILED)`, so the node failure remains visible on
   stdout. I censused `test/**` for pins on that wording: **none** (`flowchart node failed` appears
   only in my own new replay fixture). Suggested follow-up for R6-5 or Round 7, not done here because
   `main.ts` is sole-owned this round: a BLOCKED flowchart run deserves its own `next:` line naming
   the queued analysis and the required evidence, the way R5-9 routed the other two codes.
2. **`persistBlocked` and `persistCompleted` guards widened beyond the letter of the sign-off.** The
   sign-off named `persistFailed` and "`persistBlocked` interplay"; I applied one uniform rule to all
   three recorders because a per-recorder rule is the thing that produced this defect. Both widenings
   are unreachable in the current tree (§4 for `persistCompleted`; `persistBlocked` is only reached
   from paths that return immediately after a terminal), so the behavioural change is confined to the
   `persistFailed` case the parent signed off. Flagging it as scope so the reviewer prices it.
3. **`replay.ts` gained two exports, no behaviour change.** `replayRun`'s output is byte-identical;
   `TERMINAL_REPLAY_STATUSES` and `replayedTerminalStatus` are additive. `replayedTerminalStatus`
   calls `replayRun` rather than re-scanning, deliberately: a cheaper private scan is exactly how the
   two notions of "terminal" would drift again.
4. **No perf claim.** The change replaces one `events.some(...)` with one `replayRun(...)` over the
   same already-read array, at most three times per run, on the terminal path only. No bench run and
   none claimed.
5. **`gate-apply.ts`, `child-tracking.ts`, `episode-bind.ts`, `crash-terminal.ts`,
   `childTasksFromDefinition` (R6-2's) — all untouched.**

## 8. Handoff

- **Round 7 candidate:** an explicit unblock event, so a BLOCKED run can replay as RUNNING again after
  the queued analysis is answered. Today `applyRetry` is the sole BLOCKED→READY producer at the
  *scheduler* level and there is no run-plane equivalent; this slot deliberately did not invent one.
  With this change landed, that is the only thing standing between "resumable" and "resumed".
- **To the parent / Round 7:** `coordinator.ts:618-621`'s unconditional crash `RUN_FAILED` (§4).
- **To R6-7 (docs):** the decided contract for the data dictionary — *a flowchart run records exactly
  one terminal, the first one its log replays; a tracking-gate `queue_analysis` therefore beats a
  later node failure, and a verification-failed child ends the run BLOCKED with `ANALYSIS_QUEUED`,
  the episode WAITING, and the run injectable and resumable.*
