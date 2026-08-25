[Model: claude-fable-5-thinking-xhigh]

# ROUND 21 BRIEF — injection context for Loop 4 · Round 21 dispatch

Provenance: written by the Round 20 SOTA reviewer at HEAD `1d0ea6d` on
`cursor/opt-r18-postmerge-42b1` (code tree = `1d9ef99`); full verification, freeze check, and the
reviewer's own mutant transcripts in `.agent_workspace/loop4-r20-review.md`. Round 20 landed both
audit-proven candidates and both were ACCEPTed with every load-bearing clause re-proven by the
reviewer's own out-of-tree mutants. **Round 21 opens with zero candidates — do not pad.** A
zero-slot round is valid and recordable (Round 19 precedent).

## 1. What landed last (context, all committed — do not re-implement)

| What | SHA | State |
|---|---|---|
| R20-2 | `57ade59` | `AgentExecutor.steerText?(text, agentInstanceId?)`: `startRun` opens the steer window targeted at its root agent instance, `startParentRun` opens untargeted (whichever-child stays the disclosed one-run semantics); a targeted miss is a loud `DomainValidationError` thrown before any write, so no `STEER_INJECTED` can name an instance that never received the text; untargeted sole-live-or-refuse unchanged, refusal strings byte-identical; no new event type, no broadcast, no second registry; R18-1 replay mechanics byte-identical. Includes the landing-triggered `scripts/kernel-reuse-probe.mjs` one-character-class regex widening (the documented manual claim-gate would otherwise be red at HEAD). ACCEPTed; reviewer's mutant + probe reproduced both audit dishonesties and the fix kills them. |
| R20-1 | `1d9ef99` | Direction (b) restore: `FlowchartCheckpointState.taskCostCeilings?` records each task's caller-declared `maxCostUsd` (ceiling only) at accept time — optional, absence = unknown and stays an absent *key*, first-write-wins, never synthesized, validated fail-closed (`validateTaskCostCeilings`: non-empty, strict-ascending `taskId`, positive-finite), no `FlowchartContinuation` counterpart; `fallbackChildLimits`'s sibling arm substitutes only `maxAttempts`/`timeoutMs`/`maxWallTimeMs` (never `maxCostUsd`); `withRecordedCostCeilings` restores a recorded ceiling onto substituted specs only; all seven `taskCriteria` seams mirrored (start seed, checkpoint advance+write, resume read/ctx, pause-inject restore, unblock destructure + reopen write); `replay.ts:95-101` coda byte-identical. Parent folded the `docs/data-dictionary.md:161-164` + `docs/status-matrix.md:38` sibling-budget clauses into the landing (slot-proposed wording; terminator-compliant). ACCEPTed; reviewer's mutants reproduced both the invention and the disappearance and the fix kills both. |
| Round 20 review | this HEAD | 2 ACCEPT / 0 ACCEPT-WITH-NITS / 0 ROLLBACK; zero red-tree commit points; two joints judged clean; one benign slot-report inaccuracy recorded (t1's mutant 2 is a double red — the operator-pause pin also owns the restore — not the single red recorded). |

## 2. Current baseline (independent, this VM, Node v22.14.0, engines `>=22.19.0` warning only)

- Reviewer's own `pnpm gate` at HEAD: **GREEN, exit 0 — 2050 tests / 2049 pass / 0 fail /
  0 cancelled / 1 skipped / 120 suites**; typecheck, lint, test, build all ran. Exactly one `# SKIP`
  line (`grep -c` = 1): `ok 301 - PiAgentExecutor completes a run against a real provider # SKIP`
  (the standing `PI_SMOKE` gate). **Matches the parent's recorded 2050/2049/1/120 exactly.**
- Reviewer's own `node scripts/crash-probe.mjs`: **exit 0, `ok: true`, 11 cases × 3 iterations**,
  names and order verified one-by-one against the pinned record (`jsonl-truncated-tail` …
  `unblock-discard-append-before-checkpoint-sigkill` last). No 12th case.
- Reviewer's own `node scripts/kernel-reuse-probe.mjs`: **3 PASS, exit 0** — including the widened
  `executor-steer` regex, whose pre-widening form was verified non-matching at HEAD.
- Delta vs the Round 18 baseline 2042: **+8, fully decomposed** — R20-1 +5 (gate TAP `ok 201`–`ok 205`),
  R20-2 +3 (`ok 306`–`ok 308`).
- Owned suites at HEAD, 3× each: `resume.test.ts` 27/27; the five steer suites together 15/15 (12
  pre-existing pins untouched + 3 new). Both privacy guards standalone: 11/11, both directions.
- No perf claims this round. Any future perf claim still owes same-VM before/after with an
  unchanged-arm control, ≥5% end-to-end.

## 3. Forbidden / frozen for Round 21 landings (Rounds 1–20 + merge-settled, carried verbatim)

Everything in ROUND20-BRIEF §3, unchanged and carried whole: the global forbidden list (live
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
enforced plane); the Round 18 contracts (steer re-delivery across retries as shipped; ceiling stop
outranks an unconsumed steer; per-child cap carriage + parse-time refusal as shipped; the spec
surfaces aligned by `159630e`/R18-2) — **plus, new this round, the Round 20 contracts:**

- **The `taskCostCeilings` record as shipped (`1d9ef99`).** Ceiling only, never the whole limits
  object; optional at `schemaVersion: 1`; absence = unknown, stays valid forever, and stays an
  absent *key*; first-write-wins; never synthesized — not from a sibling, not from the run's own
  limits, not from a default; fail-closed validation (non-empty array, strict-ascending `taskId`,
  positive-finite value) parallel to and separate from `validateTaskCriteria`; no
  `FlowchartContinuation` counterpart (a resume must not be a way to raise a child's cap); restore
  touches substituted specs only and only their ceiling. The frozen `taskCriteria` writer stays
  byte-identical (the ceiling advance sits beside it, not inside it).
- **Ceiling-free substitution as shipped (`1d9ef99`).** `fallbackChildLimits` substitutes exactly the
  three coordinator-enforced fields in every arm; an absent cap stays absent on the resume rebuild —
  the restored kernel-reuse contract, now pinned (`ok 202`) and mutant-proven.
- **Targeted `steerText` as shipped (`57ade59`).** The optional `agentInstanceId` parameter;
  `startRun` targets its root instance; `startParentRun` passes none (whichever-child stays the
  disclosed semantics; its `STEER_INJECTED` payload keys stay exactly `["text"]`, pinned); a
  targeted miss refuses loudly before any write; untargeted sole-live-or-refuse and both its refusal
  strings unchanged; delivery strictly before logging; no broadcast; no second kernel registry;
  record-after-accept single-sourced in `deliver`. R18-1 replay placement/latch/scoped-log stay
  byte-frozen.
- **The `kernel-reuse-probe.mjs` regex as widened** (`steerText\s*\(\s*text\s*:\s*string\s*[,)]`) —
  the claim-gate now matches the shipped signature; do not re-narrow it and do not weaken its other
  two clauses.
- **The doc surfaces aligned inside `1d9ef99`** (`m0-m2-architecture.md:368-381`,
  `data-dictionary.md:161-164`, `status-matrix.md:38`): the substituted-budget clause now names the
  three carried fields, the never-carried `maxCostUsd`, and the record-only restore path. A landing
  that changes that behaviour re-aligns all three in the same commit (census terminator).

Process requirements per slot (carried forward, one addition): census first against the working
tree; verify handed paths exist; scoped `eslint` + whole-tree `tsc --noEmit` before reporting;
consumer census in your own diff; timing-sensitive owned tests 3×; full gate is the parent's job; no
scratch files at report time (including `/tmp` state roots); mutations/proofs out-of-tree (full
copy, `node_modules` symlinked), then deleted; landing commits are slot files + report only, no
PROGRESS ticks. **New (from t1's disclosed verification hazard, honored by the R20 review): clear
`/tmp/tsx-*` before every verification or mutant run and verify your own new test *names* appear in
the TAP output — the tsx transpile cache can serve a stale copy of an edited file and report a green
count for code that never ran.**

## 4. Round 21 candidates

**None.** Both Round 20 audit-proven holes are closed at HEAD; the reviewer's own out-of-tree
mutants confirmed every clause load-bearing (restore-invention single red, drop-restore double red,
drop-target double red plus the cross-delivery probe); the gate, crash probe, and kernel-reuse probe
are green on independent runs; no landing stale-ified a recorded surface beyond what rode inside the
landings themselves; and every residual either slot surfaced was judged and none is a behavioural
honesty hole at HEAD (dispositions in §5 and `loop4-r20-review.md` §4/§6).

Valid reasons to dispatch beyond this section (unchanged, each owing a fresh deterministic
out-of-tree proof at that HEAD, 3× identical transcripts of real repo code): a new seam lands; a
reproduced behavioural gap; gate or probe goes red on an independent run; a landing stale-ifies
recorded surfaces (then the alignment rides inside that landing). A zero-slot Round 21 is a valid,
recordable round.

## 5. Explicitly NOT for Round 21 landings

Everything in ROUND20-BRIEF §5, verbatim — including: re-litigating the R18-1 replay placement or
latch; a steer-ordering contract across retry boundaries; pinning the unreachable kernel-refusal
ordering in `steerText`; treating a ceiling-stopped unread steer as a defect; a run-level
`maxCostUsd` CLI flag; wiring `onCostGate` as a standalone slot; the `SteerChannel.settled()`
swallow; the `AsyncEventQueue` close race; flowchart-node spend ceilings / a cross-child run-spend
ledger; a `steer` CLI verb; the `/tmp` suite-root leak as a standalone slot (re-measured this round:
128 roots after the review's own gate + suite runs, same prefixes, removed at report time, posture
unchanged); a 12th crash-probe case; the cluster `onSpawn` hardcoded limits (killed with evidence,
audit §3 H1); re-running `security-probe` as a recurring chore (re-enters only when `dist/`-facing
code or the redaction pipeline changes); broadcasting steers or a per-run kernel registry — **plus,
new this round:**

- **The parent-run × root-run untargeted cross-delivery** (t2 residual R3): an embedder that hands
  one executor to both a parent run and root runs can still have the parent's untargeted steer land
  in a root run's sole live kernel. Judged not a defect at this HEAD: the parent passes no target
  **by sign-off** (whichever-child is the frozen disclosed semantics), its `STEER_INJECTED` names no
  instance (pinned by `ok 308`), and the root run writes nothing — no durable record goes false,
  which is the property R20-2 protects. Fixing it needs either the forbidden second registry or a
  parent-path candidate-set refusal; that is an explicit parent product decision, not a slot. Do not
  promote without a fresh proof that some durable record actually goes false.
- **A behavioural pin for the unblock-reopen's `taskCostCeilings` carriage as a test-only slot**
  (t1 residual 3): the seam has exactly the coverage parity `taskCriteria` has there (per-seam
  source tripwire; the reopen write is a mechanical conditional spread, read in the diff). No proven
  defect; owner-on-next-touch of the unblock seam picks it up behaviourally. A test-only slot with
  no reproduced hole is padding.
- **Editing `docs/kernel-reuse.md`** — the file-wide freeze is carried and now guards **three**
  recorded stale spots, not one: `:131-136` + `:213-214` (retry-steer document-and-drop, superseded
  by R18-1 for accepted steers — audit H5 record 1) and `:54` + `:72` (one-parameter `steerText`
  signature and sole-live description, superseded by R20-2 — t2 residual R2). They all wait on the
  same parent decision; a slot that edits this file without the parent explicitly lifting the freeze
  is out of bounds. `docs/reports/2026-08-24-kernel-reuse-audit.md:202` is a dated report and stays
  historical either way.
- **Treating the tsx transpile-cache hazard as a code slot** (t1 residual 2): it is a verification
  process hazard, now a §3 process requirement (clear `/tmp/tsx-*`, verify your own test names ran).
  Changing `scripts/run-tests.mjs` for it is not granted and not needed.
- **A `taskCostCeilings` legacy-recovery arm for never-dispatched children**: a checkpoint written
  before the field exists cannot prove a ceiling for a task the log never saw dispatched, and the
  spec now says so (`m0-m2-architecture.md`, the R20-1 fold-in). Synthesizing one would violate the
  never-synthesized freeze in §3. Disclosed cost, not a slot.
