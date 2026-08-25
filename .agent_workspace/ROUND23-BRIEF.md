MODEL_SLUG: claude-fable-5-thinking-xhigh

# ROUND 23 BRIEF — injection context for Loop 4 · Round 23 dispatch

Provenance: written by the Round 22 SOTA reviewer at HEAD `7c3f867` on `cursor/opt-r22-42b1`
(code tree = `21a470a`); full verification, freeze check, and the reviewer's own twelve mutant
transcripts in `.agent_workspace/loop4-r22-review.md`. Round 22 landed all three audit-proven,
sign-off-granted candidates and all three were ACCEPTed with every load-bearing clause re-proven by
the reviewer's own out-of-tree mutants. **Round 23 opens with zero candidates — do not pad.** A
zero-slot round is valid and recordable (Rounds 19 and 21 precedent).

## 1. What landed last (context, all committed — do not re-implement)

| What | SHA | State |
|---|---|---|
| R22-1 | `13e375e` | `docs/kernel-reuse.md` + skill reference truth-up under the one-time freeze lift: two-parameter targeted `steerText` in the wired-today row (with `steer-target.test.ts` / `steer-retry.test.ts` in "Verified by"), the retry bullet split into kernel-held state (still lost) vs contract-accepted steers (re-delivered per attempt, R18-1), the worked example's answer filled in with dates and SHAs, two bracketed superseded-pointers on otherwise byte-identical dated journal prose, skill reference in lockstep. All frozen blocks byte-verified; audit P1 claim strings gone as current semantics; no pre-description of R22-2/R22-3. ACCEPTed. |
| R22-2 | `8f11e5c` | The flowchart plane carries a run-level `maxCostUsd` to `ChildCoordinator`: `FlowchartRunInput.maxCostUsd?` (not on `FlowchartRunLimits`), pre-lock fail-closed `DomainValidationError`, conditional stamp into the run's own `RUN_CREATED.limits` (absent stays an absent key), `attachChildRuntime` carriage at both call sites (start reads `run.limits`, resume reads `replayed.run.limits` — durable-record restore only), no `FlowchartContinuation` counterpart; never in `TASK_REQUEST.limits`, never in `taskCostCeilings`, substitution unchanged; five new pins incl. the placement pin (refusal leaves the state root untouched). ACCEPTed, mutant-proven (incl. a quintuple-red per-task-leak kill across two planes). |
| R22-3 | `21a470a` | CLI `run --max-cost-usd <usd>` on the plain and `--children` paths (plain-decimal-only `parseRunCostCeiling` with a frozen refusal message; plain path spreads `{...defaultRunLimits(), maxCostUsd}` only when asked; `--children` forwards R22-2's field; loud parse-args refusal on `--flowchart`/`--track` with frozen strings; resume gains no flag) + `onCostGate` threaded `createConfiguredPiExecutor` → `createExecutor` (pi arm only) → all four executor builds, with `formatCostGateWarning` printing the two byte-frozen disarmed lines and nothing for `stopped`/`no-cap`; USAGE + status-matrix rows 32/34/38 aligned, incl. the no-cross-child-ledger disclosure. ACCEPTed, mutant-proven (both absent-stays-absent directions from two observation points; wording pinned at both ends of the thread). |
| Round 22 review | this HEAD | 3 ACCEPT / 0 ACCEPT-WITH-NITS / 0 ROLLBACK; zero red-tree commit points; three joints judged clean (the fired data-dictionary conditional, the substance-matched status-matrix row 38, the unpinned USAGE reflow); two benign counting inaccuracies in t3 recorded (15 new tests, not 11; final-tree total 2070, not 2065). |

## 2. Current baseline (independent, this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- Reviewer's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2070 tests / 2069 pass / 0 fail /
  0 cancelled / 1 skipped / 120 suites**; typecheck, lint, test, build all ran. Exactly one `# SKIP`
  line (`grep -c` = 1): `ok 315 - PiAgentExecutor completes a run against a real provider # SKIP`
  (the standing `PI_SMOKE` gate). **Matches the parent's recorded 2070/2069/1/120 exactly.**
- Reviewer's own `node scripts/crash-probe.mjs`: **exit 0, `ok: true`, 11 cases × 3 iterations**,
  names and order verified one-by-one against the pinned record (`jsonl-truncated-tail` …
  `unblock-discard-append-before-checkpoint-sigkill` last). No 12th case.
- Reviewer's own `node scripts/kernel-reuse-probe.mjs`: **3 PASS, exit 0.**
- Delta vs the Round 20 baseline 2050: **+20, fully decomposed** — R22-2 +5 (gate TAP
  `ok 186`–`ok 190`), R22-3 +15 (`ok 108`–`ok 112`, `ok 167`–`ok 168`, `ok 305`–`ok 306`,
  `ok 413`–`ok 418`).
- The five Round-22 owned suites at HEAD, 3× each: 30/30, three identical name sets.
- No perf claims this round. Any future perf claim still owes same-VM before/after with an
  unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 23 landings (Rounds 1–22 + merge-settled, carried verbatim)

Everything in ROUND22-BRIEF §3, unchanged and carried whole: the global forbidden list (live
R1/bandit/topology on the execution path; Outcome-supported claims; ADR-006 stays Proposed;
auto-promote; P0 privacy sign-off stays human; `package.json`/dependency edits; git history
rewrites; subagents do not commit; no `git checkout` of other branches; `independentEvidence`
exactly one `void`; eight-member `RunStatus`; no fourth `RUN_UNBLOCKED` key); the Rounds 1–17
frozen-contract set (jsonl/atomic-write/lock/delete/crash-terminal/`applyRetry`/resume-disclosure/
five doctor routes character-exact/`INSPECT_SUMMARY` four keys/BLOCKED-prefix/episode-boundary/
option (a)/discard-audit/probe 11-case order/verdict-producer; `taskCriteria` writer as shipped;
`onRunStarted` on all three public run paths; census terminator; `EventStore.append`/
`CheckpointStore.write` unlocked; preferences writer contract; write-side episode-event validation;
atomic eval publish; both migrate-legacy publish arms; inferred-pref plane not-live; `from-episode`
ingress single); the merge-settled freezes (no kernel-reuse revert; live-through-tool-start as
shipped; thinking bytes-only outside `src/pi-adapter/**`; adaptation closure exactly 4 modules with
both privacy guards censused on any adaptation-plane import change; `remainingCostUsd` a separate
routing-budget plane); the Round 18 contracts (steer re-delivery across retries; ceiling stop
outranks an unconsumed steer; per-child cap carriage + parse-time refusal; spec surfaces aligned by
`159630e`/R18-2); the Round 20 contracts (the `taskCostCeilings` record as shipped; ceiling-free
substitution; targeted `steerText` with the widened probe regex; the doc surfaces aligned inside
`1d9ef99`); the cluster `onSpawn` hardcoded limits — **plus, new this round, the Round 22
contracts:**

- **The `docs/kernel-reuse.md` file-wide freeze is RE-CLOSED behind R22-1 (`13e375e`).** The
  truth-up is done; the file and the skill reference now describe the shipped steering contract and
  may not be edited again without a fresh explicit parent lift. Dated journal subsections stay
  historical (the two bracketed superseded-pointers are part of the frozen text); the lockstep rule
  (`docs/kernel-reuse.md:280`) binds both files together. The regression guard is reproducible: the
  audit P1 claim strings (`went to document-and-drop`, `do not survive a retry`/`retried attempt`,
  `targets the single in-flight kernel`, `refuses when zero or several runs are live`) must keep
  matching nothing in `docs/` + `.agents/`, and no `steerText?(text)` literal may exist without a
  superseded pointer inside its bullet.
- **The flowchart run-level cap carriage as shipped (`8f11e5c`).** `FlowchartRunInput.maxCostUsd?`
  is the only way in; it is refused pre-lock when not a positive finite number (a refused start
  leaves the state root untouched — the placement is pinned); an accepted one is stamped
  conditionally into the run's own `RUN_CREATED.limits` (absent stays an absent *key*, write-side
  validated via `validateRun`) and handed to `ChildCoordinator` at both call sites; a resume
  restores it only from the replayed `RUN_CREATED.limits` — no `FlowchartContinuation` counterpart,
  no flag, no other source. It is coordinator state: never in `TASK_REQUEST.limits` (five pins
  across two planes own this), never in `taskCostCeilings`, and it does not alter
  `fallbackChildLimits`/`withRecordedCostCeilings`. `costCapFor` = min(per-task, run-level) stays
  the enforcement, unedited. **Newly frozen (promoted from t2 §8 by this review):** the library
  refusal message `flowchart maxCostUsd must be a positive finite number of US dollars` — it is
  deliberately distinct from the CLI's `--max-cost-usd …, got: <raw>` message so library-layer and
  CLI-layer refusals stay distinguishable in a transcript.
- **The CLI cost-flag surfaces as shipped (`21a470a`).** `parseRunCostCeiling` accepts plain
  decimals only (`/^\d+(\.\d+)?$/`, positive finite; the `lockWaitOptions` spelling discipline) and
  `undefined` stays `undefined` — no layer invents a cap, in either direction (both invention and
  disappearance are mutant-killed by absent-key controls on disk *and* on stderr). Frozen strings,
  byte-pinned: the parse refusal `--max-cost-usd must be a positive finite number of US dollars,
  got: <raw>`; the combination refusal `run --max-cost-usd is not wired for --flowchart or --track
  yet; it caps the default and --children paths` with next-line `omit --max-cost-usd, or use the
  default or --children path` (at `stage: "parse-args"`, before any work — placement pinned); both
  disarmed warning lines (`unpriced-model`, `invalid-cap`) exactly as shipped in
  `formatCostGateWarning`. `stopped` and `no-cap` print nothing; there is no cost-gate
  `ExecutionEvent` and no durable cost-gate record; `resume` gains no cap flag on any path;
  `onCostGate` is forwarded on the `pi` executor arm only (fakes have no gate); the
  recorded-not-fake-enforced posture on `--children` and the no-cross-child-ledger disclosure (N
  children under a $X run cap can spend up to N·$X) stay as stated in USAGE and the status matrix.
- **The doc surfaces aligned inside the Round 22 landings** (`m0-m2-architecture.md`'s run-level
  ceiling bullet; `data-dictionary.md:160-169`'s per-task/run-level source split;
  `status-matrix.md` rows 32/34/38): verified word-for-substance against shipped behaviour. A
  landing that changes that behaviour re-aligns them in the same commit (census terminator).

Process requirements per slot (carried verbatim from ROUND22-BRIEF §3): census first against the
working tree; verify handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before
reporting; consumer census in your own diff; timing-sensitive owned tests 3×; full gate is the
parent's job; no scratch files at report time (including `/tmp` state roots); mutations/proofs
out-of-tree (full copy, `node_modules` symlinked), then deleted; landing commits are slot files +
report only, no PROGRESS ticks; clear `/tmp/tsx-*` before every verification or mutant run and
verify your own new test *names* appear in the TAP output. One accuracy note from this round's
review: two of three slot reports have now carried benign but real counting slips (R20 t1, R22 t3)
— state test counts from the TAP summary of the final tree, not from memory of the plan.

## 4. Round 23 candidates

**None.** All three Round 22 sign-off-granted seams are closed at HEAD; the reviewer's own twelve
out-of-tree mutants confirmed every load-bearing clause (start and resume handoffs, the durable
stamp, the pre-lock refusal placement, the per-task-leak separation across two planes, the spelling
discipline, invention and disappearance from both observation points, the sink thread end-to-end,
both frozen wordings at both ends, the combination-refusal placement); the gate, crash probe, and
kernel-reuse probe are green on independent runs; no landing stale-ified a recorded surface beyond
what rode inside the landings themselves; and every residual any slot surfaced was judged and none
is a behavioural honesty hole at HEAD (dispositions in §5 and `loop4-r22-review.md` §4). **Do not
pad.**

Valid reasons to dispatch beyond this section (unchanged, each owing a fresh deterministic
out-of-tree proof at that HEAD, 3× identical transcripts of real repo code): a new seam lands
(including a fresh parent sign-off); a reproduced behavioural gap; gate or probe goes red on an
independent run; a landing stale-ifies recorded surfaces (then the alignment rides inside that
landing). A zero-slot Round 23 is a valid, recordable round.

## 5. Explicitly NOT for Round 23 landings

Everything in ROUND22-BRIEF §5, verbatim — including: re-litigating the R18-1 replay placement or
latch; a steer-ordering contract across retry boundaries; pinning the unreachable kernel-refusal
ordering in `steerText`; treating a ceiling-stopped unread steer as a defect; the
`SteerChannel.settled()` swallow; the `AsyncEventQueue` close race; flowchart-node spend ceilings /
a cross-child run-spend ledger; the `/tmp` suite-root leak as a standalone slot (re-measured this
round: 128 roots after the review's own gate + suite runs, same prefixes, removed at report time,
posture unchanged); a 12th crash-probe case; re-running `security-probe` as a recurring chore;
broadcasting steers or a per-run kernel registry; the parent-run × root-run untargeted
cross-delivery (no false durable record — unchanged judgment); the unblock-reopen test-only pin;
the tsx cache hazard as a code slot; a `taskCostCeilings` legacy-recovery arm; refusing unknown keys
in `resolveLimits`; a `stopped` stderr line / cost-gate `ExecutionEvent` / durable cost-gate
record; a run-level-cap flag on `resume` or executor-cap re-arming on resume; extending
`scripts/kernel-reuse-probe.mjs` to check prose — **with these Round 23 updates:**

- **The `steer` CLI verb stays deferred (unchanged judgment, re-confirmed this round).** No false
  durable record appeared in Round 22, so the Round 22 assessment stands verbatim: a second-process
  verb needs a cross-process delivery channel, and every candidate channel is a product decision
  (enqueue-vs-delivery honesty, the crashed-run steer-queue false-record shape, live-run
  naming/ack). Needs a parent product design before any slot exists.
  `docs/kernel-reuse.md`'s "No CLI verb for live steer exists yet" paragraph was byte-verified
  still true and is now part of the re-closed freeze.
- **`--max-cost-usd` forwarding on `--track` and `--flowchart` (updated: the honest boundary now
  exists).** R22-3's loud parse-args refusal is the shipped, pinned, frozen behaviour; the silent
  no-op the audit feared is unreachable. Forwarding remains a real future capability — `--track`
  crosses `startTrackedRun`'s input (`src/track/loop.ts`, outside every granted sign-off) and bare
  `--flowchart` executes RUNNING nodes on the thin path that forwards no cap at all (a new
  enforcement surface, not a handoff) — so it re-enters only with a fresh parent sign-off naming
  those surfaces, and any landing must replace the frozen refusal strings and their pins in the
  same commit (census terminator).
- **`README.md:159`'s parenthetical run-flag list** — an illustrative list that was already seven
  flags short before Round 22 and claims no exhaustiveness; nothing false is on record.
  Owner-on-next-touch of `README.md`; a slot to append one flag name to a non-normative list is
  padding.
- **Hoisting the duplicated `reportCostGate` handler** (t3 §6) — four lines defined twice, matching
  the existing `invocationSink` pattern; style, not a seam, and not worth a diff.
- **Node `parseArgs`'s "argument is ambiguous" pre-emption of bare dash-leading option values** —
  inherited by every string option on the CLI, loud, writes nothing, documented in place in
  `run-cost-cap.test.ts`. Not a seam this loop owns.
