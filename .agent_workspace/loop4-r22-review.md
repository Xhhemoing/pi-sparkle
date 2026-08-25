MODEL_SLUG: claude-fable-5-thinking-xhigh

# Loop 4 · Round 22 — SOTA review at `7c3f867`

Reviewer ran independently on this VM (Node v22.14.0, engines `>=22.19.0` warning only), on
`cursor/opt-r22-42b1`, working tree clean at review start and at report time. HEAD is `7c3f867`
(record parent gate GREEN), verified `.agent_workspace/PROGRESS.md`-only with
`git show --name-status`, so the code tree under review is exactly `21a470a`'s. Every verdict below
is against the actual range `63a4443..HEAD`: three landings (`13e375e` R22-1, `8f11e5c` R22-2,
`21a470a` R22-3) plus two orchestrator commits (`ab9c6dd` audit record, `7c3f867`). Commit
chronology (UTC 2026-08-25): `ab9c6dd` 08:33:28 → **`13e375e` 08:50:00 R22-1 → `8f11e5c` 08:50:00
R22-2 → `21a470a` 09:02:50 R22-3** → `7c3f867` 09:04:33 — history preserves the briefed landing
order (R22-1 and R22-2 committed the same second; t1 disclosed R22-2 editing the shared working
tree in parallel, and the file sets are disjoint, so the parallelism cost nothing). The range's
non-`.agent_workspace` diff is exactly the thirteen declared files (R22-1: `docs/kernel-reuse.md`,
`.agents/skills/pi-sparkle/references/kernel-reuse.md`; R22-2: `src/run/flowchart-run.ts`, new
`test/integration/m2.5/flowchart-run-cap.test.ts`, `docs/specs/m0-m2-architecture.md`,
`docs/data-dictionary.md`; R22-3: `src/cli/main.ts`, `src/pi-adapter/runtime.ts`,
`docs/status-matrix.md`, `test/integration/m1/cli-children.test.ts` [+129/−0, pure insertion],
new `test/unit/cli/cost-flag.test.ts`, `test/integration/cli/run-cost-cap.test.ts`,
`test/integration/pi-adapter/costgate-cli-warning.test.ts`), so everything else in those trees is
diff-empty across the range — verified explicitly (0 diff lines each) for `src/run/replay.ts`,
`src/run/child-coordinator.ts`, `src/run/coordinator.ts`, `src/run/events.ts`,
`src/pi-adapter/pi-executor.ts`, `src/pi-adapter/cost-gate.ts`, `src/pi-adapter/kernel.ts`,
`src/execution/contract.ts`, `src/domain/limits.ts`, `src/run/inspection.ts`,
`src/domain/status.ts`, `src/track/loop.ts`, `scripts/crash-probe.mjs`,
`scripts/kernel-reuse-probe.mjs`, `package.json`, and `docs/reports/2026-08-24-kernel-reuse-audit.md`
plus the whole `docs/decisions/` tree. No file outside `.agent_workspace/` was changed by this
review; all mutation runs happened in a full `git archive 21a470a` copy under `/tmp/r22-rev/tree`
with `node_modules` symlinked, deleted afterwards and verified gone. `/tmp/tsx-*` was cleared before
every verification and mutant run; the 128 leaked `pi-sparkle-*` suite roots (the known frozen
hygiene phenomenon — my own gate and suite runs contributed) were removed at report time, along
with the gate/probe logs, the mutant TAP files, and this review's own `r22-gate` tmux session.

## 1. Scoreboard

| Slot | Verdict | One-line basis |
|---|---|---|
| R22-1 (`13e375e`) | **ACCEPT** | The truth-up executed exactly under the lifted freeze and nothing else: all five doc hunks + two skill hunks match the grant clause-by-clause (two-parameter targeted `steerText`, targeted-miss refusal before any write, `startRun` targeted / `startParentRun` untargeted, per-attempt re-delivery of contract-accepted steers with kernel-queued text still honestly lost); every audit P1 claim string re-grepped gone as current semantics at HEAD, with the one surviving one-parameter literal (`:76`, Round 2 journal) machine-verified annotated by its superseded pointer — required by the brief's own "no rewrite / byte-identical journal prose" rule and satisfying the guard's "as unqualified current semantics" qualifier; every frozen block byte-verified (cost-stop bullet, no-CLI-verb paragraph, facade-only row, spend-ceiling row, the dated report whole-file); nothing pre-describes R22-2/R22-3; the cited "Verified by" suites exist and ran green in this review's gate; probe 3 PASS (greps `src/` only) (§4.1) |
| R22-2 (`8f11e5c`) | **ACCEPT** | Mirrors `startParentRun` exactly per sign-off 3: `FlowchartRunInput.maxCostUsd` (not on `FlowchartRunLimits` — interface re-read, five members, byte-unchanged; `resolveLimits` untouched), pre-lock fail-closed refusal, conditional `RUN_CREATED.limits` stamp (absent stays an absent key), `attachChildRuntime` carriage at both call sites (start reads `run.limits`, resume reads `replayed.run.limits` — durable-record restore, never `input`), no `FlowchartContinuation` counterpart; all five must-NOTs verified in the diff (`TASK_REQUEST.limits`, `taskCostCeilings`, `fallbackChildLimits`/`withRecordedCostCeilings`, `remainingCostUsd`, `costCapFor` — the latter four in files with 0 diff lines); the audit P2 defect shape inverted and the part-B absence shape kept as the control; reviewer's own five mutants each killed 2/2, including the placement pin (MD reddens on `'runtime'` vs `[]`) and a quintuple-red leak pin (ML) (§4.2) |
| R22-3 (`21a470a`) | **ACCEPT** | Sign-offs 2+4 exactly: `parseRunCostCeiling` plain-decimal discipline with the frozen message; plain path spreads `{...defaultRunLimits(), maxCostUsd}` only when asked (`startRun` uses `input.limits ?? defaultRunLimits()`, so the spread cannot drift and the no-flag call is byte-identical to before); `--children` forwards R22-2's field; loud parse-args refusal on `--flowchart`/`--track` with both frozen strings; resume gains no flag (and a plain m0 run is refused by `requireDurableFlowchartCheckpoint` anyway — no re-arming path exists); `onCostGate` threaded factory→CLI on the pi arm only, all four executor builds handing the stderr sink; `formatCostGateWarning` exhaustive with both disarmed wordings byte-pinned twice (unit + end-to-end loopback) and `stopped`/`no-cap` printing nothing; USAGE carries the no-cross-child-ledger disclosure; reviewer's own seven mutants each killed 2/2 — the invention mutant (MG) is caught by *both* absent controls, the on-disk record and the loopback silence (§4.3) |
| Parent | Landing hygiene clean: each landing = its slot files + its own `loop4-r22-tN.md`, zero PROGRESS ticks (verified per-commit); file sets disjoint; landing order preserved in history; the parent's recorded gate (2070/2069/1/120), crash-probe (11×3 `ok: true`), and kernel-reuse (3 PASS) numbers match this review's independent runs exactly; all four sign-offs executed inside their grants and the fifth (steer verb) correctly deferred to §5 |
| Joints | Three, all judged clean. (1) R22-2's `docs/data-dictionary.md` conditional fired and the alignment rode inside the landing — the old "a declared ceiling comes back only from the durable `taskCostCeilings` record" would have been false against test 5's behaviour; the narrowed "per-task" plus the named run-level source verified word-for-substance against the shipped restore. (2) R22-3's status-matrix row 38 states the same distinction in its own owned file — the two clauses are substance-identical and both true at HEAD; census-terminator-compliant, no cross-ownership edit. (3) R22-3's USAGE reflow of the adjacent pre-existing `--children runs the parent as a coordinator…` sentence — within its owned file, and `rg` confirms no test or doc pins that string outside `main.ts` |

**3 ACCEPT, 0 ACCEPT-WITH-NITS, 0 ROLLBACK.** Zero red-tree commit points, structurally: at
`13e375e` the code tree equals `63a4443`'s (docs-only landing; that tree's gate is the audit's
recorded GREEN); at `8f11e5c` the tree adds only R22-2's files (its own insurance gate recorded
2055/2054 GREEN there); at `21a470a` the tree equals HEAD's code, which this review's gate proves
green.

## 2. Independent verification (this VM)

- **`pnpm gate` GREEN, exit 0: 2070 tests / 2069 pass / 0 fail / 0 cancelled / 1 skipped, 120
  suites** — matches the parent's recorded numbers exactly. All four gate steps ran (typecheck,
  lint, test, build). Exactly one `# SKIP` line (`grep -c` = 1): `ok 315 - PiAgentExecutor completes
  a run against a real provider # SKIP` — the standing `PI_SMOKE` real-provider gate.
- **`node scripts/crash-probe.mjs` → exit 0, `ok: true`, 11 cases × 3 iterations** — full JSON
  parsed, names and order verified one-by-one against the pinned record (`jsonl-truncated-tail`
  first … `unblock-discard-append-before-checkpoint-sigkill` last), per-case iteration counts all 3.
  **No 12th case**; `scripts/crash-probe.mjs` diff-empty across the range.
- **Test delta vs the Round 20 baseline 2050 (+20 tests, +0 suites) decomposed exactly:** R22-2 +5
  (gate TAP `ok 186`–`ok 190`), R22-3 +15 — 6 unit (`ok 413`–`ok 418`), 5 run-cost-cap
  (`ok 108`–`ok 112`), 2 cli-children (`ok 167`–`ok 168`), 2 costgate-cli-warning
  (`ok 305`–`ok 306`). 2050 + 5 + 15 = 2070. ✓ (This corrects t3's recorded "+4/+11 = 2065"; §5.)
- **`node scripts/kernel-reuse-probe.mjs`: 3 PASS, exit 0** — unaffected by R22-1 as predicted (the
  probe greps `src/` only, and `src/` steer surfaces are 0 diff lines this range).
- **Owned suites re-run at HEAD by this review, 3× (timing-sensitive — pause toggles, loopback
  provider):** the five owned suites together (`flowchart-run-cap`, `cost-flag`, `run-cost-cap`,
  `cli-children`, `costgate-cli-warning`) = **30/30 pass, three identical name sets**, `/tmp/tsx-*`
  cleared before each run and the new test names verified present in the TAP output.
- **R22-1 regression greps re-run at HEAD (the audit P1 transcript inverted):**
  `went to document-and-drop`, `do not survive a retried attempt`, `do not survive a retry`,
  `targets the single in-flight kernel`, `refuses when zero or several runs are live`, and the
  skill's `zero or several agents are in flight, otherwise forwards` — **all exit 1 (no match)**
  across `docs/` and `.agents/`. The one remaining `steerText?(text)` literal is
  `docs/kernel-reuse.md:76` (dated Round 2 journal) and the multiline PCRE guard
  (`steerText\?\(text\)` not followed within 400 chars by `Superseded`) finds **no unannotated
  occurrence** — t1's property check reproduced independently. The five steer tests the new
  "Verified by" cells cite all ran green in this review's gate (`ok 318`–`ok 322`).
- **Commit hygiene:** verified per-commit. `13e375e` = the two kernel-reuse docs + t1; `8f11e5c` =
  `flowchart-run.ts` + the new m2.5 suite + the spec + data-dictionary + t2; `21a470a` = `main.ts` +
  `runtime.ts` + status-matrix + the three new suites + the extended cli-children + t3; zero
  PROGRESS ticks in any landing.

## 3. Freeze check

Everything outside the thirteen touched files is byte-identical to `63a4443`, whose code tree the
Round 22 audit verified in full (its own gate, crash probe, and kernel-reuse probe green at that
tree) — so every frozen contract holds structurally. The dispatch's named spot-checks were still
read directly at HEAD:

- **`remainingCostUsd` a separate plane:** it lives on `FlowchartRunLimits`
  (`flowchart-supervisor.ts:124-130`, 0 diff lines) and `resolveLimits` still carries it untouched;
  the range's only `remainingCostUsd` mentions in `src/` diff are R22-2's doc comment *explaining
  why the new field is deliberately not there*. No unification, no touch.
- **No `FlowchartRunLimits.maxCostUsd`:** the interface re-read at HEAD has exactly its five
  shipped members; `validateFlowchartRunLimits` and `resolveLimits` byte-unchanged.
- **CostGate arithmetic and the `CostGateEvent` union as shipped:** `cost-gate.ts` and
  `pi-executor.ts` both 0 diff lines — `costCapFor`'s `Math.min`, the two-variant union, and the
  three disarm reasons are exactly the pre-round bytes.
- **No new `ExecutionEvent`, no durable cost-gate record:** `execution/contract.ts` and
  `run/events.ts` both 0 diff lines; the disarmed warning is stderr-only, pinned so by the loopback
  test (exactly one line, run exits by its own outcome).
- **`INSPECT_SUMMARY` four keys:** `run/inspection.ts` 0 diff; direct read confirms
  `type`/`runId`/`status`/`requiredEvidence` and the frozen-additive comment intact at
  `main.ts:1288` (shifted by R22-3's insertions, content unchanged).
- **`onRunStarted` on all three public run paths:** direct read at `main.ts:902`, `:1002`, `:1091`
  (the pre-round `:813`/`:912`/`:1001`, shifted, content unchanged).
- **Five doctor routes character-exact:** `DOCTOR_ROUTED_NEXT` re-read at `main.ts:2177` — exactly
  `LOCK_TIMEOUT`, `RUN_RECORDS_SURVIVED`, `BANDIT_STATE_UNREADABLE`,
  `PREFERENCE_SNAPSHOT_UNREADABLE`, `CATALOG_OBSERVED_CORRUPT`.
- **ADR-006 Proposed** (`0006-pi-extension-reverse-adapter.md` read directly; `docs/decisions/`
  diff-empty). **No live R1 / bandit / topology on the execution path:** the only execution-path
  file touched is `main.ts` and its full diff is the cost flag + `onCostGate` thread, read in
  entirety above. **`RunStatus` exactly eight members**, **`independentEvidence` exactly one
  `void`** (`prescore.ts:89`), **cluster `onSpawn` hardcoded limits** (`coordinator.ts` and
  `flowchart-run.ts` both still `{ maxAttempts: 1, timeoutMs: 60_000, maxWallTimeMs: 3_600_000 }`)
  — all read directly.
- **R18/R20 contracts:** steer re-delivery, targeted `steerText`, ceiling-beats-steer, per-child cap
  carriage + parse-time refusal, `taskCostCeilings` record, ceiling-free substitution — all in files
  with 0 diff lines this range (`pi-executor.ts`, `coordinator.ts`, `child-coordinator.ts`,
  `replay.ts`; `flowchart-run.ts`'s diff read hunk-by-hunk and touches none of the R20-1 machinery:
  `plannedTaskCostCeilings`/`advanceTaskCostCeilings`/`declaredCeiling`/`withRecordedCostCeilings`
  appear only as context). The R18-2 pins in `cli-children.test.ts` are untouched (+129/−0).
- **R22-1's frozen doc surfaces:** cost-stop-outranks-steer bullet, the "No CLI verb for live steer
  exists yet" paragraph (byte-identical with context — it only shifted from `:58-63` to `:62-67`
  under the four-line header addition), facade-only row, spend-ceiling row, the skill's cost-stop
  drop path, and `docs/reports/2026-08-24-kernel-reuse-audit.md` (whole file 0 diff) — all
  byte-verified against `63a4443`.
- **Absent stays absent, everywhere:** every new cap-forward is a conditional spread (six of them,
  all read in the diff), the restore reads only the replayed `RUN_CREATED.limits`, and both
  invention mutants (MC library, MG CLI) die on absent-key controls (§4).

## 4. Per-slot verification

### 4.1 R22-1 (`13e375e`) — kernel-reuse truth-up

Verified at source, not from the report: the wired-today steering row now states the shipped
two-parameter contract with targeted/untargeted channel opening and the pre-write targeted-miss
refusal, and its "Verified by" cell gains the two suites that actually pin those behaviours (names
cross-checked against the real test files); the "Retry resets the agent" bullet now splits
kernel-held state (still lost, honestly) from contract-accepted steers (re-delivered at each retry
attempt's first `TURN_FINISHED`, latched once per attempt, execution-scoped — checked against
`pi-executor.ts:572-583`/`640-690`, 0 diff this range); the worked example fills in the superseded
decision with dates and SHAs; the two dated journal bullets carry bracketed pointers with prose
otherwise untouched (the diff shows pure insertion after byte-identical lines); the skill reference
matches in lockstep and keeps the required non-survival facts. The status header's date refresh is
scoped to `:3` and the "verified 2026-08-24" section heading deliberately stays — t1's disclosed
honest split (bumping it would claim a full-table re-verification that did not happen), which this
review endorses. The one deliberate residue — the `:76` one-parameter literal inside the Round 2
journal — is exactly what the brief's "no rewrite" rule requires, and the machine check that no
occurrence exists without a superseded pointer was reproduced here. Nothing in the diff mentions
`--max-cost-usd`, the flowchart cap, or `onCostGate` wiring: no pre-description of then-unlanded
work. No runtime, no tests, so no mutants owed or possible; the regression guard (census terminator
+ inverted P1 greps + probe) all verified in §2.

### 4.2 R22-2 (`8f11e5c`) — flowchart run-level cap carriage

Every clause verified in the diff and at source (§1 basis). Beyond that, the M4-equivalence argument
in t2 was checked and is sound: an own `maxCostUsd: undefined` key on the in-memory record is
unobservable because the record's only exits are `JSON.stringify` (omits undefined own keys) and the
`!== undefined` handoff test — no observer exists, so the survivor is equivalent, and t2's M4a/M4b
made the same defect class observable and killed it. Reviewer's own mutants (out-of-tree copy,
baseline 30/30 green, each run 2× with identical reds, copy deleted):

- **MA — start call site drops the cap** (delete the `attachChildRuntime` spread at the start
  site): **killed 2/2, triple red** — flowchart-run-cap tests 1 and 2 *plus* the CLI-level
  `run --children --max-cost-usd caps a cap-free child` pin. The audit P2 defect reproduced
  verbatim, and the kill is one pin wider than t2's recorded M1 because this review ran the
  cli-children suite alongside — the CLI plane owns the same clause independently.
- **MB — resume call site drops the restore:** killed 2/2, single red — test 5 (the substituted
  child's request loses the 0.5).
- **MC — the stamp invents `input.maxCostUsd ?? 1`:** killed 2/2, single red — test 3's absent-key
  control (`Object.hasOwn(limits, "maxCostUsd") === false`). Matches t2's M4a.
- **MD — the pre-lock validation moved after the lock** (t2's M6 shape, independently rebuilt):
  killed 2/2 — test 4 reds specifically on `a refused start leaves the state root untouched`,
  actual `'runtime'` vs expected `[]`. The refusal's *placement* is pinned, not merely the throw.
- **ML — the run-level cap leaked into `buildTaskRequest`'s `limits`** (mutated in the out-of-tree
  copy's `child-coordinator.ts`, which the landing may not and did not touch): **killed 2/2,
  quintuple red** — flowchart-run-cap tests 1, 2, 5 *and* both new cli-children tests. The
  "coordinator state, never a per-task declaration" clause is owned by five pins across two planes.

### 4.3 R22-3 (`21a470a`) — CLI `--max-cost-usd` + `onCostGate` stderr

Every clause verified in the diff and at source (§1 basis). Two structural facts this review
confirmed beyond the report: `startRun` defaults via `input.limits ?? defaultRunLimits()`
(`coordinator.ts:324`), so the CLI's explicit-defaults spread is definitionally drift-free; and the
resume surface is fully closed — `resume` requires a durable flowchart checkpoint or `--supervised`,
supervised runs cannot be started with the flag, and the flowchart arm restores only through R22-2's
replayed-record path (pinned by its test 5 and my MB). Reviewer's own mutants (same copy, each 2×):

- **ME — spelling discipline dropped (`Number(raw)`):** killed 2/2 — the unit refuse table and the
  CLI refusal test both red (`1e4`, `0x10`, ` 5 ` accepted by the mutant).
- **MF — plain path drops the cap:** killed 2/2, double red — the on-disk `RUN_CREATED` test and
  the loopback warning test (no cap requested ⇒ no disarm ⇒ the byte-pinned stderr line never
  appears).
- **MG — plain path invents `maxCostUsd ?? 1` when no flag was given:** killed 2/2, double red —
  the absent-key disk control *and* the loopback `stays silent` control (the invented cap makes the
  unpriced model warn on a run that asked for nothing). The two controls independently own the
  honesty clause from both observation points.
- **MH — `createExecutor` stops forwarding `onCostGate`:** killed 2/2 — the end-to-end loopback
  warning test (empty stderr).
- **MI — the unpriced-model wording softened by two words:** killed 2/2, double red — the unit
  byte-pin and the loopback stderr byte-compare. The frozen wording is pinned at both ends of the
  thread.
- **MJ — `--children` forwarding dropped:** killed 2/2 — the cap-free-spec children test (child
  `RUN_CREATED` and the flowchart record both lose the 0.5). The tighter-of test survives this
  mutant by design (a declared 0.1 under a dropped run cap is still 0.1), which is why the cap-free
  arm exists.
- **MK — the `--flowchart`/`--track` refusal deleted:** killed 2/2 — the refusal test reds on
  `stage: 'execute'` vs the pinned `'parse-args'`: with the guard gone the flag is silently carried
  into a plane that ignores it, which is exactly the dishonesty the frozen refusal exists to
  prevent, made visible by the pin.

Residuals, judged (none is a Round 23 slot): (1) *`--max-cost-usd` forwarding on `--track` /
`--flowchart`* — the loud refusal is the honest boundary at HEAD; forwarding crosses
`startTrackedRun`'s input or the thin-path enforcement surface, both outside the granted sign-offs;
stays §5 pending a fresh parent grant. (2) *`README.md:159`'s parenthetical run-flag list omits the
new flag* — it was already a seven-flag-incomplete illustrative list, claims no exhaustiveness, and
so records nothing false; owner-on-next-touch of `README.md`. (3) *`reportCostGate` defined twice*
(runCommand/resumeCommand) — matches the existing `invocationSink` pattern; style, not a seam.
(4) *Node's `parseArgs` pre-empts bare dash-leading values with its own "argument is ambiguous"
refusal* — inherited by every string option, still a loud exit-1 that writes nothing, documented in
the refusal test in place. (5) *The fake-children executor ignores the cap* — the disclosed,
pinned recorded-not-fake-enforced posture, now also stated in the status matrix row 34.

## 5. Process notes

- **Landing hygiene:** all three landings are slot-files-plus-report only, zero PROGRESS ticks,
  verified per-commit; file sets disjoint; the dispatch order R22-1 → R22-2 → R22-3 is preserved in
  history even though t1 disclosed R22-2 working the shared tree in parallel — the disclosed overlap
  cost nothing (no shared file, no red-tree commit point, and t1's "stage nothing else on my behalf"
  instruction was honored by the parent's per-slot commits).
- **Slot-report accuracy:** t1 checks out claim-by-claim — including its §4 byte-identity
  machine-checks, which this review reproduced independently (frozen blocks, journal-prose property,
  the annotated-literal guard). t2 checks out on the code, the tests, the census, the mutant table,
  and the M4-equivalence argument; its insurance gate (2055/2054 at its tree) is arithmetically
  consistent with both endpoints. t3 checks out on the code, the tests, and all twelve of its
  mutants (this review's seven overlap and confirm the load-bearing subset), **but carries two
  benign counting inaccuracies:** it says "Eleven new test names" where the suite math in its own §3
  is 6+5+2+2 = **15**, and its recorded full-suite run ("2065 tests … R22-2 added 4 and this slot
  adds 11") does not match the final tree — the true decomposition is +5 (R22-2) and +15 (R22-3) to
  **2070**, which the parent's gate and this review's gate both measured independently at
  `21a470a`. The likely cause is a full-suite run taken before the last owned suite was finished;
  the error direction is benign (the real coverage is larger than claimed) and no verdict-relevant
  fact depends on t3's arithmetic, so R22-3 stays ACCEPT with this on the record — same class and
  disposition as Round 20's t1 mutant-count slip.
- **Sign-off compliance:** freeze-lift used for the truth-up only and nothing else (the two doc
  files are R22-1's whole diff); sign-off 3 executed with no `FlowchartRunLimits` field, no
  continuation input, no `remainingCostUsd` contact; sign-offs 2+4 executed with no
  `pi-executor.ts`/`cost-gate.ts`/`contract.ts` edits, no new event type, and the disarmed-only
  stderr posture; sign-off 5 (steer verb) correctly not attempted — no false durable record
  appeared this round, so it stays §5 per the dispatch.
- **tsx cache hazard honored:** every verification and mutant run in this review cleared
  `/tmp/tsx-*` first and checked the relevant test names in TAP output.
- **Hygiene at report time:** `/tmp/r22-rev` (mutation copy) deleted and verified gone; gate log,
  crash JSON, owned-suite TAPs, and mutant TAPs removed; this review's `r22-gate` tmux session
  killed (older sessions `r8-gate`…`r20-2-verify` predate this review and were left for the parent);
  the 128 leaked `pi-sparkle-*` suite roots removed. Working tree clean; the only writes are this
  file and `ROUND23-BRIEF.md`.

## 6. Round 23 disposition

**Zero candidates.** The Round 22 audit opened on parent sign-offs, not a reproduced regression, and
all three granted seams are now closed at HEAD with every load-bearing clause re-proven by this
review's own out-of-tree mutants (handoff at both call sites, durable stamp, pre-lock placement,
per-task/coordinator-state separation across two planes, spelling discipline, both absent-stays-
absent directions from two observation points, the sink thread end-to-end, both frozen wordings at
both ends, the refusal placement). The honest cost plane the audit described is whole: an operator
can declare a run-level ceiling from the CLI on both granted paths, the flowchart plane carries and
restores it from its durable record only, and a ceiling the gate cannot arm says so on stderr in a
frozen sentence. This review re-judged every residual any slot surfaced (§4.3 list; t2's unfrozen
library refusal message is promoted to a §3 freeze in the new brief per its own suggestion) and none
is a behavioural honesty hole or an ungrated capability seam at HEAD. The docs the landings could
have stale-ified were aligned inside the landings themselves (the data-dictionary conditional, the
spec bullet, the three status-matrix rows), verified word-for-substance here. The honest round is
zero slots; `ROUND23-BRIEF.md` §4 records that and the standing valid reasons to dispatch later.

## 7. Handoff

- Gate GREEN at `7c3f867` (code tree `21a470a`): **2070 / 2069 / 0 / 1 skipped** (`PI_SMOKE` only,
  exactly one `# SKIP`), 120 suites; crash-probe **11 × 3 `ok: true`**, names and order verified
  one-by-one, `unblock-discard-append-before-checkpoint-sigkill` last, no 12th case; kernel-reuse
  probe 3 PASS — all run independently on this VM, matching the parent's record exactly. Delta vs
  the 2050 Round 20 baseline: +20, fully decomposed (R22-2 `ok 186`–`ok 190`; R22-3 `ok 108`–`ok
  112`, `ok 167`–`ok 168`, `ok 305`–`ok 306`, `ok 413`–`ok 418`).
- **3 ACCEPT, 0 ACCEPT-WITH-NITS, 0 ROLLBACK.** All three granted seams closed; three joints judged
  clean (the fired data-dictionary conditional; the substance-matched row-38 clause; the unpinned
  USAGE reflow); zero red-tree commit points; two benign counting inaccuracies in t3 recorded (15
  new tests, not 11; final-tree suite total 2070, not 2065).
- `ROUND23-BRIEF.md` carries **zero** candidates with the valid-dispatch-reasons list, the
  Rounds 1–22 freeze carried forward, the `docs/kernel-reuse.md` file-wide freeze **re-closed**
  behind R22-1, and the new Round 22 contracts (the flowchart run-level cap carriage as shipped;
  the CLI cost flag + disarmed-warning surfaces as shipped, wordings byte-frozen; the library
  refusal message newly frozen per t2's request).
