claude-opus-5-thinking-high-fast

# Loop 4 · Round 4 · R4-3 — Supervised-plane crash terminal + `applyRetry` divergence

Slot: P2, honesty. Files owned and touched: `src/run/supervisor.ts`, `src/run/scheduler.ts`,
`test/unit/run/scheduler.test.ts`, `test/integration/m2/supervisor.test.ts`,
`test/integration/m2/resume.test.ts`, and one new file `test/integration/m2/supervisor-crash.test.ts`.
No other file was edited. Not committed, still on `agent/opt-continuous` (per instruction).

## 1. Census first — the brief's two claims, re-verified at HEAD

**(a) `runSupervisorRounds` has no try/catch — CONFIRMED.** No `try` appeared anywhere in the function
(`supervisor.ts:222-472` before this slot). Both embedders (`startSupervisedRun:593`,
`resumeSupervisedRun:703`) call it un-guarded and then run the settle/checkpoint tail, so an escaping error
skipped the tail entirely and the log ended at whatever event landed last. `replayRun` then reports
`RUNNING` (`replay.ts:182`: `sawStarted` with no terminal) — forever.

What can actually escape, checked rather than assumed: **not** an executor throw. `runAttempt` wraps its
`for await` in a catch (`child-coordinator.ts:690`) and converts a throwing executor into
`executorOutcome: "FAILURE"`, and R3-5 already closed the child plane. What escapes to the parent is
`judge.decide` (called directly in the task promise, `supervisor.ts:393`), a rejected `append` on either
plane, `registry.resolve` for an unmapped role, and any append the child coordinator makes outside its
attempt try (`RUN_CREATED`/`CHILD_RUN_CREATED`/`AGENT_FINISHED`), which `startChildTask` rethrows after
recording the *child's* terminal (`child-coordinator.ts:313-315`). So the brief's "executor throw" is the one
symptom that does **not** reproduce; the defect class is real via the other three. Tests use a throwing judge
because it is the cheapest honest trigger.

**(b) `applyRetry` has no production caller — CONFIRMED (R3-8's finding, re-verified).** In `src/`,
`applyRetry` appeared only at its own definition and in one doc comment. Production performed BLOCKED→READY
with a literal at exactly two sites (`supervisor.ts:266` lease recovery, `:423` rejected verdict). Repo-wide
census of `"READY"` in `src/`: those two writes, one `status === "READY"` read in the supervisor's
`canProgress` check, `planRound`'s schedulability check, `applyRetry`'s own return, `TASK_TRANSITIONS`, the
`TaskStatus` union, and the flowchart plane's unrelated `FlowNodeState`/`JoinStatus` `"READY"`. So: two
inline sites, no third, and no other DAG-plane producer of READY.

## 2. Changes

**(a) Crash terminal on the supervised plane, R3-5's pattern.** `runSupervisorRounds` is now a thin wrapper:
it calls the (renamed, module-private) `executeSupervisorRounds`, and on an escaping error calls
`recordCrashTerminal` and **rethrows unconditionally**. `recordCrashTerminal` mirrors
`flowchart-run.ts`'s contract exactly — read the log, `replayRun` it, append `RUN_FAILED` **only** when the
status is `PLANNING`/`RUNNING`, and swallow every failure of its own so it cannot mask the escaping error.
The reason string uses the same bounded `run crashed: <message>` shape (500-char cap, `unknown error` for an
empty message), so an operator sees identical wording whichever plane died. The helper is duplicated rather
than shared: the flowchart copy is module-private in a file whose regions belong to R4-2 and R4-4 this round.
Extracting it into a shared module is a Round 5 candidate, not a cross-slot edit.

**Round settlement, the DAG-plane analog of `cancelAndSettle`.** `await Promise.all(taskPromises)` became
`Promise.allSettled` plus a rethrow of the first rejection in round order. Without it the crash terminal is
not actually terminal: the throwing task's round-mates keep running unawaited and append `JUDGE_DECISION`
and `TASK_STATUS_CHANGED` events *after* `RUN_FAILED`, and `startSupervisedRun`'s promise rejects while
children it launched are still spending. This is the same defect R3-5 named on the flowchart plane and fixed
with `cancelAndSettle`. Pinned in §3 and mutation-checked.

I deliberately did **not** abort the run's `AbortController` to shorten that wait, though the flowchart
plane's teardown does cancel. On this plane each task promise checks `controller.signal.aborted` after its
child settles and calls `recordCancel()`, which appends `RUN_CANCEL_REQUESTED`; replay would then read
`CANCELLED`, `recordCrashTerminal`'s in-flight check would decline, and a crash would be recorded as a
cancellation nobody requested. Honesty beats a faster unwind. The wait is bounded by the child limits that
already bound the round (`timeoutMs` per attempt, `maxWallTimeMs` per child) — see §5 for the residual.

**(b) Both retry sites wired through `applyRetry`.** Decision: wire, not delete — the transition genuinely
happens in production, the rule is exported and used by two test simulations, and wiring is behavior-neutral
while deletion would leave the literal unvalidated. A local `recordRetry(node, attempt)` helper calls
`applyRetry({ ...node, status: statuses.get(node.id) ?? "PENDING", attempt })` and records the result. The
status passed is **the one the log just recorded**, not the graph node's stale `PENDING` — that is what makes
the rule's guard real rather than vacuous: a retry can now only follow a recorded `BLOCKED`, and editing
`applyRetry` changes what the supervisor does. `scheduler.ts`'s doc comment names the live caller.

Behavior is unchanged by (b): under a mutation that reverts `recordRetry` to the old literal, every
behavioral test in the tree still passes and only the source pin goes red (§3) — which is the evidence that
the wiring is neutral and that the pin, not luck, is what holds it.

## 3. New tests and pins (all mutation-checked)

New file `test/integration/m2/supervisor-crash.test.ts`, 5 tests:

1. *an error escaping the supervised round loop records RUN_FAILED and rethrows* — a throwing judge; the run
   still rejects with the original error, the log's last event is `RUN_FAILED` with reason exactly
   `run crashed: judge exploded`, replay is `FAILED`, `anomalies` is empty, exactly one terminal event.
2. *a crashed supervised run resumes as terminal and appends nothing* — the brief's "pin replay/resume for a
   crashed supervised run": resume returns `FAILED`, appends zero events, checkpoint says `FAILED`.
3. *a crash waits for its round-mates, so nothing is appended after the terminal* — two tasks in one round,
   one judge throw and one slow child; the slow task's `COMPLETED` is already in the log when the run rejects
   and `RUN_FAILED` is last.
4/5. *a crash after RUN_BLOCKED / RUN_CANCEL_REQUESTED keeps that state* — the in-flight-only limit, driven
   through the exported `runSupervisorRounds` with a hand-built context whose log is seeded settled (a state
   `startSupervisedRun` cannot reach from outside). No `RUN_FAILED` is appended, the recorded status survives,
   and the error is still rethrown.

Behavioral pins for the two retry sites (rather than source-only): *a rejected verdict retries the task
through BLOCKED -> READY until attempts run out* in `m2/supervisor.test.ts` pins the exact recorded sequence
`READY, RUNNING, BLOCKED, READY, RUNNING, BLOCKED, READY, RUNNING, BLOCKED, FAILED`; the resume test now pins
that lease recovery records `READY, RUNNING, BLOCKED, READY` for the orphaned task.

Source pin in `test/unit/run/scheduler.test.ts` — *the supervisor retries through applyRetry, not a status
literal*: the comment-stripped supervisor source must contain `applyRetry(`, must not contain
`recordStatus(… "READY"`, and must not contain `applyRetry(… status: "BLOCKED"` (a literal there would keep
the call but make the guard vacuous). Plus the guard itself swept over all seven non-BLOCKED statuses.

| Mutation | Result |
|---|---|
| `try`/`catch` removed from `runSupervisorRounds` | RED (tests 1, 2, 3) |
| in-flight-only check removed from `recordCrashTerminal` | RED (tests 4, 5) |
| `Promise.allSettled` + rethrow reverted to `Promise.all` | RED (test 3 only) |
| `recordRetry` reverted to the `"READY"` literal | RED (source pin only; all behavioral tests stay green) |
| R2-9: `leases.restore(` renamed in the supervisor | RED |
| R2-9: recovery loop shape changed | RED |
| R3-8: a `"SKIPPED"` literal added to the supervisor | RED |
| R3-8: a 5th parameter added to `planRound` | RED |

The last four matter because I edited inside the region R2-9's and R3-8's source pins match (the recovery
loop's retry line is now `recordRetry`, three lines below `leases.restore`). Both pin sets still bite, and
both are green unmutated.

## 4. Frozen contracts respected

`recordCrashTerminal`'s in-flight-only + best-effort contract is *reproduced*, not widened: this slot adds a
third plane with the same two limits and does not touch the flowchart or child copies (R4-4 owns any
deliberate widening). R2-9's `restore()` liveness and expiry-absence pins, R3-8's `planRound` 4-arg arity pin
and no-skip-transition pin: all green and re-mutation-checked. `planRound`, `applyTaskOutcome`, `applyRetry`
bodies and signatures unchanged; `LeaseRegistry` untouched. No live R1/bandit/topology wiring, no
Outcome-supported claim, no `package.json` edit, no schema/event-type change, no unowned file edited, no
commit.

## 5. Disclosed residuals (not fixed here)

- **A crashed supervised run leaves its episode open and writes no checkpoint.** The settle tail
  (`settleBoundEpisode`, `settleSupervisedOutcome`, `checkpointStore.write`) lives in the two embedders after
  the `runSupervisorRounds` call, so a rethrow skips it. The run log is now honest, but `episodes/` still
  shows the run attached and the checkpoint keeps its last pre-crash status. The flowchart plane has the same
  shape (its `finish` does the settle; `withRunTeardown` records only the terminal), so this slot matched the
  accepted precedent rather than inventing a wider teardown on one plane. Worth a Round 5 slot across both
  planes.
- **The crash unwind waits for the round to finish.** With settlement (§2a) a judge throw on task A does not
  surface until task B's child settles — bounded by `timeoutMs`/`maxAttempts`/`maxWallTimeMs`, unbounded by
  anything this slot added, but the wait is real. The alternative (abort the controller) records the crash as
  a cancellation; a cancel path that does not write `RUN_CANCEL_REQUESTED` would need its own flag through
  `recordCancel`, which is more surface than a P2 honesty slot should take on.
- **`crashReason`/`recordCrashTerminal` now exist in three files** (`flowchart-run.ts`, `child-coordinator.ts`
  with a `child run crashed:` prefix, and now `supervisor.ts`). Three copies is the point at which a shared
  helper is worth it; both other files are region-owned by peer slots this round, so extracting one is a
  Round 5 candidate.
- **`TASK_LEASE_EXPIRED` name-vs-trigger mismatch** (R3-8's disclosure) is untouched — still a schema change.

## 6. Verification (this VM, Node v22.14.0, pnpm 10.17.1)

- Owned tests, 3 consecutive runs: `test/unit/run/scheduler.test.ts` + `test/integration/m2/` (4 files) →
  **30/30 pass, 0 fail, 0 skipped** each run. Baseline before the slot was 23/23; +7 tests (5 new crash tests,
  1 new retry-sequence test, 1 new source pin), 0 removed, **no new skip**.
- Adjacent suites that could feel a supervisor/scheduler change: `test/unit/run/`, `test/unit/supervisor/`,
  `test/unit/graph/`, `test/integration/m2.5/` → **239/239 pass**.
- Scoped `eslint` on all owned files: clean. Whole-tree `tsc --noEmit`: **clean, 0 errors**, on the final
  state.
- Whole-tree `pnpm test` (informational, parent owns the gate): 1665 tests, 1661 pass, **3 fail, 1 skip**. The
  skip is the standing `PI_SMOKE` gate. All three failures are peer slots' in-flight work in files I do not
  own and did not touch — `test/integration/pi-adapter/loopback-cli-resume.test.ts` (R4-10: *offline custom
  provider persists run and resume invocations for calibration*) and `test/unit/privacy/deletion.test.ts`
  (R4-1: *a run directory recreated by a live writer fails the delete loudly*, *the run delete cannot report a
  subtree removal it did not verify*). Attributed to files, left alone per the shared-tree rule.
- Not run: full `pnpm gate` (parent's job), bench (this slot makes no perf claim; the settlement change alters
  only the crash path's latency, not the success path's work).
