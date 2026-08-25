[Model: opus-fast]

# Loop 4 · Round 11 — slot R11-4: discard audit-integrity hardening at restore

Branch `agent/opt-continuous`, working tree, base HEAD `be21a05`. **No `git checkout`, no commit, no push** — per mandate. No scratch files at report time.

## 1. What landed

**One src change, three lines of behaviour, in `src/run/flowchart-run.ts` (sole owner):**

- `applyClearingEvent` takes the run's log (`events: readonly Event[]`) as a new third parameter.
- Its `RUN_UNBLOCKED_WITH_DISCARD` arm calls `assertDiscardAuditMatchesLog(events, clearing.payload.rewoundDescendants)` **after** the existing consequence-set recompute and before returning the reopened snapshot.
- Its sole caller, `restoreCheckpointedSupervisor`, forwards the `input.events` it already held.

The rest of the diff is docstrings: `assertDiscardAuditMatchesLog` now describes two callers and which one can actually fail, `applyClearingEvent` now describes the two independent ways a recorded payload can be wrong and why the set is checked before the sums.

**Result.** A schema-valid hand-edited `RUN_UNBLOCKED_WITH_DISCARD` row that names exactly the consequence set the checkpoint justifies but overstates what the discarded work cost no longer replays cleanly. Before this change, resume applied it, reached COMPLETED with zero anomalies, and left the run carrying a durable authorization record that lied about money. Now the restore refuses with the producer's own message and writes nothing.

The three refusal arms the review called unreachable (`missing MODEL_ROUTED row` / `row routed a different task` / `sum mismatch`) plus the fourth (`uncited child run`) now each have a reachable public path and a test that exercises it.

## 2. Mandate compliance

| Instruction | Status |
|---|---|
| Validate at restore, not export-only | Done — no export added; the check runs inside `applyClearingEvent` |
| Do not change the in-payload charged-estimates decision | Payload schema, producer, and `chargedAttempts` byte-untouched |
| Do not refund budgets | No budget code touched; the no-refund assertions in `unblock-flow` still pass |
| Do not fold invocation telemetry into charges | `assertDiscardAuditMatchesLog` reads only `MODEL_ROUTED` / `CHILD_RUN_CREATED`, unchanged |
| Do not edit `src/run/replay.ts` (R11-1) | Zero edits — confirmed by `git diff` |
| Keep R9-3 ordinary-refusal pin byte-for-byte | Untouched; `unblock-flow` test 9 asserts it and passes |
| Keep R10-8 `applyRetry` absence | No `applyRetry` / `scheduler.js` reference added; `flowchart-applyretry-absence.test.ts` green (see §5) |
| Every flowchart-payload writer carries `contract` (R10-4) | No `materializeCheckpoint` call added or changed; the census pin in `resume.test.ts` still passes |
| Single-append discipline unchanged | No append added; the change is read-only over the log at restore |
| No new skip | Zero skips in every owned run |

## 3. Design decisions, and why

**Set before sums.** `applyClearingEvent` checks the consequence set first and the charged estimates second. A payload that is wrong both ways is reported as the wrong set. The reason is in-source: until the nodes are the ones this block's failure implies, a claim about their cost is not a claim about this run. This also keeps R10-1's exact pinned message (`… authorized rewinding X, but this checkpoint's consequence set is Y`) dominant for the case it was written against, so the existing behavioural pin is unaffected either way.

**Producer vs restore.** The producer's call is unchanged and still runs before the append, so a derivation bug still refuses without writing. The restore call is the one that can fail on real input, because it validates numbers the log carries rather than numbers it just derived. Both call the same function; no duplicated rule.

**Log growth is safe.** The check reads only the rows a payload cites, so a log longer than the one the authorization was written against cannot change the verdict — later `MODEL_ROUTED` rows are extra map entries nobody looks up. Verified by construction and by the re-block test, where the second discard's payload cites two `MODEL_ROUTED` rows for the same task and validates against a log that has grown twice. Stated in the docstring.

**Disclosed limit: the check is consistency, not completeness.** An authorization that cites a *subset* of a task's routes and totals that subset correctly is internally honest and passes. Under-claiming is a producer concern, and `chargedAttempts` — the only producer — takes every row. I did not widen the check to demand completeness because doing so would make restore refuse any payload written before a later row for the same task appeared, which is exactly the re-block shape above. The limit is recorded in the `assertDiscardAuditMatchesLog` docstring rather than left implicit.

**`applyClearingEvent` stays the sole application point.** Censused: `restoreFlowchartSupervisor` has exactly three `src` references — its definition, `applyClearingEvent`'s caller, and `validateCheckpoint`'s round-trip restorability probe in `replay.ts` (which applies no clearing event). So there is no second restore path that could skip the check.

## 4. Tests (additive only)

`test/integration/run/unblock-flow.test.ts` **13 → 18 (+5)**, all reached through a hand-appended row plus a real `resumeFlowchartRun`, the `unblock-flow` fail-closed pattern:

- **the control, first**: a hand-appended authorization the log fully supports resumes to COMPLETED, re-runs `ROOT_CAUSE` and `SUMMARY`, zero anomalies. This is what makes the four refusals falsifiable — they discriminate on the claim, not on the fact that a human wrote the row.
- inflated charge sum → `claims 9.99 USD / 1000 ms, but the MODEL_ROUTED rows it cites total 0.1 USD / 1000 ms`
- cited route not on the log → `cites MODEL_ROUTED evt_ghost, which is not on this run's log`
- cited route belongs to the scout → `cites MODEL_ROUTED …, which routed tsk_scout, not tsk_summarize`
- cited child run belongs to the scout → `cites child run …, which this log does not record for tsk_summarize`

Each refusal additionally asserts the fail-closed properties: the executor spent nothing, no event was written, and the checkpoint still describes the block.

`test/unit/run/replay.test.ts` **23 → 24 (+1)** — the boundary this change draws. Replay reconstructs control state from event identity and deliberately records **no** anomaly for a discard whose charges nothing supports (the file's existing `discardUnblocking` helper already cites an id no log there carries), because an anomaly is an observation a resume steps over and this class must stop the resume. Paired with a source-boundary pin, in the style of the file's existing `alreadyTerminal` pin, that `applyClearingEvent` calls `assertDiscardAuditMatchesLog`.

**Total +6 registrations, zero new skips.** Counts verified against `HEAD` (`git show HEAD:<file> | grep -cE '^test\('`): unblock-flow 13→18, replay 23→24.

### Non-vacuity, proven by mutation

Replacing the one new call with `void events;` in the working tree:

- all four new integration refusals fail with `Missing expected rejection` — i.e. before this change the inflated-charge authorization *resumed cleanly*, which is precisely the residual review §6.4(b) described;
- the new `replay.test.ts` source pin fails;
- the other 13 unblock-flow tests and 23 replay tests stay green, so the mutation is exactly the new behaviour and nothing else.

Source restored and re-verified byte-identical after the mutation runs.

## 5. Verification (this VM, Node v22.14.0)

- **Scoped `eslint`** on all three owned files: exit 0, clean.
- **Whole-tree `tsc --noEmit`**: **clean, zero errors, at 00:05:58 UTC.** Earlier in the slot it reported errors in four files — `test/unit/tracking/{gates,acceptance,option-a-preconditions}.test.ts` and `test/unit/protocol/v1.test.ts` — a mid-round transient from R11-1's in-flight option-(a) diff (`src/tracking/types.ts` 00:01:00, `src/tracking/gates.ts` 00:01:12 added a required `GateInput.criterionUnmet` ahead of its call sites). All four are R11-1's exclusively-owned files; none is mine; R11-1 converged by 00:05:58.
- **Owned tests 3×**: `unblock-flow` + `replay.test.ts` → 42/42 pass, 0 fail, 0 skipped, three consecutive runs.
- **Consumer census, all green**: `test/integration/cli/unblock.test.ts`, `test/unit/run/event-row-fuzz.test.ts`, `test/unit/run/gate-status-posture.test.ts`, `test/unit/supervisor/flowchart-supervisor.test.ts`, `test/unit/run/flowchart-applyretry-absence.test.ts`, `test/unit/run/episode-contract-boundary.test.ts`, and every other restore-path consumer (`m2.5/children-flowchart`, `m2.5/flowchart-run`, `m3/pause-inject`, `m2/supervised-lifecycle-lock`, `unit/run/{flowchart-run-abort,gate-outcome,run-lifecycle-lock,flowchart-learned-routing}`).
- **`live-isolation.test.ts` not run**: I added no import at all, live-closure or otherwise.
- **No full gate** — parent's job.

### One red test in the shared tree, not mine

`test/integration/m2.5/resume.test.ts` fails one test at report time: *"the flowchart checkpoint, its validator, its writer and both restorers carry the run contract"*, with `The input did not match the regular expression /Reserved: per-task acceptance criteria/` against the `FlowchartCheckpointState` interface **read out of `src/run/replay.ts`**.

Attribution, by timestamp: R11-1 spent R9-1's reserved seam in `src/run/replay.ts` (mtime 00:03:01 UTC, +111 lines, adding `taskCriteria` and rewriting the reservation docstring); the pin that reads it lives in `test/integration/m2.5/resume.test.ts`, which R11-3 owns (mtime 00:04:14 UTC, +161 lines, still moving). The same file was **green at 00:01** with my src change already in place. I touch neither file, and the failing assertion never reads `flowchart-run.ts`.

This is a real cross-slot coordination item, not a transient that will resolve itself: the ownership table assigns R11-1 the obligation to replace R9-1's reserved-unimplemented assertion in the same diff, but that assertion physically lives in R11-3's file. **Parent: one of the two needs to own the deletion.** R10-4's writer-carriage census in the same file passes, so only the reservation pin is affected.

## 6. Freeze re-check

`RUN_UNBLOCKED_WITH_DISCARD` schema untouched (`src/run/events.ts` diff-empty). `RUN_UNBLOCKED` three keys untouched. Uniform clearing semantics untouched — both events still funnel through one `applyClearingEvent`, and the ordinary arm is byte-identical. Single-append discipline untouched. Per-block permission untouched (re-block test green). No `materializeCheckpoint` call added or changed. No fs primitive, no lock, no append. Charged estimates still come only from `MODEL_ROUTED` rows; absence-is-not-zero intact. No budget refund. `TERMINAL_REPLAY_STATUSES` untouched. R9-3 refusal message untouched.

Perf: no hot-path change. The new work runs once per restore, only when a clearing event is unapplied — i.e. only in the discard crash window — and is O(log) over rows already being scanned, with no I/O. No bench claimed.

## 7. Residual for the parent

- The completeness gap in §3 (an authorization citing a correct subset of a task's routes passes) is now documented in-source rather than merely unstated. Closing it would need a producer-side rule about which rows belong to which attempt, which is a payload-semantics decision the R10-1 sign-off already settled the other way. Recorded, not reopened.
- The `resume.test.ts` reservation pin above.
