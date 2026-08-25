[Model: claude-fable-5-thinking-xhigh]

# Loop 4 · Round 20 — SOTA review at `1d0ea6d`

Reviewer ran independently on this VM (Node v22.14.0, engines `>=22.19.0` warning only), on
`cursor/opt-r18-postmerge-42b1`, working tree clean at review start and at report time. HEAD
advanced from the dispatch's `9f8da8e` to `1d0ea6d` mid-dispatch; both are
`.agent_workspace/PROGRESS.md`-only (verified with `git show --name-status`), so the code tree under
review is exactly `1d9ef99`'s. Every verdict below is against the actual range `6cdcf8c..HEAD`: two
landings (`57ade59` R20-2, `1d9ef99` R20-1) plus two orchestrator commits (`9f8da8e`, `1d0ea6d`).
Commit chronology (UTC 2026-08-25): **`57ade59` 06:45:48 R20-2 → `1d9ef99` 06:58:21 R20-1** →
`9f8da8e` 06:59:50 → `1d0ea6d` 07:00:11 — R20-2 landed *before* R20-1, the reverse of slot numbering
(same inversion as Round 18); both slot reports disclosed the shared-working-tree overlap correctly
and their file sets are disjoint. The range's `src`/`test`/`docs`/`scripts` diff is exactly eleven
files (R20-2: `src/execution/contract.ts`, `src/pi-adapter/pi-executor.ts`, `src/run/coordinator.ts`,
`scripts/kernel-reuse-probe.mjs`, new `test/integration/pi-adapter/steer-target.test.ts`; R20-1:
`src/run/flowchart-run.ts`, `src/run/replay.ts`, `test/integration/m2.5/resume.test.ts`,
`docs/specs/m0-m2-architecture.md`, plus the parent-folded `docs/data-dictionary.md` and
`docs/status-matrix.md`), so everything else in those trees is diff-empty across the range —
verified explicitly (0 diff lines each) for `src/run/events.ts`, `src/pi-adapter/kernel.ts`,
`src/pi-adapter/cost-gate.ts`, `src/run/child-coordinator.ts`, `src/cli/main.ts`,
`src/protocol/v1.ts`, `src/domain/limits.ts`, `src/testing/fake-executor.ts`, `src/cli/commits.ts`,
`src/tracking/prescore.ts`, `scripts/crash-probe.mjs`, and `package.json`. No file outside
`.agent_workspace/` was changed by this review; all mutation runs happened in a full
`git archive HEAD` copy under `/tmp/r20-rev/tree` with `node_modules` symlinked, deleted afterwards
and verified gone. No scratch remains at report time; the 128 leaked `pi-sparkle-*` suite roots
under `/tmp` (the known frozen hygiene phenomenon — my own gate and suite runs contributed) were
removed as well, along with `/tmp/tsx-*` transpile caches and the gate/probe logs.

## 1. Scoreboard

| Slot | Verdict | One-line basis |
|---|---|---|
| R20-1 (`1d9ef99`) | **ACCEPT** | Direction (b) exactly per sign-off: ceiling-only `taskCostCeilings` checkpoint record (optional, absence stays an absent *key*, first-write-wins, never synthesized, no `FlowchartContinuation` counterpart), fail-closed validator parallel to `taskCriteria`, sibling arm stripped to the three coordinator-enforced fields, restore onto substituted specs only, `replay.ts:95-101` coda byte-identical (region 90-121 verified diff-empty); all five new pins green 3× plus the whole 27-test suite; reviewer's own two out-of-tree mutants each killed 2/2 — MA reproduces the audit's invention verbatim (sibling's `0.25` on all three records), MB reproduces the disappearance (`0.05` gone from all three) and additionally reddens the operator-pause pin, a stronger kill than the slot report recorded (§4.1, §5) |
| R20-2 (`57ade59`) | **ACCEPT** | The sign-off shape exactly: `steerText?(text, agentInstanceId?)` with the docstring's refusal semantics, `startRun` opens the channel with its root instance, `startParentRun` opens with none and says why, targeted miss throws inside the delivery call so nothing is written, untargeted refusal strings byte-identical, `deliver` extraction keeps record-after-accept single-sourced; `events.ts` 0 diff lines, no broadcast, no second registry, R18-1 replay mechanics byte-identical (the `pi-executor.ts` diff is confined to `steerText` + `deliver`); reviewer's own mutant killed 2/2 and its probe variant reproduces both audit dishonesties verbatim at HEAD (§4.2) |
| Parent | Landing hygiene clean: each landing = its slot files + its own `loop4-r20-tN.md` (+ the two terminator docs the parent folded into `1d9ef99`), zero PROGRESS ticks (verified per-commit); file sets disjoint; the parent's recorded gate and probe numbers match this review's independent runs exactly; both sign-offs ((b) restore; optional target) were executed without a new event type, schema break, or `RunStatus` contact — nothing to relitigate |
| Joints | Two, both judged clean. (1) `scripts/kernel-reuse-probe.mjs` one-character-class widening inside `57ade59`: verified landing-triggered — the old regex `steerText\s*\(\s*text\s*:\s*string\s*\)` no longer matches HEAD's source (this review tested both regexes against the file directly), so the documented manual claim-gate would have gone red at HEAD; the widened terminator `[,)]` still requires the exported class, the declaration, and the `.steerText(text)` kernel forward, and the probe runs 3 PASS exit 0 here. Landing-triggered claim-gate alignment riding inside the landing is exactly the census-terminator rule. (2) `docs/data-dictionary.md:158-165` + `docs/status-matrix.md:38` folded into `1d9ef99` by the parent: both carry the slot report's proposed clause ("…receives the earliest logged sibling's `maxAttempts`, `timeoutMs` and `maxWallTimeMs` (never its `maxCostUsd`)…; a declared ceiling comes back only from the durable `taskCostCeilings` record") and this review verified the clause against the shipped behaviour word-for-substance — the same staleness the granted spec fold-in fixed, terminator-compliant, in the landing commit rather than a separate one |

**2 ACCEPT, 0 ACCEPT-WITH-NITS, 0 ROLLBACK.** Zero red-tree commit points, structurally: the
landings share no files; at `57ade59` the tree was HEAD's minus R20-1's files (the pre-fix
`flowchart-run.ts`/`replay.ts`/22-test resume suite passed every suite that existed there — the
audit's gate at code tree `4412fac` proves it — and R20-2's own files are self-consistent: the
optional-parameter widening compiles against one-parameter implementations); at `1d9ef99` the tree
equals HEAD's code, which this review's gate proves green.

## 2. Independent verification (this VM)

- **`pnpm gate` GREEN, exit 0: 2050 tests / 2049 pass / 0 fail / 0 cancelled / 1 skipped, 120
  suites** — matches the parent's recorded numbers exactly. All four gate steps ran (typecheck,
  lint, test, build). Exactly one `# SKIP` line (`grep -c` = 1): `ok 301 - PiAgentExecutor completes
  a run against a real provider # SKIP` — the standing `PI_SMOKE` real-provider gate.
- **`node scripts/crash-probe.mjs` → exit 0, `ok: true`, 11 cases × 3 iterations** — full JSON
  parsed and compared name-by-name against the pinned record: all eleven names and their order
  unchanged (`jsonl-truncated-tail`, `checkpoint-old-then-next-write`, `stale-lock-no-steal`,
  `sigkill-run-lock-operator-recovery`, `feedback-cascade-strip-before-tombstone`,
  `feedback-rewrite-kill-before-rename`, `invocation-rewrite-kill-before-rename`,
  `episode-settle-stale-lock-recovery`, `atomic-write-stale-unique-temp`,
  `unblock-append-before-checkpoint-sigkill`, `unblock-discard-append-before-checkpoint-sigkill`
  last). **No 12th case**; `scripts/crash-probe.mjs` diff-empty across the range.
- **Test delta vs the Round 18 baseline 2042 (+8 tests, +0 suites) decomposed exactly:** R20-1 +5
  (gate TAP `ok 201` control, `ok 202` no-invention, `ok 203` cap-restored, `ok 204` operator-pause,
  `ok 205` fail-closed validation), R20-2 +3 (`ok 306` backoff-refusal-under-sharing, `ok 307`
  targeted-delivery, `ok 308` parent-passes-none). 2042 + 8 = 2050. ✓
- **`node scripts/kernel-reuse-probe.mjs`: 3 PASS, exit 0** — and the joint's claim verified
  directly: the pre-landing regex does not match HEAD's `pi-executor.ts` (`false`), the widened one
  does (`true`), and the `.steerText(text)` kernel-forward requirement still matches (the `deliver`
  body).
- **Owned suites re-run at HEAD by this review, 3× (timing-sensitive — blocked tools, retries,
  pause toggles):** `resume.test.ts` = **27/27 pass, three identical runs**;
  `steer-target.test.ts` + `steer-retry.test.ts` + `m0/steer.test.ts` + `steer-blocked-tool.test.ts`
  + `steer-inflight.test.ts` together = **15/15 pass, three identical runs** — the 12 pre-existing
  steer pins green untouched plus the 3 new. `/tmp/tsx-*` was cleared before these runs and the new
  test names verified present in the TAP output (t1's disclosed cache hazard, honored).
- **Both privacy guards green standalone: 11/11** — bidirectional proof the allowlists equal the
  real import graph. Consistent with the range's only import changes being type-only additions to
  existing core-domain edges (`AgentInstanceId` into `coordinator.ts`, `TaskCostCeiling` into
  `flowchart-run.ts`); no adaptation-plane edge touched.
- **Commit hygiene:** verified per-commit (§ header). `57ade59` = `contract.ts` + `pi-executor.ts` +
  `coordinator.ts` + `kernel-reuse-probe.mjs` + `steer-target.test.ts` (new) + `loop4-r20-t2.md`;
  `1d9ef99` = `flowchart-run.ts` + `replay.ts` + `resume.test.ts` + the spec doc + the two folded
  terminator docs + `loop4-r20-t1.md`; zero PROGRESS ticks in either.

## 3. Freeze check

Everything outside the eleven touched files is byte-identical to `6cdcf8c`, whose code tree the
Round 20 audit verified in full (its own gate, probe, and security-probe all green at that tree) —
so every frozen contract holds structurally. The requested spot-checks were still read directly at
HEAD:

- **ADR-006 Proposed** (`0006-pi-extension-reverse-adapter.md:5` read directly); `docs/decisions/`
  diff-empty.
- **`RunStatus` exactly eight members** (`domain/status.ts:1-12`, read directly).
- **`independentEvidence` exactly one `void`** (`prescore.ts:89`); only the `tracking/from-child.ts:228`
  writer plus `prescore.ts` mention it.
- **Thinking stays bytes-only outside `src/pi-adapter/**`:** whole-`src` sweep — the only non-adapter
  mentions are the `bytes: number` payload in `execution/contract.ts:30`, the
  `thinking delta (N bytes)` summaries in `coordinator.ts:405-406` and `child-coordinator.ts:771-778`,
  the `events.ts:362` docstring forbidding thinking-derived text in `STEER_INJECTED`, thinking-*level*
  configuration plumbing (`pi-compat`, `cli/main.ts`, `providers-config.ts` — settings, not content),
  and `learning/signals.ts:385` which *skips* thinking parts. R20-2's targeted delivery reads only
  caller-supplied steer strings.
- **Three cap-forward paths honest, absent stays absent:** `coordinator.ts:396` (root execution
  request) and `:726` (ChildCoordinator dep — both shifted a few lines by R20-2's comments, content
  unchanged), `supervisor.ts:384`, and `main.ts:444` (`parseChildSpec`) — all conditional spreads.
  R20-1 adds restore paths that write a ceiling only when the durable record carries one; no path
  invents a cap, and the sibling arm can no longer copy one.
- **Five doctor routes and `INSPECT_SUMMARY` four keys:** `main.ts` is 0 diff lines across the range;
  direct reads confirm exactly five `DOCTOR_ROUTED_NEXT` entries (`LOCK_TIMEOUT`,
  `RUN_RECORDS_SURVIVED`, `BANDIT_STATE_UNREADABLE`, `PREFERENCE_SNAPSHOT_UNREADABLE`,
  `CATALOG_OBSERVED_CORRUPT`) and the four frozen-additive keys (`type`, `runId`, `status`,
  `requiredEvidence`) in `run/inspection.ts:55-60` with the frozen-contract comment at `main.ts:1184`.
- **R18 contracts:** steer re-delivery across retries as shipped — the `pi-executor.ts` range diff is
  confined to the `steerText` method and the extracted `deliver`, so `runWithRetry`'s
  execution-scoped `acceptedSteers` open/close with identity guard, the per-attempt `[...steers]`
  snapshot, and `runAttempt`'s first-`TURN_FINISHED` latched replay are byte-identical; per-child cap
  carriage + parse-time refusal untouched (`main.ts` 0 diff); ceiling-beats-steer precedence
  untouched (`cost-gate.ts`, `kernel.ts` 0 diff).
- **No new event type, no fourth `RUN_UNBLOCKED` key, no 12th probe case, no dependency edits, no
  history rewrites, no live R1 on the execution path, no auto-promote** — structurally excluded by
  the eleven-file range diff (`events.ts`, `crash-probe.mjs`, `package.json` all 0 diff lines) plus
  the spot-reads above.
- **Each slot restored a frozen contract rather than moving one**, as ROUND20-BRIEF §3 required:
  R20-1 restores "an absent cap stays absent — never invent one" on the resume rebuild (and extends
  it: a declared cap survives); R20-2 restores "a steer during backoff stays a loud refusal" under a
  shared executor. Neither weakened any other frozen clause (verified per-file above).

## 4. Per-slot verification

### 4.1 R20-1 (`1d9ef99`) — restore declared per-child `maxCostUsd` across pause/resume, direction (b)

Everything the sign-off specified, verified at source, not from the report:

- **Ceiling only, recorded at accept time.** `plannedTaskCostCeilings` (`flowchart-run.ts:426-441`)
  seeds the record from the caller's child specs when the run accepts them, before anything
  dispatches — the exact `taskCriteria` seam. Duplicate task spellings resolve last-wins, matching
  `childTaskMap`, including a last spelling that declares nothing (drops the earlier ceiling rather
  than recording one that will not be dispatched). `declaredCeiling` applies the protocol's own
  positive-finite rule at the recorder, so an embedder-passed `0` (the in-process `ChildRunLimits`
  interface has no parse boundary) never reaches a durable record.
- **First-write-wins, absence stays unknown.** `advanceTaskCostCeilings` merges the existing record
  first, then only ceiling-carrying logged `TASK_REQUEST`s for tasks the record does not name; a
  logged request with *no* ceiling adds nothing (on the log, caller-declared-none and
  rebuild-substituted are indistinguishable — and with the sibling arm stripped, a substituted
  request can no longer carry an invented ceiling at all). The log-derived arm's real domain is
  recovering pre-field checkpoints for tasks the log has seen dispatched, as its docstring says. The
  advance sits *beside* `advanceTaskCriteria` in `persistCheckpoint`, so the frozen criteria writer
  is byte-identical.
- **The sibling arm no longer copies `maxCostUsd`.** `fallbackChildLimits` destructures exactly
  `maxAttempts`/`timeoutMs`/`maxWallTimeMs` from the earliest logged sibling; the no-sibling arms
  already built three fields. Absent stays absent in every arm.
- **Restore onto substituted specs only.** `withRecordedCostCeilings` returns a task verbatim when
  the log carries its `TASK_REQUEST` (that request's budget wins, per the untouched
  `childTasksFromLog` `request?.limits ?? substituted`), and writes only the ceiling onto a
  substituted spec the record names — the three substituted enforcement fields stay exactly what
  `fallbackChildLimits` chose. Chained onto `withRecordedCriteria` at the single rebuild call site.
- **No `FlowchartContinuation` field.** The resume path reads `checkpoint.flowchart.taskCostCeilings`
  only; the no-continuation clause is pinned by
  `assert.doesNotMatch(resumeRestorer, /continuation\.taskCostCeilings/)` in the per-seam tripwire
  test, alongside the existing `taskCriteria` clause.
- **All seven `taskCriteria` seams mirrored:** start seed, checkpoint advance + write, resume read +
  ctx, pause/inject restore (`restoreFlowchartSession`), unblock destructure, unblock reopen write —
  each verified in the diff and each covered by a source tripwire in the extended carriage test.
- **The validator fails closed and the coda stands.** `validateTaskCostCeilings` refuses empty
  arrays, non-arrays, bad task ids, out-of-order/duplicate entries (strict ascent settles both), and
  any non-positive-finite ceiling; wired beside `validateTaskCriteria`. The validator tail's spread
  refactor preserves the absent-key semantics (`"taskCostCeilings" in state` distinguishes unknown
  from recorded — pinned by the new validation test's final assert). The `replay.ts:95-101`
  laundering coda is **byte-identical**: this review diffed the whole 90-121 region against
  `6cdcf8c` directly — 0 lines.
- **Pins:** all 5 new tests green 3× in this review's runs (§2), inside the 27/27 suite. The control
  makes the pause the sole difference-maker (same arc, pause removed); the no-invention pin also
  asserts the *record* stays sibling-only after the resume's own writes; the operator-pause pin goes
  through the shipped `pause`/`resume --executor fake` CLI; the fail-closed pin uses the run's own
  bytes and nine malformed spellings refused by location. The pre-existing sibling-budget pin (now
  `resume.test.ts:769-774`) and the whole `taskCriteria` family stay green in the gate.
- **Reviewer's own mutants (out-of-tree copy `/tmp/r20-rev/tree`, control 30/30 green, deleted):**
  - **MA — restore the invention** (sibling arm back to `return sibling.value.limits;`): **killed
    2/2, single red** — `not ok 12 - a resume never hands a child that declared no ceiling its
    sibling's`, actual vs expected `+ request.maxCostUsd: 0.25, + childRunCreated: 0.25,
    + executionRequest: 0.25` (26 pass / 1 fail). The audit's invention reproduced verbatim at HEAD;
    matches the slot's mutant 1.
  - **MB — drop the restore** (`rebuilt = withRecordedCriteria(...)` only): **killed 2/2, double
    red** — `not ok 13 - a resume re-dispatches a never-started child under the ceiling its caller
    declared` (`maxCostUsd: 0.05` gone from the request, `childRunCreated`/`executionRequest`
    `undefined` — the audit's disappearance verbatim) **and** `not ok 14 - an operator pause between
    the legs does not strip the durable cost ceiling` (post-resume request ceiling `undefined` vs
    `0.05`), 25 pass / 2 fail. The slot report claimed a single red for this mutation (its "(25/1)"
    arithmetic was already internally inconsistent with a 27-test baseline); the true result is a
    *stronger* kill — the operator-pause pin reaches the same restore through the shipped CLI — but
    the transcript discrepancy is recorded in §5.
- **The doc joint is faithful.** `m0-m2-architecture.md:368-381` (the granted fold-in) now states the
  substitution carries the three fields and never a `maxCostUsd` from either source, that a
  caller-declared ceiling is restored from `FlowchartCheckpointState.taskCostCeilings`, and that a
  node neither source names resumes with no per-task ceiling — compared clause-by-clause against the
  shipped functions: no overclaim, and the legacy-checkpoint cost is the disclosed one. The
  parent-folded `data-dictionary.md:161-164` and `status-matrix.md:38` clauses carry the slot's
  proposed wording and the same substance (§1 Joints).
- **Residuals, judged (none is a Round 21 slot):**
  1. *Unblock-reopen carriage of the new field is source-pinned, not behaviour-pinned* — correct
     coverage parity: `taskCriteria` has exactly the same tripwire-only coverage at that seam, the
     reopen write is a mechanical conditional spread this review read in the diff, and constructing
     the behavioural case needs a blocked flowchart run with a capped never-dispatched child.
     Owner-on-next-touch of the unblock seam; disclosed, not claimed. Not a slot.
  2. *A legacy checkpoint (field absent) still loses a never-dispatched child's ceiling* — the same
     visible, disclosed cost the `taskCriteria` legacy arm has; the log-derived arm recovers only
     what a logged request can prove. Spec says so. Not a slot.
  3. *`persistCheckpoint` scans the log twice per write* — beside a `readAll` and a `replayRun`; no
     perf claim made, none owed.
  4. *The tsx transpile-cache hazard t1 disclosed* — real and honored by this review (cache cleared
     before every verification run, new test names verified present). A process rule for the brief,
     not a code slot (§6).

### 4.2 R20-2 (`57ade59`) — target steerText at the run whose handle accepted it

Exactly the sign-off's shape, verified at source rather than trusted:

- **The contract widening is minimal and honest.** `execution/contract.ts` changes only the optional
  member's signature and its docstring; the "silently goes nowhere is worse than a rejected one"
  sentence is kept verbatim and extended with the targeted-refusal semantics ("a steer that goes
  somewhere else is worse still"). One-parameter implementations stay assignable — censused:
  `GatedExecutor`, the test kernels, and `SparkleKernel` are unchanged, and their pins stay green.
- **The executor refuses a targeted miss before anything else can happen.** `steerText` validates
  blank text, then with a target does one `liveKernels.get`: miss ⇒
  `DomainValidationError("cannot steer: no agent run is in flight for ${agentInstanceId}")` — in the
  same message family, still matching the existing `/no agent run is in flight/` assertions; hit ⇒
  `deliver`, which is the verbatim record-after-accept body (`kernel.steerText(text)` then the
  `acceptedSteers` push under the *delivering* instance), now shared by both branches so the ordering
  cannot drift. The untargeted path and both its refusal strings are byte-identical. Blank text is
  validated before the target, consistent with the pre-existing pinned ordering (t2's R4, disclosed).
- **The coordinator threads the target without moving anything.** `SteerChannel` gains `target`;
  `open(record, agentInstanceId?)` sets it, `close()` clears it; `steer` calls
  `this.executor.steerText(text, this.target)` at the same point in the same order — delivery still
  strictly before `record(...)`, and a targeted miss throws inside the delivery call, so no write is
  even attempted (pin 15, "a steer refused by the kernel is not recorded as if the agent had
  received it", still holds). `startRun` opens with its root `agentInstanceId` — the same value its
  `STEER_INJECTED` payload names, which is what makes the record honest; `startParentRun` opens with
  none, with the reason written at the call site. One type-only `AgentInstanceId` import added.
- **No new event type, no R18-1 contact:** `src/run/events.ts` is 0 diff lines; the `pi-executor.ts`
  diff is confined to `steerText` + `deliver`, so the replay placement, once-per-attempt latch,
  execution-scoped log, and per-attempt snapshot are byte-identical; the parent-run `STEER_INJECTED`
  payload still carries no `agentInstanceId` (pinned by the new test 3: payload keys exactly
  `["text"]`, target seen by a recording executor exactly `[undefined]`).
- **The probe joint is what the slot said it is.** This review tested the old and new regexes against
  HEAD's source directly: the old one no longer matches (the documented manual gate would have gone
  red), the new one matches, the kernel-forward clause still matches, and the probe passes 3/3 here.
  One character class, landing-triggered, PASS recorded before and after by the slot. Keeping it in
  the landing was right; taking it red instead would have left a documented claim-gate false at HEAD.
- **Pins:** all 3 new integration pins green 3× alongside the 12 pre-existing steer pins (15/15 × 3,
  §2). Test 1 carries the frozen contract's in-proof control (unshared backoff refusal) *and* the
  regression (refusal with a sibling live), then proves no model call of either run carried the text
  and neither log records a steer. Test 2 is the positive half (the fix is not "refuse everything"):
  exactly one run-A call carries the text, zero of run B's, and A's `STEER_INJECTED` names A's own
  `AGENT_STARTED` instance. Test 3 pins the parent path's "passes none".
- **Reviewer's own mutant (same out-of-tree copy, deleted):**
  - **MC — the channel drops the target** (`this.executor.steerText(text)`): **killed 2/2** — test 1
    `Missing expected exception (DomainValidationError)` at the regression point (run A's steer was
    *accepted* during its backoff with B live), test 2 red on
    `cannot steer: 2 agent runs are in flight and steering has no target` (the untargeted sole-live
    rule cannot serve a two-live-run steer at all). Test 3 stays green. Matches the slot's M1.
  - **MC-probe — the same mutant with test 1's refusal assertions converted to probes so the
    delivery assertions speak: both audit dishonesties reproduced verbatim at HEAD, 2/2 identical**:
    `runA.steer was ACCEPTED while run A was in backoff`; run B's second model call carries
    `"RUN-A ONLY: stop the schema migration immediately."` (red on "run B must not be handed run A's
    instruction"); run A's log records `STEER_INJECTED` naming **A's own** `agentInstanceId` for text
    A's agent never saw; run B's log records nothing. The target restored at HEAD kills all of it.
- **Residuals, judged (none is a Round 21 slot):**
  1. *A parent run sharing an executor with a root run can still deliver untargeted cross-run* (t2's
     R3) — judged not a defect at this HEAD: the parent passes no target **by sign-off** (the
     whichever-child semantics are the frozen disclosed contract), its `STEER_INJECTED` names no
     instance (pinned), and the root run writes nothing — no durable record goes false, which is the
     property R20-2 exists to protect. The affected-transcript-without-own-log-record shape is the
     same one the disclosed child semantics already accept for the parent's own children. Fixing it
     needs either the forbidden second registry or a parent-path candidate-set refusal — an explicit
     parent decision, not a slot. Recorded in the brief §5.
  2. *The targeted branch validates blank text before the target* (t2's R4) — consistent with the
     pinned pre-existing ordering; a message-order preference, not a hole.
  3. *`deliver` reachable only from `steerText`* — verified; no new seam, no new state.
  4. *`docs/kernel-reuse.md` now stale in two more places* (`:54`, `:72` — one-parameter signature
     and sole-live description) — the file-wide freeze is carried and was honored by the slot; three
     stale spots now wait together on the parent re-judging that freeze (§6, brief §5).

## 5. Process notes

- **Landing hygiene:** both landings are slot-files-plus-report only (plus the two terminator docs
  the parent folded into `1d9ef99` and the claim-gate regex inside `57ade59`, both judged clean
  joints in §1), zero PROGRESS ticks, verified per-commit; file sets disjoint. R20-2 landed first
  (06:45:48) from a shared working tree that also carried R20-1's then-uncommitted edits; both
  reports censused the overlap and touched none of each other's files. The dispatch-order inversion
  cost nothing: no shared file, no red-tree commit point.
- **Slot-report accuracy:** t2 checks out claim-by-claim against source, git, and this review's
  re-runs — every mutant shape reproduced (M1's two messages exactly; the M1b/c cross-delivery
  transcript reproduced by this review's own MC-probe). t1 checks out on the code, the tests, the
  census, and mutant 1 — **one transcript inaccuracy found:** t1's mutant 2 ("drop the restore")
  claims a single red (`not ok 13`, "25/1"); this review's identical mutation reddens `not ok 13`
  *and* `not ok 14` (25 pass / 2 fail), 2/2 identical, because the operator-pause pin exercises the
  same restore through the shipped CLI. The slot's recorded arithmetic (25 pass + 1 fail against a
  27-test baseline) was already internally inconsistent, so this reads as a transcription slip, and
  the error direction is benign — the defect is owned by *two* pins, not one. It does not change any
  verdict-relevant fact (both mutants are killed; the restore is load-bearing), so R20-1 stays
  ACCEPT with this on the record. Both slots' `/tmp` proof copies verified gone.
- **HEAD moved during review:** `1d0ea6d` (record SOTA review dispatch, PROGRESS-only) landed after
  the dispatch message was written; code tree unaffected. The dispatch's git-status snapshot predated
  the parent's landing commits and showed R20-1's files uncommitted plus t1 untracked; the actual
  tree was clean from this review's first command onward.
- **Sign-off compliance:** (b) restore executed with a ceiling-only record, no continuation field,
  no `replay.ts:95-101` rewrite, sibling arm stripped, disappearance not accepted — all verified at
  source. Optional-target executed with no new event type, no broadcast, no second registry, parent
  path untargeted — all verified at source. Nothing to reopen.
- **tsx cache hazard honored:** every verification and mutant run in this review cleared `/tmp/tsx-*`
  first and checked its own test names in the TAP output, per t1's disclosure. Promoted to a §3
  process requirement in the brief.
- **Hygiene at report time:** `/tmp/r20-rev` (mutation copy) deleted and verified gone; the gate log,
  probe JSON, and tmux sessions removed; the 128 pre-existing/this-review leaked `pi-sparkle-*`
  suite roots and `/tmp/tsx-*` caches removed. Working tree clean; the only writes are this file and
  `ROUND21-BRIEF.md`.

## 6. Round 21 disposition

**Zero candidates.** The Round 20 audit swept the dispatched plane (I/O, races, protocol honesty,
DR) with every named hypothesis dispositioned and found exactly two holes; both are now closed at
HEAD with this review's own out-of-tree mutants confirming every load-bearing clause (invention,
disappearance, restore, target, targeted refusal). This review re-judged every residual either slot
surfaced — the parent-run × root-run untargeted sharing shape (no false record, by sign-off and by
pin), the unblock-reopen behavioural pin (coverage parity with `taskCriteria`, owner-on-next-touch),
the legacy-checkpoint ceiling loss (disclosed, spec'd), the blank-before-target message order, the
three-spots-stale `docs/kernel-reuse.md` (freeze carried, parent's to re-judge), and the tsx cache
hazard (a process rule, not a code slot) — and none is a behavioural honesty hole at HEAD. The range
added two tightly-scoped behaviours, both born pinned, each pin proven load-bearing by this review's
single- and double-red mutants, and the only recorded surfaces the landings stale-ified were aligned
inside the landings themselves (the spec fold-in, the two folded terminator docs, the probe regex).
The honest round is zero slots; `ROUND21-BRIEF.md` §4 records that and the standing valid reasons to
dispatch later.

## 7. Handoff

- Gate GREEN at `1d0ea6d` (code tree `1d9ef99`): **2050 / 2049 / 0 / 1 skipped** (`PI_SMOKE` only,
  exactly one `# SKIP`), 120 suites; crash-probe **11 × 3 `ok: true`**, names verified one-by-one,
  `unblock-discard-append-before-checkpoint-sigkill` last, no 12th case; kernel-reuse probe 3 PASS —
  all run independently on this VM, matching the parent's record exactly. Delta vs the 2042 Round 18
  baseline: +8, fully decomposed (R20-1 `ok 201`–`ok 205`, R20-2 `ok 306`–`ok 308`).
- **2 ACCEPT, 0 ACCEPT-WITH-NITS, 0 ROLLBACK.** Both audit-proven holes closed; two joints judged
  clean (probe regex claim-gate; parent-folded terminator docs); zero red-tree commit points; one
  benign slot-report mutant-count inaccuracy recorded (t1 mutant 2 is a double red, not single).
- `ROUND21-BRIEF.md` carries **zero** candidates with the valid-dispatch-reasons list, the
  Rounds 1–20 freeze carried forward, and the two new Round 20 contracts (the `taskCostCeilings`
  dispatch-fact record and ceiling-free substitution as shipped and pinned; targeted `steerText` with
  loud targeted refusal as shipped and pinned).
