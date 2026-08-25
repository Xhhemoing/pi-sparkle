[Model: claude-fable-5-thinking-xhigh]

# ROUND 19 BRIEF — injection context for Loop 4 · Round 19 dispatch

Provenance: written by the Round 18 SOTA reviewer at HEAD `0c948ba` on
`cursor/opt-r18-postmerge-42b1` (code tree = `4412fac`); full review evidence in
`.agent_workspace/loop4-r18-review.md`. Round 18 dispatched the post-merge audit's two proven
candidates and both landed clean (2 ACCEPT, 0 nits, 0 rollback, zero joints). This brief records the
resulting state: **zero candidates — a follow-up round dispatched without one of the §4 reasons
below is padding, and a zero-slot Round 19 is a valid, recordable round.**

## 1. What landed last (context, all committed — do not re-implement)

| What | SHA | Landed |
|---|---|---|
| R18-2 | `daea498` | `parseChildSpec` carries a declared per-child `maxCostUsd`: positive finite values copied, any other non-`undefined` value refused at the spec file with `DomainValidationError` naming the task, absent stays absent. Carriage pinned on disk (`TASK_REQUEST.limits` + child `RUN_CREATED.limits`); refusal pinned to write no run and to name the task in the message (a silently-copied `0` provably dies far away with an *empty* operator message — reviewer's Mutant B). `docs/specs/m0-m2-architecture.md:359-366` rewritten to the `159630e` `ChildRunLimits` disclosure. |
| R18-1 | `4412fac` | Accepted steers survive 429/5xx retries, direction (a) per parent sign-off: `PiAgentExecutor.acceptedSteers` scoped to the whole `execute()` (registered/discarded in `runWithRetry`, identity-guarded), per-attempt snapshot, re-delivered into each fresh retry kernel at the attempt's **first `TURN_FINISHED`** (never folded into the opening prompt), latched once per attempt, recorded only after the kernel accepts. No new event type; `coordinator.ts`/`events.ts` diff-empty. `STEER_INJECTED` is true again. |
| Orchestrator | `7d8b7a3`…`a5535fb`, `0c948ba` | `.agent_workspace/**` only (audit, dispatch, gate records, this review's dispatch), verified per-commit. |

Both landings were independently re-verified by the Round 18 review with its own out-of-tree
mutants (five total, each killed with exactly the claimed pins as sole reds) — see review §4.

## 2. Current baseline (independent, this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- Reviewer's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2042 tests / 2041 pass / 0 fail /
  0 cancelled / 1 skipped (PI_SMOKE, exactly one `# SKIP` line) / 120 suites**; typecheck, lint,
  test, build all ran. This independently verifies the parent's recorded numbers. Delta vs the
  post-merge audit baseline 2038 is exactly the four new pins (R18-2 `ok 161`/`ok 162`,
  R18-1 `ok 299`/`ok 300`).
- Reviewer's own `node scripts/crash-probe.mjs`: **`ok: true`, 11 cases × 3 iterations**, names and
  order verified against the Round 16 record, `unblock-discard-append-before-checkpoint-sigkill`
  last. No 12th case; the script is diff-empty across the round.
- Both privacy guards green standalone (11/11) with stale-entry asserts in both directions —
  allowlists equal the real import graph; neither Round 18 landing touched a `src` import.
- The 10 pre-existing steer pins plus the 2 new retry pins: 12/12, three identical runs.
- No perf claims this round. Any future perf claim still owes same-VM before/after with an
  unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 19 (Rounds 1–18 + merge-settled)

Global forbidden list, unchanged from ROUND18-BRIEF §3: live R1/bandit/topology on the execution
path (doctor's `loadProjectBanditByKey` inventory read stays the only extra bandit reader;
`selectArm` only from `routing/shadow.ts`); Outcome-supported claims; **ADR-006 stays Proposed**;
auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history
rewrites; subagents do not commit; no `git checkout` of other branches; `independentEvidence` never
read as corroboration (exactly one `void`, `prescore.ts:89`); exact eight-member `RunStatus`; no
fourth `RUN_UNBLOCKED` key.

Frozen contracts: the whole Rounds 1–17 set carried verbatim from ROUND18-BRIEF §3 — jsonl/
atomic-write/lock/delete/crash-terminal/`applyRetry`/resume-disclosure/doctor routes (five
`DOCTOR_ROUTED_NEXT` + `GENERIC_FAILURE_NEXT`, character-exact)/`INSPECT_SUMMARY` (four
frozen-additive keys via pure `buildInspectSummaryJson`)/BLOCKED-prefix/episode-boundary/option
(a)/discard-audit/probe (11 cases, order pinned)/verdict-producer freezes; `taskCriteria` writer as
shipped; `onRunStarted` on all three public run paths; the census terminator; `EventStore.append`/
`CheckpointStore.write` unlocked; the preferences writer contract; write-side episode-event
validation; atomic eval publish; both migrate-legacy publish arms pinned; the CLI
inferred-preference plane stays not-live; the `from-episode` ingress stays `run/event-store.ts`
alone. Merge-settled freezes carried verbatim: do not revert kernel-reuse (SparkleKernel/
AsyncEventQueue/CostGate arithmetic/`maxCostUsd` forward — absent stays absent);
live-through-tool-start streaming as shipped (`77e5d42`); thinking bytes-only outside
`src/pi-adapter/**`, nothing thinking-derived in `STEER_INJECTED.text`; adaptation closure
allowance exactly 4 modules (`dc0c611`) — a dispatch that changes an adaptation-plane `src` import
edge must census **both** privacy guards into its ownership grant up front; `remainingCostUsd`
stays a separate enforced plane from the executor spend ceiling.

**New, settled by Round 18 (now frozen):**
- **Steer re-delivery across retries as shipped.** The `acceptedSteers` log lives and dies with
  `runWithRetry`; snapshots are taken before each attempt; re-delivery happens at the retry
  attempt's first `TURN_FINISHED` (after `gate.recordTurn`, never at the prompt), latched once per
  attempt; the record in `steerText` is appended only after the kernel accepts. All three clauses
  are pinned (each was the sole kill of one reviewer mutant). Do not move the re-delivery to the
  opening prompt, do not add a correcting event type, and do not widen the steerable window — a
  steer during backoff stays a loud refusal.
- **A ceiling stop outranks an unconsumed steer.** If `stopAfterTurn` fires between the replay
  enqueue and the poll, the run ends at the disclosed ceiling with the steer unread — this is the
  intended precedence, exists identically for live steers without a retry, and is not a defect.
- **Per-child cap carriage + parse-time refusal as shipped.** `parseChildCostCeiling` refuses any
  declared non-positive-finite `maxCostUsd` at the spec file, naming the task; a valid cap reaches
  `TASK_REQUEST.limits` and the child's `RUN_CREATED.limits` on disk; absent stays absent. The
  fake-children executor ignoring the forwarded cap remains the pinned contract — carriage, not
  enforcement.
- **The spec surface is aligned:** `m0-m2-architecture.md` now matches the `ChildRunLimits`
  disclosure; `protocol/v1.ts`, `child-coordinator.ts`, and the data dictionary were already
  aligned by `159630e`. No cost-disclosure surface is known-stale at HEAD.

Process requirements per slot (carried forward): census first against the working tree; verify
handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before reporting; consumer census
in your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no scratch files
at report time (including `/tmp` state roots from proofs); mutations/proofs out-of-tree (full copy,
`node_modules` symlinked), then deleted; landing commits are slot files + report only, no PROGRESS
ticks.

## 4. Round 19 candidates

**None.** The post-merge audit swept the entire merge seam and proved exactly two holes; Round 18
closed both, each clause independently mutant-verified at HEAD by the review. Every residual either
slot surfaced was judged and none is a behavioural honesty hole (review §4.1/§4.2 record the
judgments and owners-on-next-touch). No landing this round stale-ified a recorded surface beyond
the spec lines R18-2 itself fixed. A zero-slot Round 19 is the honest, recordable outcome.

**Valid reasons to dispatch anything (each owing a fresh deterministic out-of-tree proof at that
HEAD, in the dispatch itself):**
1. A **new seam** lands (a merge, a dependency change the parent authorizes, a new subsystem).
2. A **reproduced behavioural gap**: a deterministic out-of-tree transcript of real repo code at
   HEAD showing a contract violated or a record made false — not a hypothesis, not a style issue.
3. **Gate or probe goes red** on the parent's or any auditor's independent run.
4. A landing **stale-ifies recorded surfaces** (docs/specs/pins) — then the alignment rides inside
   the landing that caused it, per the census terminator.

## 5. Explicitly NOT for Round 19

Everything in ROUND18-BRIEF §5, verbatim — including: live R1/bandit/topology; any new `RunStatus`;
a fourth `RUN_UNBLOCKED` key; per-criterion `UNOBSERVED`; jsonl/lock perf; mailbox/cluster; lock
stealing; resume-time adoption; non-terminal `RUN_CRASHED`; rewriting append-only logs; ADR-006
status changes; P0 sign-off; dependency bumps; in-tree mutation testing; a 12th crash-probe case;
reverting or re-buffering the kernel-reuse contracts; **wiring `onCostGate` at the CLI as a
standalone slot** (R18-2 created the first CLI path that can declare a cap, so the event now has a
producer — but the disclosure already names enforcement executor-dependent, a ceiling stop is
transcript-visible, and no operator-facing honesty hole is proven; fold into a future slot with a
proven need); the `SteerChannel.settled()` allSettled swallow (disk-failure-only, unreproduced, for
whoever next owns `coordinator.ts`); the `AsyncEventQueue` close race (unreachable, docstring-pinned);
flowchart-node spend ceilings / a cross-child run-spend ledger (capability + product decision); a
`steer` CLI verb (product) — **plus, new this round:**

- **Re-litigating the R18-1 replay placement or latch.** First-`TURN_FINISHED` delivery,
  once-per-attempt, execution-scoped log: all three are pinned and each pin was proven load-bearing
  by a single-red mutant. Moving any clause is a contract change needing parent sign-off and a
  proven defect first.
- **A steer-ordering contract across retry boundaries.** When a live steer arrives during a
  post-retry attempt's first turn, it can be polled before the replayed text; both are delivered
  exactly once and no record claims an order. Constructing the case needs a steer inside a blocked
  tool of a post-retry attempt; nothing becomes false. Not a slot without a proven honesty hole.
- **Pinning the executor-level kernel-refusal ordering in `steerText`.** Unreachable through Pi
  (`Agent.steer` only enqueues) and pinning it would require adding a kernel-injection seam to
  production code purely for the test. The analogous ordering is already pinned one layer up in
  `steer-inflight`. Disclosed, not a slot.
- **Treating a ceiling-stopped run with an unread steer as a defect.** Frozen above (§3): the
  ceiling wins, disclosed in the transcript, identical shape without a retry.
- **A run-level `maxCostUsd` CLI flag.** `run --children` declares per-child caps; nothing claims a
  run-level flag exists; `costCapFor` mins correctly when embedders set it. Capability work.
- **The `/tmp` suite-root leak as a standalone slot.** A full-suite run leaves ~130 `mkdtemp` state
  roots (`pi-sparkle-pause-*`, `pi-sparkle-eval-state-*`, `pi-sparkle-eval-frozen-*`,
  `pi-sparkle-eval-ds-*` dominate) — real, measured twice (t1 ~138, review 128), but test hygiene,
  not honesty. Fold cleanup into whichever slot next owns those suites; a hygiene-only dispatch is
  the census-note treadmill in new clothes.
- **`docs/kernel-reuse.md` edits.** It is a dated round-status journal whose claim gates
  (`rg maxCostUsd src/run/coordinator.ts` = two hits) still pass at HEAD. Accurate; leave it.

A zero-slot follow-up round after this brief is a valid, recordable round.
