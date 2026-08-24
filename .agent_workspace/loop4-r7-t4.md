# R7-4 — The parent plane's unconditional crash `RUN_FAILED`

Slot: R7-4 · branch `agent/opt-continuous` (no checkout, no commit, no push) · owned files
`src/run/coordinator.ts` (sole) and one new additive test file, `test/unit/run/parent-terminal-refusal.test.ts`.
I did not touch `flowchart-run.ts` (R7-1), `gate-outcome.test.ts` (R6-1 / R7-1),
`replay.test.ts` (R7-3), or any other slot's file.

## 1. Census, before trusting the brief

Taken at HEAD `48a1a59` + the round's in-flight edits, before writing anything.

| Brief claim | What the source says | Verdict |
|---|---|---|
| `coordinator.ts:618-621` appends `RUN_FAILED` with no in-flight check and no replayed-terminal refusal | exactly that: `status = "FAILED"; failureReason = …; await append(make("RUN_FAILED", { reason: failureReason }))` | confirmed |
| `recordCrashTerminal` already refuses over BLOCKED | yes — `crash-terminal.ts:63` refuses anything but `PLANNING`/`RUNNING` | confirmed, but see §2 for why I did not call it |
| the flowchart plane's fix is the model | `alreadyTerminal` (`flowchart-run.ts:577`) → `replayedTerminalStatus`, consulted by all three recorders | confirmed |
| the parent loop "already breaks out of its terminal-append branch on `queue_analysis`" (R6-1's census, re-quoted by the reviewer) | confirmed at `:616-620` — and that turns out to matter a great deal for reachability (§4) |

Two things the brief did not say, both found in the census and both load-bearing:

1. **The catch-all was not the only unguarded appender on this plane.** The loop's own two
   exits — `RUN_FAILED` for child failures/unstarted children (`:641`) and `RUN_COMPLETED`
   (`:644`) — appended a terminal without looking at the log either. They are reachable
   with a blocked log by exactly the same mechanism as the catch, so fixing only the catch
   would have left an identical hole one screen above the fix. I widened to all three and
   disclose it as beyond-brief in §7.
2. **`startParentRun` has no production caller.** `rg startParentRun src/` finds only two
   doc comments (`event-store.ts:86`, `track/loop.ts:205`). The CLI's `run --children`
   drives the *flowchart* plane. So this plane is an exported M1 embedder entry point whose
   live consumers are seven test files; that is the honest scope of "the parent plane"
   here, and it is why no CLI wording moves.

## 2. The change

One recorder for the whole plane, in `runParentRun`:

```ts
const recordTerminal = async (
  type: "RUN_COMPLETED" | "RUN_FAILED",
  payload: unknown,
  intended: RunStatus
): Promise<RunStatus> => {
  const recorded = await loggedTerminalStatus(eventStore);
  if (recorded !== undefined) return recorded;
  await append(make(type, payload));
  return intended;
};
```

fed by a module-private reader that goes through replay's one definition:

```ts
async function loggedTerminalStatus(eventStore: EventStore): Promise<RunStatus | undefined> {
  try {
    return replayedTerminalStatus((await eventStore.readAll()).events);
  } catch {
    return undefined;
  }
}
```

All three terminal appends now go through it. `RUN_CANCEL_REQUESTED` deliberately does not
(§7, residual 3).

**`replayedTerminalStatus`, not `recordCrashTerminal` — and the reason is a frozen contract,
not taste.** The brief offered either. `crash-terminal.ts`'s module docstring states three
rules, the third of which is "**The caller always rethrows.** Recording a terminal is
bookkeeping; it never converts a crash into a settled run for the caller." `startParentRun`'s
catch does precisely the opposite on purpose: it swallows the error and returns a settled
`RunOutcome`. Adding a non-rethrowing caller would have falsified that docstring, and
`crash-terminal.ts` is not mine to amend this round. Two further consequences pointed the
same way: `recordCrashTerminal` is best-effort (a swallowed append plus a swallowed rethrow
would make a crash vanish entirely on this plane), and its `run crashed: ` prefix would have
changed the recorded reason string the brief told me to keep.

**Reason string kept, byte-identical.** The recorded reason is still the raw
`error.message`, unprefixed and unbounded — pinned positively (`/taskId must be a valid
TaskId/`) and negatively (`assert.doesNotMatch(reason, /^run crashed: /)`).

**Settle ordering kept.** `settleBoundEpisode` still runs after the try/catch/finally, with
`status`, before the final read and checkpoint. What changed is only *which* status it gets:
on a refusal it is the one the log replays, so the settle, the checkpoint and the returned
`RunOutcome.status` agree with the log instead of with the branch that lost. Concretely,
a blocked run now settles `EPISODE_WAITING` ("run blocked") instead of `EPISODE_CLOSED`
(FAILED).

## 3. Coherence with the frozen contracts

- **One definition of run-terminal.** The refusal calls `replayedTerminalStatus`; nothing in
  `coordinator.ts` re-derives "terminal". Pinned by a source assertion in the new file
  (`assert.match(source, /replayedTerminalStatus/)` plus `assert.doesNotMatch` on a private
  `"RUN_COMPLETED", "RUN_FAILED"` set). `TERMINAL_REPLAY_STATUSES` itself stays pinned where
  R6-1 put it — I added no second copy of that assertion.
- **BLOCKED is absorbing.** This slot strictly narrows what may land on a BLOCKED log; it
  adds no unblock and touches nothing R7-3 is designing.
- **`applyRetry`, `gate-apply.ts`, `preserveResumableState`, `withRunLifecycleLock`,
  `EventStore.append`/`CheckpointStore.write` staying lock-free**: all untouched. No new
  lock acquisition, no new persisted schema, no new event type, no export added or removed.
- **`crash-terminal.ts` untouched**; its two run-plane entry points and both guards are
  unchanged.

## 4. Reachability, measured — including what this does *not* fix

**The loop alone cannot produce the pair today.** `queue_analysis` is the parent plane's only
`RUN_BLOCKED` producer, `applyTrackingGate` pushes `RUN_BLOCKED` *last* in its batch (there is
no `LEDGER_UPDATED` on this plane), and the loop `break`s in the statement immediately after
the append loop. There is therefore no `await` inside the `try` between `RUN_BLOCKED` landing
and the loop's exit. I probed the alternatives — arming a failing id generator, poisoning
`now`, two children racing, `startReady()` throwing after a block — and none of them reaches
either the catch or the loop's exits with the run's own block on the log. **So this is a
guard, in the same class as `recordChildCrashTerminal`'s ("The check is not defensive. Within
one child run it can never fire … but a published `childRunId` lets two child runs share one
event log"), not a fix for a defect reachable from `runParentRun` in isolation.** I am not
claiming otherwise.

**What makes it a real guard rather than a decoration.** The parent's event log has more than
one writer. `ChildCoordinator` appends to this exact file through its own `EventStore`
instance (`child-coordinator.ts:238/338` — `CHILD_RUN_CREATED`, `CHILD_MESSAGE`,
`TASK_TIMEOUT`, `TASK_RETRY`, `USER_ANSWER`, `RUN_WAITING_FOR_USER`), and `EventStore.append`
deliberately takes no run lock (its own decision pin). None of those is a terminal *today*,
which is the honest limit of the argument; what the census does establish is that "only this
loop writes this log" is false, and R7-3 is designing a producer that will clear a block.
The recorder is keyed on what the log says, not on who wrote it.

**Reproduced, both arms, same VM.** Two children: the first returns a `PASSED` `TASK_RESULT`
(gate directive `none`), the second is a spec whose task id fails event validation, so its
first append rejects, its `done` rejects, the parent's race rejects with it and the parent
lands in the catch-all. A second `EventStore` puts the gate's own `RUN_BLOCKED`
(`ANALYSIS_QUEUED`, evidence named) on the log while the first child executes.

| Arm | tail of the log | status / checkpoint | `anomalies` |
|---|---|---|---|
| `HEAD:src/run/coordinator.ts` (baseline, extracted with `git show` and run unmodified) | `… → RUN_BLOCKED → CHILD_MESSAGE → TRACKING_ASSESSMENT → RUN_FAILED → EPISODE_CLOSED` | FAILED / FAILED | `['multiple terminal events']` |
| after this change | `… → RUN_BLOCKED → CHILD_MESSAGE → TRACKING_ASSESSMENT → EPISODE_WAITING` | BLOCKED / BLOCKED | `[]` |

The baseline arm is the exact double-terminal R6-1 removed from the flowchart plane, with
the episode closed as a failure on top of it. Negative control, same harness with the second
writer removed: `… → TRACKING_ASSESSMENT → RUN_FAILED → EPISODE_CLOSED`, FAILED,
`reason: "Invalid Event: taskId must be a valid TaskId"`, `anomalies: []`.

## 5. Tests

New file, `test/unit/run/parent-terminal-refusal.test.ts` (7 tests, additive — I claim this
file; I took nothing from `gate-outcome.test.ts`, `flowchart-run-abort.test.ts` or
`replay.test.ts`).

| # | Test | What it holds |
|---|---|---|
| 1 | a crash after the run is blocked reports the block instead of burying it | the slot's pin: BLOCKED status + checkpoint, `terminals === ["RUN_BLOCKED"]`, no `RUN_FAILED`, `anomalies: []`, `EPISODE_WAITING` present and `EPISODE_CLOSED` absent |
| 2 | an ordinary crash still records `RUN_FAILED` naming the escaping error | the brief's negative control: FAILED, one terminal, reason is the raw message, `EPISODE_CLOSED`, and *not* `run crashed: `-prefixed |
| 3 | a run that finished its children does not append `RUN_COMPLETED` over a blocked log | the widening (§7 disclosure 1), completion exit |
| 4 | a run whose child failed does not append `RUN_FAILED` over a blocked log | the widening, failure exit |
| 5 | an unblocked run still records the terminal its loop decided on | negative control for 3 and 4: `RUN_COMPLETED` and the child-summary `RUN_FAILED` are unchanged when the log is clean |
| 6 | a verification-failed child ends the parent run BLOCKED with the analysis queued | the production-ordinary shape the refusals protect, reached through the gate rather than a second writer — the parent-plane analogue of `gate-outcome.test.ts`'s first pin |
| 7 | the parent plane reads the shared definition of a replayed terminal | source pin: `replayedTerminalStatus` is consulted, no private terminal set beside it |

**Mutation check.** Neutering the guard (`if (recorded !== undefined && false)`) turns tests
1, 3 and 4 red and leaves 2, 5, 6, 7 green — the refusals are non-vacuous and the controls
really are controls. Reverted immediately.

One trap worth recording for the next slot that writes a multi-run test on this plane: two
runs sharing a state root *and* a deterministic id sequence mint the same run id and so share
one event log. The first draft of test 5 did that and its second run reported `COMPLETED`
because my own refusal correctly read the first run's terminal. The file now takes a fresh id
stream per run, with the reason on the helper.

## 6. Verification

- `npx tsc --noEmit` (whole tree): exit 0.
- `npx eslint src/run/coordinator.ts test/unit/run/parent-terminal-refusal.test.ts`: exit 0.
- Owned test file **3×**: 7/7 each, ~270 ms.
- **Consumer census, all run green.** Production consumers of `coordinator.ts`:
  `flowchart-run.ts` (imports `summarizeClusterMail`, `withRunLifecycleLock` — neither
  touched). Test consumers of `startParentRun`: `m1/parent-run.test.ts`,
  `m3/coverage-gate.test.ts`, `cluster/undelivered-mail.test.ts`, `cluster/peer-mailbox.test.ts`,
  `cluster/dynamic-spawn.test.ts`, `unit/run/run-lifecycle-lock.test.ts`,
  `pi-adapter/loopback-cli-resume.test.ts`. Ran those plus `test/unit/run/**`,
  `m0/coordinator.test.ts`, `m1/**`, `m2/**`, `m2.5/**`, `m3/**`, `cluster/**`,
  `acceptance/**`, `unit/privacy/deletion.test.ts`, `cli/delete.test.ts`, `cli/cli.test.ts`,
  `pi-adapter/faux-smoke`, `pi-adapter/invocation-recording`: **0 failures, 0 new skips**.
- `test/unit/routing/live-isolation.test.ts`: green (I added a named import from an
  already-imported module inside the live closure, per the round's process rule).
- `node scripts/crash-probe.mjs`: `ok: true`, 9 cases × 3 iterations — unchanged. I changed
  no probe case, so the reduced-probe pin in `crash-recovery.test.ts` needs no edit.
- No full gate (parent's job). No scratch files in the tree at report time; the baseline
  extraction and probes lived in `/tmp/r74` and are deleted.
- **No perf claim.** Cost stated instead: the guard adds one `readAll()` per run terminal —
  once per *run*, on a path that already reads the log twice more within a few statements
  (`beforeSettle`, then the final read). No per-step writer changed and no lock was added, so
  the standing `append`/`checkpoint write` decision pins are untouched.

## 7. Disclosures

1. **Beyond the brief: I guarded all three terminal appends, not only the catch-all.** The
   brief named `:618-621`; the loop's own two exits (`:641`, `:644`) had the identical hole,
   reachable by the identical mechanism, and leaving them would have made the pin I was asked
   to write sit next to an unguarded twin. Behaviour is byte-identical whenever the log
   carries no terminal, which is every run in the suite. Tests 3–5 cover it. Precedent:
   R6-1's disclosed widening of `persistBlocked`/`persistCompleted`.
2. **A refused crash loses the crash's reason.** On the refusal path nothing records why the
   loop died — there is nowhere to put it without a second terminal or a new event type, and
   the standing posture forbids both (R4-4 already decided against a non-terminal
   `RUN_CRASHED` marker). The caller still gets `RunOutcome`; a rethrow was not an option
   because this plane's catch deliberately settles rather than rethrows. Stated on the
   recorder in source.
3. **Residual: the refusal is terminal-keyed, not in-flight-keyed.** `recordCrashTerminal`
   refuses over `PAUSED`/`WAITING_FOR_USER`/`CANCELLED` too; `replayedTerminalStatus` does
   not. So a crash over a parent log that replays `WAITING_FOR_USER` — reachable in principle,
   since `ChildCoordinator` appends `RUN_WAITING_FOR_USER` to the parent log from its own
   store while the parent loop is still turning — would still record `RUN_FAILED` and bury
   the wait. I did not widen: doing it inline would mean re-deriving `recordCrashTerminal`'s
   in-flight rule locally, which is the drift this round forbids, and doing it through the
   helper would falsify its rethrow clause (§2). This wants either a rethrow-free variant in
   `crash-terminal.ts` (that file's owner, with sign-off) or a decision that the parent
   plane's `waiting` flag is sufficient. Flagged, not fixed.
4. **Residual: `RUN_CANCEL_REQUESTED` is still unguarded** (`writeCancel`, also fired
   out-of-band from the abort listener). `replayRun` does flag `RUN_CANCEL_REQUESTED after a
   terminal event` as an anomaly, so the same shape is reachable there. I left it alone
   deliberately: a cancel request is an operator fact rather than a status claim, the
   flowchart plane does not guard it either, and R4-3's reasoning about not re-classifying
   crashes as cancellations argues for treating it as its own decision.
5. **The pin's second writer is a stand-in, and says so in its docstring.** Within one
   `runParentRun` the loop cannot reach its own recorders with its own block on the log
   (§4). The test therefore writes the gate's `RUN_BLOCKED` through a second production
   `EventStore` — the same mechanism `ChildCoordinator` already uses on this file. If a
   reviewer wants the guard justified by a reachable in-loop path instead, there is none
   today and the disclosure is the answer, not a reachability claim.
6. **`startRun` (the M0 plane, `:301-312`) was left alone.** Its catch converts the executor
   loop's error into `outcome = "FAILURE"` and the terminal is appended outside it; the M0
   log has no gate and therefore no `RUN_BLOCKED` producer, so the double-terminal shape does
   not exist there. Its three reason pins in `m0/coordinator.test.ts` are untouched and green.

## 8. Handoff

- The parent plane now has one terminal recorder with one definition of "terminal", matching
  the flowchart plane's three. Anyone adding a fourth terminal append to `runParentRun` must
  route it through `recordTerminal`; test 7 will not catch that, only review will.
- R7-3: when the unblock producer lands, this recorder is one of the writers that must learn
  the new shape — `loggedTerminalStatus` is the single place on this plane where "the log
  already ended" is decided.
- Residuals 3 and 4 are the natural next slot on this plane, and they are decisions before
  they are diffs. Neither is worth a slot on its own; both would fit inside whichever slot
  next opens `crash-terminal.ts`.
