# Loop 4 · Round 4 · R4-4 — Paused/waiting crash semantics, decided

Slot: R4-4 (P2/P3, disaster-recovery honesty). Investigation-first; the deliverable is a decided,
pinned contract.

Owned and touched: `src/run/flowchart-run.ts` (teardown region only — `recordCrashTerminal`,
`withRunTeardown`, and `injectFlowchartRun`'s teardown tail), `src/run/child-coordinator.ts`,
`test/unit/run/flowchart-run-abort.test.ts`, `test/integration/m2.5/children-flowchart.test.ts`.
Not touched: `createClusterHost` and the outcome/summary plumbing in `flowchart-run.ts` (R4-2's
region — its `clusterMail`/`clusterHost` edits landed in the shared tree alongside mine and are
untouched by this slot).

**No schema addition.** No new event type, no new payload field, no persisted-shape change.

---

## 1. What the investigation found

R3-5's disclosure was that a run crashing while it tears down a `PAUSED`/`WAITING_FOR_USER` state
records no terminal, deliberately, and that the operator therefore cannot tell "paused, waiting for
me" from "paused, then the process died". I set out to prove the accompanying claim — that resuming
such a run loses no work — and it **was false**. Two separate silent-loss windows, both on the
forbidden list ("a paused run that silently lost work"):

### Finding 1 — the resume point can sit a node behind the log

Every node result is applied to the supervisor (`applyChildResult`) *before* the checkpoint that
records it is written. A crash in that window is harmless for a run that also gets a terminal
(resume reports `FAILED` and runs nothing), but a resumable run restores the stale checkpoint and
**re-executes a node that had already finished and been recorded**.

Measured by sweeping the crash point across a resumed two-node run (`a` already COMPLETED and
durable, `b` executing). The crash is injected `budget` id generations after node `b`'s child
reports its `TASK_RESULT`; any dep failing at that seam has the same shape.

| budget | crash lands on | log replays | checkpoint (before fix) | resume re-runs `b`? | checkpoint (after fix) | resume re-runs `b`? |
|---|---|---|---|---|---|---|
| 0 | child's `AGENT_FINISHED` | PAUSED | `b: RUNNING` | yes | `b: RUNNING` | yes |
| 1 | child's `RUN_COMPLETED` | PAUSED | `b: RUNNING` | yes | `b: RUNNING` | yes |
| 2 | parent's `TRACKING_ASSESSMENT` | PAUSED | `b: RUNNING` | yes | `b: RUNNING` | yes |
| **3** | parent's `LEDGER_UPDATED` | PAUSED | **`b: RUNNING`** | **yes** | **`b: COMPLETED`** | **no** |
| 4 | `RUN_COMPLETED` | PAUSED | `b: COMPLETED` | no | `b: COMPLETED` | no |

Budget 3 is the defect: the supervisor had accepted node `b`, the log carried the child's
`TASK_RESULT` *and* the three-line assessment, the child run had closed its own log with
`RUN_COMPLETED` — and resume paid for the whole node again, producing a second child run for the
same task, with nothing anywhere saying so.

Budgets 0–2 are the at-least-once boundary: the result had not been accepted yet, so no checkpoint
can preserve it. See §3.

Premise for the scenario, and why it is not tampering: resuming a paused run executes when the pause
*token* is gone but the log's `PAUSE_REQUESTED` is still unmatched. `resumeRestoredRun` clears the
token before it appends `PAUSE_CLEARED`, so a process that dies between those two lines leaves
exactly that state on disk. The pin's helper says so at its definition.

### Finding 2 — a crash during `inject` silently drops the injection

`injectFlowchartRun` appends `INJECTION_REQUESTED`, applies it to the supervisor, advances the
round, and only then reaches `finish`'s checkpoint write. A crash in between leaves the injection
**on the log but not in the checkpoint**, and resume rebuilds from the checkpoint and never replays
`INJECTION_REQUESTED`. The operator's injected fact is recorded and inert. Measured on a paused run:

| budget | `INJECTION_REQUESTED` on log | checkpoint facts (before) | checkpoint facts (after) |
|---|---|---|---|
| 0 | no | `{}` | `{}` |
| **1** | **yes** | **`{}`** | **`{"deploy-window":"closed"}`** |
| 2+ | yes | `{"deploy-window":"closed"}` | same |

### Finding 3 — the child-side duplicate guard is reachable through one published surface

`ChildCoordinator.recordCrashTerminal`'s already-terminal check cannot fire within a single child
run: `runTask` appends its terminal as its last act, so every throw precedes it. It is reachable
through `startChildTask`'s published `options.childRunId` — two child runs handed the same id share
one event log, and the second one's crash terminal would become that log's second. No production
caller passes the option today (census: `supervisor.ts:369`, `flowchart-run.ts:278,369`,
`coordinator.ts:380` all omit it). Kept and pinned rather than deleted — deleting it would let that
API use break the exactly-one-terminal invariant R3-5 established.

---

## 2. The decided contract

**A crash on a log that is still actionable records no terminal and leaves a resume point that is
never behind the log.** Concretely:

1. `PAUSED`, `WAITING_FOR_USER` and `BLOCKED` logs get **no** `RUN_FAILED` (unchanged from R3-5 —
   the in-flight-only rule is not widened).
2. Those same three states now get a **best-effort checkpoint flush** in teardown, so everything the
   dying process had applied is what resume restores. `preserveResumableState` in
   `flowchart-run.ts`; the terminal append runs first, so a run that just earned a terminal is no
   longer resumable when the flush re-reads the log.
3. The same flush — **and only the flush, never a terminal** — guards `injectFlowchartRun`'s
   teardown. Inject is a side channel that can be pointed at a run another process is still driving;
   failing that run from here would be a lie.
4. Anything still in flight at crash time is re-executed on resume, at-least-once as everywhere
   else, and stays inspectable: the interrupted attempt keeps its own child run and its own
   `CHILD_RUN_CREATED` in the parent log.
5. The child plane's duplicate-terminal guard stays, documented as reachable-by-published-API and
   pinned.

### Why no crash-provenance marker, and why that is not a gap

The brief's second option was to surface crash provenance at resume/inspect time. I declined it, on
evidence:

- **Both states now demand the same action.** A plain pause already cancels and settles every child
  before it records `PAUSE_REQUESTED` (`pauseIfRequested` calls `cancelAndSettle()` first), so a
  paused run and a died-mid-teardown paused run leave the same residue: no live children, an
  actionable log, and a resume point level with it. The operator's next move is `resume` either way,
  and it is now lossless either way. A marker would change no decision.
- **Recording one honestly needs schema.** Every existing event type either is terminal, means
  something else, or would misdescribe the state; a truthful non-terminal marker is a new event type
  and a persisted-shape change. The brief prefers pins+docs and requires parent sign-off for schema.
  Given the point above, the addition would buy disclosure without buying a different action.
- **Partial provenance already exists** where it costs nothing: a child interrupted by the crash
  closes its own log with `RUN_FAILED` reason `child run crashed: …` (R3-5), and inspect surfaces
  child runs. That is not a guarantee — a failure inside the append path itself leaves the child
  unclosed, measured at budget 1 above — so it is disclosed, not claimed.

**If the parent wants the marker anyway**, the shape is a non-terminal `RUN_CRASHED` event carrying
`reason`, appended by `preserveResumableState` in exactly the branch that now flushes, with
`replayRun` ignoring it for status. That is a schema addition and is explicitly *not* in this slot's
diff.

---

## 3. Disclosed, deliberately not closed

- **At-least-once for in-flight nodes (budgets 0–2).** A child's result that reached the log but was
  not yet accepted by the supervisor is re-executed on resume. Preserving it in teardown would mean
  applying a result while skipping its three-line gate — trading silent re-spend for a node marked
  COMPLETED without the gate events that justify it. Rejected; the retry is pinned as visible
  instead (two `CHILD_RUN_CREATED` for the same task, two distinct child run ids, each child log
  closed).
- **`pauseFlowchartRun` gets no flush.** It restores the supervisor from the checkpoint and only
  appends events before `finish`; it mutates no supervisor state, so its checkpoint cannot fall
  behind. Verified by reading the function, not assumed.
- **`BLOCKED` membership in `RESUMABLE_CRASH_STATUSES`** is pinned for the no-terminal half (test 12)
  but not for a checkpoint-delta: the loop always checkpoints immediately before `persistBlocked`,
  so I could not construct a stale-checkpoint window for it. Included because resume acts on a
  BLOCKED run rather than because a loss was measured there.
- **A failure inside the append path itself** still leaves a child log unclosed (measured, budget 1).
  This is R3-5's best-effort posture, now stated in the method contract instead of implied.
- **Not investigated:** whether `resumeFlowchartRun` should adopt already-recorded child results from
  the parent log instead of re-executing. That is the real fix for the at-least-once window, and it
  lives in `resumeRestoredRun`/`executeRemainingRunningNodes`, outside this slot's region. Round 5
  candidate.

---

## 4. Diff

`src/run/flowchart-run.ts`
- `RESUMABLE_CRASH_STATUSES` (`PAUSED`, `WAITING_FOR_USER`, `BLOCKED`) and
  `preserveResumableState(ctx)`: best-effort checkpoint flush, swallowing everything.
- `withRunTeardown`: flush after `recordCrashTerminal`, order documented.
- `injectFlowchartRun`: its ledger/blocked/finish tail wrapped so a crash flushes the applied
  injection; rethrows, no terminal.
- `recordCrashTerminal` itself is byte-for-byte unchanged.

`src/run/child-coordinator.ts` — comment only. States why the already-terminal check is not
defensive (the `childRunId` surface), names the pin, and states the unclosed-log limit.

`test/unit/run/flowchart-run-abort.test.ts` — 6 new tests (7 → 13):
1. a crash after a node lands keeps a paused run's resume point level with its log
2. a node still in flight when a paused run crashes is retried on the record, not silently
3. a crash while a run waits for the user records no terminal and stays answerable
4. a crash while injecting into a paused run keeps the injection it applied
5. a crash while a run is blocked records no terminal and keeps the block resumable
(plus the `armableGenerator` / `checkpointNodeStates` / `readCheckpoint` helpers and an `onResult`
hook on `RecordingExecutor`; every pre-existing test unchanged and green.)

`test/integration/m2.5/children-flowchart.test.ts` — 1 new test (3 → 4): a child crashing onto a log
another child already closed adds no second terminal.

Each new pin asserts the window it landed in (which events are on the log at crash time), so a
future change that shifts the event sequence fails loudly instead of silently pinning a different
window.

---

## 5. Verification

- `npx eslint` on the four owned files — clean, exit 0.
- `npx tsc --noEmit` whole tree — clean, exit 0.
- Owned tests 3× (`flowchart-run-abort` + `children-flowchart`): 17 pass / 0 fail / 0 skipped, all
  three runs.
- Adjacent run-plane suites (`test/unit/run`, `test/integration/m2.5`, `test/integration/m2`,
  `test/integration/m1`): 196 pass / 0 fail / 0 skipped.
- **Mutation control.** Removing `await preserveResumableState(ctx)` from both call sites fails
  exactly tests 8 and 11 and nothing else. Neutering the child-side already-terminal check
  (`if (false && …)`) fails exactly the new children-flowchart test. Every claim above is
  mutation-controlled.
- Full `pnpm test` on this VM: 1665 tests, 1661 pass, **3 fail, 1 skipped**. The single skip is the
  pre-existing `PI_SMOKE` gate — this slot introduced none. The 3 failures are unowned, in-progress
  work by other slots in the shared tree, attributed by file:
  - `test/unit/privacy/deletion.test.ts` × 2 (R4-1: its new run-lock remedy wording and its
    source-shape pin) — `privacy/deletion.ts` is R4-1's file and is modified in the tree.
  - `test/integration/pi-adapter/loopback-cli-resume.test.ts` × 1 (R4-10's new fixture file).
  Neither touches `flowchart-run.ts`, `child-coordinator.ts`, or any path this slot changed;
  `test/unit/run` and `test/integration/m2.5` are fully green.
- No bench: this slot makes no perf claim. The flush costs one extra log read plus one checkpoint
  write, on the crash path only.

## 6. Frozen contracts held

`recordCrashTerminal`'s in-flight-only, best-effort posture on both planes (unchanged — the flush is
a sibling, not a widening); `AttemptTranscript` + duplicate-terminal wording parity; exactly-one-
terminal per log on both planes (now pinned for the shared-log case too); `EventStore.readAll`'s
`DomainValidationError` posture; checkpoint atomicity via `writeFileAtomic`. No `package.json` edits,
no schema, no commits.
