[Model: claude-opus-5-thinking-high-fast]

# R8-1 — `RUN_UNBLOCKED`: a BLOCKED run can now be ended, and the reopened work really runs

Slot: R8-1 (round spine) · branch `agent/opt-continuous` (no checkout, no commit, no push) ·
owned files only. Brief R8-3 (BLOCKED report on `resume`/`answer`) folded in, per sign-off.

Shipped: the persisted `RUN_UNBLOCKED` schema exactly as `.agent_workspace/loop4-r7-t3.md`
designed it, a dedicated locked `pi-sparkle unblock` command, the flowchart reopen operation
behind it, event-first crash recovery, and the honesty repair to the BLOCKED operator block.
Whole-tree `tsc --noEmit` clean, scoped eslint clean, owned tests 3× stable, full tree
**1840 / 1839 pass / 1 skip** (`PI_SMOKE` only — no new skip; baseline was 1804/1803/1, and
the delta is my 24 plus siblings' additive tests).

---

## 1. Census, taken against the working tree

| Claim I needed | What the tree said | Verdict |
|---|---|---|
| `EVENT_TYPES` has no `RUN_UNBLOCKED`, pinned by a tripwire | `replay.test.ts:164-169`, an `assert.equal(..., false, ...)` demanding parent sign-off | confirmed; **replaced**, §7 |
| `TERMINAL_REPLAY_STATUSES` is the single definition of terminal | `replay.ts`; `alreadyTerminal` and `recordTerminal` both consult `replayedTerminalStatus` | confirmed; this is the whole integration seam, §3 |
| R7-5 left `resume`/`answer` without the BLOCKED block | both flowchart branches went straight to `flowchartExitCode` | confirmed; wired, §6 |
| the note-line promises no unblock exists | *two* clauses: "no event clears a BLOCKED log today" and "replays BLOCKED until an unblock ships" | confirmed; both now false, both rewritten, §6 |
| R8-3's absence pin exists and covers my files | `test/unit/run/flowchart-applyretry-absence.test.ts` (untracked, landed) scans `flowchart-run.ts` **and** `flowchart-supervisor.ts` for the `applyRetry` identifier, string literals, static and dynamic `scheduler.js` imports | confirmed; kept green **unweakened and unedited**, §4 |
| `docs/**` needs a `RUN_UNBLOCKED` row from me | it does not — R8-5 already landed it, and their text matches what I shipped (four `next:` lines, resume/answer parity, stale/mismatched unblock is an anomaly, locked command refusing stale/repeated/wrong-node) | **no docs edit needed**; I own no `docs/**` anyway |
| `docs/data-dictionary.md` enumerates event types | it does not enumerate individual event types at all | no gap |

Two census results changed what I built:

- **`retryNodeId` cannot be mandatory.** R7-3's prose leans that way for gate blocks, but the
  stall shape has no failed node by construction, and a gate block whose turn maps to no FAILED
  node would become permanently unblockable — the exact defect this contract exists to remove.
  So the field is optional in the schema and *strictly* validated whenever the block names a
  node (§5).
- **`applyChildThreeLine`'s `runStatus` is not consumed on the flowchart path.** Only the
  appended events are. That means the `gate-apply.ts` change is observable solely through the
  `from` field of the *next* transition, which the happy path never writes. I found this by
  writing an assertion that failed, and it is why the proof for §3's gate change is the
  re-block cycle rather than the completion path (§8).

---

## 2. The event (`src/run/events.ts`)

`RUN_UNBLOCKED` sits immediately after `RUN_BLOCKED` in `EVENT_TYPES`, with payload
`{ blockedEventId: EventId; reason: string; retryNodeId?: string }`.

Validation is exact-keyed and refuses: unknown keys (named individually), a `blockedEventId`
that is not a valid `EventId`, a missing or whitespace-only `reason`, and a `retryNodeId` that
is present but not a non-empty string.

No evidence field. Facts stay in the events that already carry them — above all
`INJECTION_REQUESTED` — so this event cannot become a second, unverifiable evidence vocabulary.
`reason` is the audit rationale and the event's own `actor` records who authorized it, which is
why `unblock --actor` exists.

`retryNodeId` is a **flowchart node id, not a `TaskId`**: the reopen is a `FlowNodeState`
transition, not a DAG one. That distinction is load-bearing for §4.

## 3. Replay (`src/run/replay.ts`) — one change, every writer

`replayRun` now retains which terminal is active and, for BLOCKED, which event opened it. A
`RUN_UNBLOCKED` naming that exact event clears `sawTerminal` and drops the status back onto the
pre-terminal ladder (so an unblocked run that also has an outstanding pause replays PAUSED, not
a hardcoded RUNNING).

Everything else is an anomaly the log keeps, with the terminal left exactly where it was:

| Shape | Anomaly | Latch |
|---|---|---|
| no active block | `RUN_UNBLOCKED without an active RUN_BLOCKED` | unchanged |
| after COMPLETED/FAILED | `RUN_UNBLOCKED after a terminal event` | unchanged |
| names a different block | `RUN_UNBLOCKED does not match the active RUN_BLOCKED` | unchanged |

`TERMINAL_REPLAY_STATUSES` is **unchanged** and `RUN_UNBLOCKED` is not a status. That is the
point: because all three flowchart recorders, the parent-terminal guard and every other writer
decide "has this log already ended?" by asking `replayedTerminalStatus`, reopening them was one
change here and **zero per-writer special cases**. I added none, and the docstring now says so
in the place a future writer will read it.

Two optional fields are exposed on `ReconstructedRun` — `activeBlockedEventId` and
`clearingUnblockEventId` — so the producer targets the active block rather than re-deriving
which one that is, and so restore can tell an already-applied unblock from a pending one. I
censused for deep-equality tests on the whole object first; there are none, and
`materializeCheckpoint` selects named fields rather than spreading.

`gate-apply.ts::currentGateStatus` tracks the active block id for the same reason and by the
same rule, so the gate's reconstruction and replay's cannot disagree in writing about whether a
run was ever unblocked.

## 4. The reopen — a distinct name, and a distinct state machine

`FlowchartSupervisorImpl.reopenAfterUnblock`, exposed as the pure snapshot transform
`reopenBlockedFlowchartSnapshot(config, snapshot, request)`. It runs through a restored
supervisor rather than editing JSON, so the reopen is checked by the same restore validation,
the same waiter invariant and the same propagation fixpoint as every other transition.

It **does not** fabricate a `TaskNode`, call `applyRetry`, append `TASK_STATUS_CHANGED READY`,
or import `scheduler.js`. `src/graph/scheduler.ts` is byte-identical — untouched — and remains
the sole producer of the DAG's BLOCKED→READY transition. R8-3's pin enforces all of this at the
AST level and passes; I neither edited nor weakened it.

Behaviour:

- The ledger latch (`isBlocked` / `consecutiveStalls` / `requiredEvidence`) is cleared for
  **both** shapes. It is a no-op for a gate block (that round recorded evidence, so it never
  stalled), but a run blocked in both senses must not have its reopened node immediately
  re-blocked by a ledger nobody authorized to stay set.
- With `retryNodeId`: the node must be FAILED, its failed outcome fields and stale active route
  go, and the consequences that failure had downstream are rewound to PENDING. "Consequence"
  means reachable through outgoing edges *that the destination's join actually reads* — an edge
  a join policy does not require carries no consequence, so following it would rewind a node
  for a reason it never depended on.
- **Fail-closed:** if any such descendant is RUNNING / WAITING_FOR_USER / COMPLETED / FAILED,
  the reopen throws and names it. Rewinding executed work would discard real spend on the
  strength of an operator's `--reason` string. Allowing it needs its own authorization
  contract; silently erasing is the one outcome that must not be available.
- Evidence counts and every logged event survive untouched. The old attempt stays visible; this
  only decides what runs next.

## 5. The producer (`src/run/flowchart-run.ts`)

`unblockFlowchartRun` takes `withRunLifecycleLock` (non-reentrant, acquired once), requires
replay to say BLOCKED with an active block id, and **executes nothing**.

Order is deliberate and asserted: **transform → append → checkpoint**.

- The transform runs first, so a refused reopen (unknown node, node never failed, executed
  descendant) leaves no authorization on a log that did not earn one. §8 proves four refusals in
  a row write nothing.
- The append precedes the checkpoint write, so the surviving crash state is "authorization
  durable, reopen not" — recoverable — rather than "reopened checkpoint nothing on the log
  authorizes", which no reader could explain.

`resolveRetryTarget` derives the block's own failed node from the `GATE_TRANSITION` immediately
preceding the `RUN_BLOCKED` (tracking assessments set `turnId` to the child task id), maps it to
a definition node, and requires it to be FAILED in the snapshot. When such a node exists,
`--retry-node` must name **exactly** it — omitting it is refused with the node id in the
message, and naming a different one is refused with both. When no such node exists (the stall
shape), no target is demanded.

**Event-first crash recovery** is idempotent by construction. `unappliedUnblock` compares the
clearing unblock's position in the log with `checkpoint.lastEventId` — not merely "does the log
carry one" — and `restoreCheckpointedSupervisor` re-derives the transform only when the
checkpoint predates it. Shared by `resumeFlowchartRun` *and* `restoreFlowchartSession`, so a
pause or an inject taken inside that window cannot checkpoint the reopen back out.

I did **not** add `contract` to `FlowchartCheckpointState` (R8-2, deferred).

## 6. CLI (`src/cli/main.ts`)

`pi-sparkle unblock --run <runId> --reason <text> [--retry-node <nodeId>] [--actor <who>] [--state-root <dir>]`,
in `USAGE`, in dispatch, with prose that tells the operator it executes nothing.

It is a separate command rather than a fourth injection kind, and the in-source comment gives
the three reasons: injection adds a typed fact while this changes what every writer thinks the
run's terminal is; `injectFlowchartRun` deliberately holds **no** lifecycle lock because it may
target a live run, while this must serialize against resume and delete; and only a dedicated
command can insist on one active block, one matched event, and a refusal for the stale or
repeated attempt without conflating that authorization with user-supplied facts.

Success prints to **stdout** and ends with `resume:` — not `next:` — because `next:` on stderr
is a pinned failure-routing convention and this is not a failure.

**The note-line repair.** Both old clauses were false the moment this landed, and a routing
block that tells an operator a remedy does not exist is worse than one that omits it. Three
routed lines became four, in the order the operator works in:

```
  next: pnpm cli inspect --run <id> --state-root <dir>
  next: pnpm cli inject --run <id> --type fact --key <key> --value <text> --state-root <dir>
  next: pnpm cli unblock --run <id> --reason <text> [--retry-node <nodeId>] --state-root <dir>
  note: resume alone replays BLOCKED — unblock is the event that clears this log, so run
        unblock first, then pnpm cli resume --run <id> --state-root <dir> executes the reopened work
```

Resume keeps a `note:` rather than a `next:` because on its own it still replays BLOCKED —
that part was true before and remains true.

**R8-3 folded in:** `reportBlockedRun` is now wired at the flowchart `resume` and `answer`
sites. **The supervised resume branch is untouched** — its stderr is byte-pinned by
`loopback-cli-resume.test.ts` (which I did not open for edit; it is byte-identical), and a DAG
resume has no flowchart node an unblock could reopen. There is a source pin asserting that
branch contains no `reportBlockedRun`.

The five `DOCTOR_ROUTED_NEXT` routes are character-identical.

## 7. The tripwire, replaced rather than weakened

`replay.test.ts`'s `assert.equal(EVENT_TYPES.includes("RUN_UNBLOCKED"), false, ...)` is gone,
and the surrounding test — that operator and scheduler signals cannot clear the latch — is kept
and renamed to say what it now means. In its place, five tests covering every case the brief
named: matched (latch opens, next terminal is a *first* terminal, latch closes behind it),
status re-derivation after unblock (PAUSED / CANCELLED / WAITING_FOR_USER), stale and repeated,
wrong-terminal (after COMPLETED, after FAILED, never blocked), and full BLOCKED → RUNNING →
BLOCKED → RUNNING → COMPLETED cycles where each unblock must name its own block. The
`EVENT_TYPES` assertion survives inverted: the event is now pinned as *present*.

`event-row-fuzz.test.ts` carries the mandatory exact-keyed seed in `EVENT_TYPES` order (the
suite pins `Object.keys(EVENT_SEEDS)` against it, so the position is enforced), plus seven named
refusals for the payloads a hand-edited log or a future producer could plausibly write.

`blocked-next.test.ts` pin 2 now `deepEqual`s the exact four-line set and asserts both retired
claims are absent by string, so a revert cannot quietly reinstate them.

## 8. Integration proof, and what each test actually holds down

Two new files: `test/integration/run/unblock-flow.test.ts` (8) and
`test/integration/cli/unblock.test.ts` (6).

The headline, on the reviewer's R6-1 seed — a clustered child reporting success against a failed
verification: **BLOCKED → `unblock --retry-node` → resume → the node re-executes → COMPLETED**,
with one log carrying `["RUN_BLOCKED", "RUN_COMPLETED"]` in order and **zero anomalies**. The
executor's recorded `taskIds` is `[]` after the unblock and `[NODE]` after the resume, which is
the direct evidence that unblock spends nothing and resume is the sole execution surface.

Also covered: the stall shape (no `retryNodeId`, ledger latch cleared, then resumed to
COMPLETED with the result it was waiting for); the re-block cycle; event-first crash recovery
(the pre-unblock checkpoint written back over the reopened one, then resume re-derives it);
non-double-application; the fail-closed descendant refusal; four producer refusals that leave
the log untouched; and — via the CLI — arg validation, the spent-authorization refusal, run-not-
found, `help` text, and the resume-before-unblock path still replaying BLOCKED with the new
`unblock` line on it.

**Mutation-checked, because "passes" is not the same as "holds something down."** Each of these
was applied to source, run, and reverted:

| Mutation | Failed | Passed |
|---|---|---|
| `unappliedUnblock` drops the `lastEventId` comparison | 1, 4 | 2, 3, 5–8 |
| restore never recovers an unapplied unblock | 3 | all others |
| `currentGateStatus` ignores `RUN_UNBLOCKED` | 2 (the re-block cycle) | all others |

The third is the one worth naming. Because `applyChildThreeLine`'s `runStatus` is discarded on
the flowchart path, the gate change is only visible in the `from` field of the *next* written
transition — and a passing re-verification maps to `directive: "none"`, which writes none. So
the completion path cannot see it, and only the run that fails again does. Without the change
that second transition records `from: "BLOCKED"`: one run, two reconstructions, disagreeing in
writing about whether it was ever unblocked. `blocked-next.test.ts` likewise carries a mutation
check for the new four-site wiring pin.

---

## 9. Verification

- `npx tsc --noEmit` whole tree: clean.
- Scoped eslint over all six owned source files and all five owned/new test files: clean.
- Owned + frozen-pin tests (incl. `flowchart-applyretry-absence`, `live-isolation`,
  `loopback-cli-resume`, `gate-apply`) **3×**: 68/68 each pass, stable.
- Consumer suites: `test/unit/run` + `test/unit/supervisor` + `test/unit/tracking` 321/321;
  `test/integration` 291 (290 pass, 1 `PI_SMOKE` skip).
- Full tree: **1840 / 1839 pass / 1 skip**. No new skip. No `pnpm gate`.
- `live-isolation.test.ts` run even though I added no new module edge (both new imports are
  from modules the importing file already imported).
- No scratch files in the repo at report time.

## 10. Frozen items, each checked

`TERMINAL_REPLAY_STATUSES` / `replayedTerminalStatus` unchanged · `src/graph/scheduler.ts`
untouched, `applyRetry` still sole producer, R8-3's pin green and unedited ·
`src/run/crash-terminal.ts` untouched · `childTasksFromLog` untouched · append/checkpoint still
take no run lock; `withRunLifecycleLock` acquired once, non-reentrantly · five
`DOCTOR_ROUTED_NEXT` routes character-exact · the four resume disclosure wordings unchanged;
only the BLOCKED `note:` I was authorized to change · `loopback-cli-resume.test.ts`
byte-identical · no `contract` on `FlowchartCheckpointState` · ADR-006 untouched · no live R1,
no bandit/topology, no `package.json`, no dependency bumps, no git history touched, still on
`agent/opt-continuous`.

## 11. For the parent

1. **Not shipped, deliberately: rewinding an executed descendant.** The reopen fails closed and
   names the blocking node. That is the right default, but it means a gate block whose failure
   fanned out into completed downstream work is still unfixable by `unblock` alone. It needs its
   own authorization contract (an explicit "discard this work" flag with its own audit record),
   not a widening of this one. Candidate for a later round.
2. **`retryNodeId` is optional by necessity, not by preference** (§1). If a future gate block
   can name a turn with no corresponding FAILED node, that run takes the stall path through the
   producer: ledger cleared, no node reopened. Worth a look if a new gate directive lands.
3. **`applyChildThreeLine` discards `GateApplyResult.runStatus` on the flowchart path** while
   the parent DAG coordinator reads `directive`. Not a defect today, and I did not change it —
   but it means the gate's reconstruction is nearly write-only on that plane, and the next
   person to rely on it should know it is exercised by exactly one test.
