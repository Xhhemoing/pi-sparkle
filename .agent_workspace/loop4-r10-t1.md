[Model: opus-fast]

# Loop 4 · Round 10 — R10-1 `RUN_UNBLOCKED_WITH_DISCARD` schema and command

## Outcome

Shipped, as R9-3 designed it. `pi-sparkle unblock --run <id> --reason <text>
--retry-node <nodeId> --discard-executed` now records one
`RUN_UNBLOCKED_WITH_DISCARD` — a distinct exact-keyed event, not a fourth key on
`RUN_UNBLOCKED`, not a two-event sequence, not a second command. The ordinary
path is byte-unchanged and its fail-closed refusal is still the R9-3 pin.

Whole tree: `tsc --noEmit` pass, scoped eslint pass on all twelve owned files,
`node scripts/run-tests.mjs` 1914 pass / 0 fail / 1 skipped (the pre-existing
`PI_SMOKE` live-provider skip; no new skip). Owned files 3×: 89/89 each time.

## 1. Census against the working tree

`git status` at start already carried sibling edits to `docs/**`,
`test/unit/run/gate-status-posture.test.ts` and
`test/unit/run/flowchart-applyretry-absence.test.ts`. The latter two are on the
do-not-edit list and I did not touch them; both already contain sibling-written
additions naming the new event, and both are green against this
implementation (14/14 across them plus the doctor freeze).

## 2. What landed

### `src/run/events.ts`

`RUN_UNBLOCKED_WITH_DISCARD` joins `EVENT_TYPES` and the `Event` union with an
exact-key validator. `RewoundDescendant` carries `nodeId`, `taskId`,
`previousState`, `modelRouteEventIds`, `childRunIds`,
`chargedEstimatedCostUsd`, `chargedEstimatedDurationMs` — no evidence ids, no
artifacts, no prompts or responses, no `actualCostUsd`.

Refusals, all exact: unknown keys on the payload or on any entry; a
`blockedEventId` that is not an `EventId`; a blank `reason` or `retryNodeId`; an
empty `rewoundDescendants`; a bad `taskId`, `previousState`, route-id array or
child-run array; a negative or non-finite charge; a `READY`/`SKIPPED` entry
carrying references or non-zero charges; an entry repeating the retry target;
entries not strictly ascending by `nodeId` (which settles uniqueness in the same
comparison); and a set with no executed prior state.

`RunUnblockedPayload` is untouched — still `{ blockedEventId, reason,
retryNodeId? }`, still rejecting unknown keys including `rewoundDescendants`.

### `src/supervisor/flowchart-supervisor.ts`

`reopenAfterUnblockWithDiscard` is a second, plan-returning transform beside the
narrow one, which keeps its guard verbatim. It clears the ledger latch,
insists the retry target is FAILED, walks the same join-required
`downstreamConsequences`, skips consequences already PENDING (claiming them
would overstate what the authorization did), rewinds the rest, refuses when none
of them executed, then reopens the target and runs the ordinary propagation
fixpoint and waiter invariant. `rewindToPending` drops `success`/`confidence`
and the active route, keeps `evidenceCount`, `model` and `parallelGroup`, and
releases a pending approval that pointed at the rewound node. Neither remaining
budget is touched.

### `src/run/flowchart-run.ts`

`FlowchartUnblockRequest` gains `discardExecuted?: boolean`. Under the existing
`withRunLifecycleLock`, the flag is refused when the block names no failed node
(the stall shape), and `resolveRetryTarget` still requires the exact
`--retry-node` for a gate block. `chargedAttempts` reads route and child-run
references off the log; `assertDiscardAuditMatchesLog` re-derives each entry's
sums from the cited `MODEL_ROUTED` rows and refuses on a missing row, a row that
routed a different task, a sum mismatch, or a child run the log does not record
for that task. All of that happens before the append, so a refusal writes
nothing.

Order is unchanged: transform → one append → checkpoint. `unappliedUnblock`
returns a `ClearingEvent` union, and `applyClearingEvent` dispatches both kinds
through one recovery path; for the stronger one it recomputes the consequence
set from the durable definition and blocked checkpoint and fails closed when it
differs from `rewoundDescendants`, so a hand-edited list cannot authorize state
the transform never selected. Idempotence still keys on
`checkpoint.lastEventId`.

The fourth flowchart checkpoint writer now carries `contract` forward
explicitly. There is no counted writer census in a file I own, so nothing to
renumber; `test/integration/m2.5/resume.test.ts` was not edited and is green
(16/16).

### `src/run/replay.ts` and `src/run/gate-apply.ts`

Both clearing events get identical matched / stale / unmatched / post-terminal
handling, with anomaly text naming whichever event it was.
`TERMINAL_REPLAY_STATUSES` is unchanged. The `gate-apply.ts` change is two
lines — one condition and one comment — so `currentGateStatus` recognizes the
matched specialized event. `runStatus` gained no consumer.

### `src/cli/main.ts`

Boolean `--discard-executed`, refused at parse time without `--retry-node`. On
success the output names each discarded node, its prior state, its charged
estimate and route count, and says it is not refunded. An operator who hits the
ordinary refusal now gets a `next:` line naming the flag — the refusal text
itself is the state machine's and is unchanged.

`DOCTOR_ROUTED_NEXT` is untouched and its freeze is green.

## 3. The blocked-run guidance

`formatBlockedRunReport` gains one appended `note:`. The four ordinary lines are
byte-identical, in the same order, and are now pinned as a *prefix* of the block
in addition to the whole-list assertion, so a future edit cannot reword, reorder
or absorb one of them into the disclosure. The new line is a `note:`, not a
fifth `next:`, because it is the stronger form of the third remedy rather than
another one to try. It is unconditional and says so honestly: the report is
built from the event log alone and cannot see the checkpoint that would say
whether a descendant executed, so it states the precondition instead of
implying the flag applies.

## 4. Test plan §7, executed

1. **Supervisor unit** — the R9-3 refusal pin kept as-is, plus a positive
   discard test: two COMPLETED descendants rewound, outcomes cleared, evidence
   retained, no refund, source snapshot unmutated; plus refusals for nothing
   executed and a non-FAILED target. 26/26.
2. **`event-row-fuzz`** — seeded row for the new event, type-level exactness
   checks on both the payload and the entry shape, every nested refusal above,
   and a closing assertion that `RUN_UNBLOCKED` still rejects
   `rewoundDescendants`. 7/7.
3. **`replay`** — matched, stale, doubled, post-terminal, status re-derivation,
   an interleaved re-block cycle across both event kinds, and the unchanged
   terminal set. 23/23.
4. **`unblock-flow`** — the scenario needed a block an operator can actually
   reach with executed work behind it, so rather than mutating a snapshot the
   test builds one: a scout completes; root-cause analysis and a summary that
   joins on `any` both become ready and lease in the same round; the summary
   passes and the analysis fails verification, so the gate blocks with a FAILED
   node whose descendant is COMPLETED. Against that: the no-flag refusal appends
   nothing; the flag writes exactly one specialized event and zero ordinary
   ones; the charged estimate equals the routed row's own number; unblock spends
   nothing; evidence and `CHILD_MESSAGE` rows survive while `success`/
   `confidence` clear; neither budget moves; the contract survives the fourth
   writer and the resumed leg; resume re-runs the target and the discarded
   descendant and reaches COMPLETED. Plus: both refusal shapes, event-first
   crash recovery applying once, a hand-edited node list failing closed on
   restore, and the re-block pin below. 13/13.
5. **`cli/unblock`** — parse-time and validation refusals, actor and reason,
   the ordinary refusal's routing line, and the discard output lines read off
   the log rather than hardcoded. Its precondition is not reachable from an
   offline CLI invocation, so the run is seeded through the API using
   `createCalibratedCliModelRouter` — the router the CLI itself builds — and
   every assertion is then made against the shipped command. 9/9.
6. **`cli/blocked-next`** — §3 above. 11/11.
7. **Gate re-block pin** — after a discard unblock, a second failure records
   `from: "RUNNING"`, so the gate ledger and replay agree the run was unblocked.
   The second block carries the same executed descendant and is refused without
   the flag, which pins that the authorization is per-block permission rather
   than a mode the run stays in.

## 5. Held green

R9-3 ordinary refusal (byte-for-byte, now also reached through the CLI); R9-7
`DOCTOR_ROUTED_NEXT` freeze; R8-3 `applyRetry` / `scheduler.js` absence pin;
the four BLOCKED guidance lines; the loopback supervised-resume stderr pin
(untouched — that branch is the DAG resume and has no flowchart node to reopen);
`INSPECT_SUMMARY` four keys; `live-isolation` 9/9 (no import added inside the
live closure); contract never synthesized from episode.

## 6. Scope

Changed only the twelve owned files. No edit to `resume.test.ts`, `docs/**`,
`scripts/crash-probe.mjs`, `src/tracking/**`, `src/protocol/**`,
`package.json`, ADRs, `gate-status-posture.test.ts`, or
`option-a-preconditions.test.ts`. ADR-006 untouched and still Proposed. No live
R1, no full gate, no new skip, no scratch files left behind, `git diff --check`
clean. No branch, commit or push.

## 7. Disclosure

One judgement call worth a reviewer's eye: the blocked-run disclosure is
unconditional. Conditioning it on "this block has an executed descendant" would
need the checkpoint, which `formatBlockedRunReport` does not receive, and
conditioning on the `RUN_BLOCKED` reason string would couple the operator
guidance to a gate reason code. I chose the honest unconditional wording over
either. If a later round gives that function the checkpoint, narrowing it is a
one-line change and the prefix pin will keep the ordinary four safe while it
happens.
