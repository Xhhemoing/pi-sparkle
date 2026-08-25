# Loop 4 · Round 11 · R11-3 — tracked-run pause controller

Status: **LANDED (src wiring + arc), with one leg reported rather than faked.**
The mandated `src` change is in and the tracked pause arc now exists and is
proven end to end with the CLI driving. The one part of the mandate I did not
deliver is a *pure-CLI* mid-run pause: it is structurally unreachable offline
for reasons that are not about my seam design, and §3 shows the source. Per the
parent's "stop and report" clause I designed the alternatives, declined them
with reasons, and pinned the CLI half at its call site instead of racing it.

## 1. Census (working tree, `agent/opt-continuous`, HEAD `ad9e785`)

Every path the brief handed me exists:

| Path | Exists | Role |
|---|---|---|
| `src/track/loop.ts` | yes | `TrackRunInput` at :43, `startTrackedRun`'s `startFlowchartRun` call at :157-175 |
| `src/cli/main.ts` | yes | `startTrackedRun({…})` at :863 |
| `test/integration/m2.5/resume.test.ts` | yes | 16 tests at start |
| `test/integration/m2.5/cli-contract-honesty.test.ts` | yes | 1 test at start |

R10-4's STOP re-verified in source before touching anything: `startTrackedRun`
passed no `pause` into `startFlowchartRun` (zero `pause` matches in
`track/loop.ts`), `pauseIfRequested` returns immediately on
`ctx.pause === undefined` (`flowchart-run.ts:849`), and the loop context takes
the dep only when `deps.pause` exists (`flowchart-run.ts:1198`, `:1390`,
`:1515`).

Consumer census (every test that reads `src/cli/main.ts` or `src/track/loop.ts`
as source, or drives `runCommand`): `blocked-next`, `doctor-routed-next-freeze`,
`invocation-log`, `invocation-sink-wiring`, `live-isolation`,
`clarification-lifecycle-lock`, `undelivered-mail`, `cli.test.ts`,
`r1-shadow-report`, `simulation-holdout`, `episode-contract-boundary`,
`track-loop`, `inspection`, `loopback-cli-resume`. All run, all green (§5).
None needed an update: my `main.ts` edit adds no `createExecutor` call (the
`invocation-log` census counts exactly two) and no `flowchartExitCode` return
(the `blocked-next` census counts exactly two).

Working tree censused at **2026-08-25T00:07:38Z**: R11-1 (`protocol/v1.ts`,
`tracking/**`, `pi-adapter/pi-executor.ts`, `run/replay.ts`) and R11-4
(`run/flowchart-run.ts`) are both mid-flight in the shared tree. See §6.1 — one
of their edits lands red inside a file I own.

## 2. Landed

### `src` (the mandate, +20/−1 total)

- `src/track/loop.ts`: `TrackRunInput.pause?: PauseController` (type-only import
  from `../run/pause-controller.js`), forwarded into the `startFlowchartRun`
  deps as `...(input.pause !== undefined ? { pause: input.pause } : {})`. The
  docstring states why absence is not a harmless default: without a controller
  `pauseIfRequested` returns immediately, so a tracked run's `pause.json` is
  written and never read.
- `src/cli/main.ts`: `runCommand`'s `startTrackedRun({…})` gains
  `pause: createFilePauseController(stateRoot)` — the same controller the
  `--flowchart`, `--children`, `pause`, `resume` and `inject` paths already
  build, at the same call shape. No new import (`main.ts:85` already had it).

Nothing else in either file changed. No new fs primitive, no new lock, no
`package.json`, no ADR line.

### Tests (+4; `resume.test.ts` 16 → 19, `cli-contract-honesty.test.ts` 1 → 2)

**`resume.test.ts`**

1. *"a tracked run observes a pause request only once its input carries a
   controller"* — R10-4's finding kept as the falsifiable control. Same
   objective, same `PassingExecutor`, same flipped flag, differing only in
   whether the input carries a controller: **without** it the tracked loop runs
   the whole plan to `COMPLETED` (5 children); **with** it the run is `PAUSED`
   after exactly one child. This is the pin that fails if `startTrackedRun`
   ever stops forwarding, and it fails *behaviourally*, not by source regex.
2. *"a tracked run's own extracted contract survives a CLI pause and a CLI
   resume"* — the arc. `startTrackedRun` (+ `TogglePause` + hooked executor)
   → `PAUSED`; the checkpointed contract's constraints are `["c-smallest",
   "c-tests"]`, **extracted by the tracked path from the objective — no test
   authors it and no CLI flag accepts one**; then `main(["pause", …])` → 0 and
   the contract is byte-equal after the pause's checkpoint rewrite; then
   `main(["resume", "--run", …, "--executor", "fake", "--unpause"])` → 0 and
   `COMPLETED`; then every assessed turn carries `constraint-retention: PASS`,
   with the turns only the resume could have produced identified **by name**
   (set difference against the paused leg's executed task ids) rather than by
   count; then the stored contract round-trips one final time.
3. *"runCommand hands the tracked run the file pause controller"* — the source
   pin for the leg §3 shows is unreachable behaviourally: the `startTrackedRun`
   call site carries `pause: createFilePauseController(stateRoot)`,
   `TrackRunInput` declares `pause?: PauseController`, and `startTrackedRun`
   carries the exact forwarding spread. Its docstring states *why* it is a
   source pin and not a behavioural one, so nobody later mistakes it for
   laziness.

Zero `startFlowchartRun` calls in any of the three.

**`cli-contract-honesty.test.ts`**

4. *"the contract --track extracts is the one its children are assessed
   against"* — the pure-CLI, zero-embedder contract-retention proof.
   `main(["run", "--track", "--assume-defaults", "--executor", "fake", …])` →
   `COMPLETED`; the durable checkpoint carries constraints
   `["c-smallest", "c-tests"]`; every assessed turn is `constraint-retention:
   PASS`. The discriminator is in the same test and the same state root: a
   `--children` run (contract-skipped by design) assessed at
   `{ tsk_implement: "NOT_APPLICABLE" }`, so `PASS` is demonstrably earned by
   the contract rather than being the free default.

The pre-existing test in that file proves the two commands *record* different
contracts; this one proves the recorded difference is load-bearing.

## 3. The determinism seam — what I found, and what I declined

**A tracked run driven purely by the CLI is always terminal in one process.**
Three independent facts, each verified in source and then by probe:

- `compileChildrenToFlowchart` sets `approvalRequired: false` on every node
  (`graph/compile-children.ts:114`), so a tracked flowchart can never stop at
  `WAITING_FOR_USER` on an approval.
- `runCommand` always builds an executor on the track path — `executorKind`
  falls back to `fake-children` (`main.ts:801-806`) — and `ChildFakeExecutor`
  always emits `SUCCESS` with `verification: PASSED`, so no node fails and the
  run never `BLOCKED`s.
- The clarification leg (`waitForClarification`) *can* return
  `WAITING_FOR_USER`, but it writes a checkpoint with **no flowchart payload**,
  which `restoreFlowchartSession` refuses (`flowchart-run.ts:1481`) — so that
  run is not pausable either, and it never enters the flowchart loop at all.

Probed both ways at `--assume-defaults` and without: `COMPLETED`, 41 events,
5 children, every time.

**Therefore the only non-terminal status a tracked run can reach is `PAUSED`
itself, which requires the token to already be present at a round boundary.**
The token lives at `runtime/runs/<runId>/pause.json`; the run id is
`randomUUID`-derived inside `startFlowchartRun` (`flowchart-run.ts:1054`);
`runCommand` prints it only after the outcome returns; and `pauseCommand`
refuses a run whose log it cannot find. So pausing a *live* tracked run is
inherently a two-terminal act, and there is no in-process arrangement of
shipped commands that produces one deterministically. **This is not a gap in my
seam design — it is a property of the tracked command surface**, and it is why
R10-4's arc was unreachable for a second reason beyond the missing dep.

Options I designed and declined, with the reason for each:

| Option | Verdict |
|---|---|
| Poll the state root for the new run directory, then write the token | The racy option the parent forbade. Declined. |
| `fs.watch` on `runtime/runs` instead of polling | Same race (the run can finish before the token lands), plus watcher flakiness. Declined. |
| Lock barrier: pre-hold the episode lock so the run wedges after `RUN_CREATED` (run dir exists) but before round 1, seed the token, release | Deterministic in principle, but (i) `requestPause` takes `runLockPath`, which the tracked run holds for its whole lifecycle, so the token would have to be hand-written rather than requested — the `pause` leg stops being the CLI's; (ii) it pins an internal lock ordering nothing else depends on; (iii) it is elaborate machinery for one leg. Declined as disproportionate fragility. |
| Early run-id disclosure so a synchronous `io.stdout` handler can seed the token before round 1's poll | Genuinely deterministic, and arguably a real production gap (an operator cannot pause a live tracked run because the id arrives only at the end). But the only place `main.ts` can learn the id in that window **without** editing `src/run/flowchart-run.ts` — R11-4's sole ownership this round — is by wrapping the controller so its first `token(runId)` call doubles as a lifecycle notification. That deviates from the signed-off "supplies `createFilePauseController(stateRoot)`", repurposes the pause channel as a notification channel, and adds new CLI output. **Unsigned src surface; declined and recorded below as a Round 12 candidate.** |
| Kill the process | Explicitly forbidden. Not attempted. |

**What I built instead** is the parent's stated preference: *a deterministic
hook of the same class as the untracked flip test, with the CLI doing the
driving.* The untracked flip test's hook is an in-memory `TogglePause` plus an
executor callback that flips it, seeded at the embedder boundary, with the CLI
driving everything after the seed. Mine is the identical shape one level up —
the seed is `startTrackedRun`, which is the entry point `runCommand` itself
calls and which only became pausable because of this slot's `src` change, and
`pause`/`resume` are both `main([...])`. **Zero `startFlowchartRun` in the
proof loop**, as required, and the contract under test is the tracked
extractor's own rather than one a test hand-fed — which is the half of "non-
embedder" that was actually missing, since no CLI flag accepts a contract.

**Residual, stated plainly:** the pause leg of the *pure-CLI* arc is pinned at
the call site (test 3), not proven behaviourally. Its own docstring says so, so
the limitation is legible at the point of reading rather than only here.

## 4. Fold — declined, as instructed

`formatBlockedRunReport` was not given the checkpoint. The discard `note:` stays
unconditional. `test/integration/cli/blocked-next.test.ts` is untouched (I ran
it as a consumer; unchanged and green).

## 5. Verification

- **Scoped ESLint** over `src/track/loop.ts`, `src/cli/main.ts`,
  `test/integration/m2.5/resume.test.ts`,
  `test/integration/m2.5/cli-contract-honesty.test.ts`: **exit 0, clean**.
- **Whole-tree `tsc --noEmit`**: clean for every file I touched. One error
  remains in the tree and is not mine —
  `test/unit/tracking/option-a-preconditions.test.ts:342` (`GateInput` missing
  `criterionUnmet`), R11-1's option (a) mid-flight, that file's mtime moving
  during my run.
- **Owned tests, 3× each** (timing-sensitive: real runs, real fs, real locks):
  stable at **20 pass / 1 fail / 0 skipped** across all three iterations. The
  single failure is §6.1 and is not caused by my diff. My four new tests pass
  3/3. `cli-contract-honesty.test.ts` alone: **2/2, 3/3 iterations**.
- **Consumers** (74 tests): `blocked-next` (four-line BLOCKED prefix,
  `runCommand` flowchart-outcome census), `inspection` (`INSPECT_SUMMARY` four
  keys), `doctor-routed-next-freeze` (five routes character-exact — I edited
  `main.ts`), `invocation-log` + `invocation-sink-wiring` (`runCommand` builds
  exactly two executors), `track-loop`, `clarification-lifecycle-lock`,
  `loopback-cli-resume` (supervised-resume stderr pin — **not edited**): all
  green.
- **Second consumer sweep** (58 tests): `live-isolation`, `undelivered-mail`,
  `cli.test.ts`, `r1-shadow-report`, `episode-contract-boundary`: green.
  `simulation-holdout` (11): green.
- **`live-isolation.test.ts` run** even though my only new import is a
  `type`-only `PauseController` outside any live closure: green.
- **R10-4's writer-census property pin** and **R9-1's flip pin /
  never-synthesize pin**: untouched and green.
- **No new skip** (0 skipped in every run of my files). **No full gate**, as
  required. **No scratch files** — probes ran from `/tmp` and are deleted;
  `git status` shows no untracked files under my ownership.
- **No `git checkout`, no commit, no push.** Still on `agent/opt-continuous`.

## 6. Disclosures

**6.1 — A cross-slot obligation lands red inside a file I own. I prescribe
rather than ship it, deliberately.**

`test/integration/m2.5/resume.test.ts:363` *"the flowchart checkpoint, its
validator, its writer and both restorers carry the run contract"* is **red in
the working tree**, and was red before I wrote a line: R11-1's in-flight option
(a) spends R9-1's reserved seam in `src/run/replay.ts`, deleting the
`Reserved: per-task acceptance criteria` sentence and adding a `taskCriteria`
field, which is exactly what the test's last two assertions forbid:

```
assert.match(checkpointState, /Reserved: per-task acceptance criteria/);
assert.doesNotMatch(checkpointState, /acceptanceCriteria\??:/, "…stays reserved, not implemented");
```

Confirmed not mine: `git show HEAD:src/run/replay.ts` still contains the
sentence, so the failure is entirely the working tree's uncommitted
`replay.ts`. My own diff to that file is +161/−0 with no deletions.

**I did not fix it, and the reason is a lost-update hazard, not reluctance.**
The parent's own R11-1 sign-off names "R9-1's reserved-unimplemented assertion"
among the pins R11-1 must replace *in the same diff* — and that assertion lives
in my file, which R11-1's ownership row does not list. R11-1 was still actively
writing at 00:06:55Z (25 s before my census). All slots share one working tree
with no git isolation, so if R11-1 has this file open and writes it after me,
my 161 added lines vanish silently. Editing into that window trades a known red
test for a possible loss of the whole slot. Per the round's "ship **or
prescribe**" rule I prescribe:

> Replace those two assertions with their positive successors — the per-task
> criteria field exists on the same checkpoint seam, and it is still never
> synthesized from the episode. Whoever lands it should key on R11-1's shipped
> field name rather than on its docstring prose. Everything else in that test
> (the `contract?: RequirementContract` declaration, the validator's
> `Invalid RunCheckpoint: flowchart.contract` message, the writer, both
> restorers, and the store's schema-agnosticism) is unaffected and still green.

**Parent: this is a real ownership gap between R11-1's sign-off text and
R11-1's ownership row, not a slot failure on either side.** Whoever arbitrates
should assign the one-file edit explicitly.

**6.2 — The `--children` control in test 4 pins a task id.**
`{ tsk_implement: "NOT_APPLICABLE" }` names the spec's own task id, which the
test itself writes, so it is self-consistent rather than over-fitted to
production. I chose `deepEqual` on the whole map over a per-key lookup so a
future run that assessed a *second* turn would fail loudly instead of silently
narrowing the control.

**6.3 — Test 2 asserts `PASS` on every assessed turn, including the paused
leg's.** The turn the paused leg ran was assessed under the contract the
tracked run started with, not under the recovered one, so on its own it proves
nothing about recovery. The load-bearing assertion is the set difference: the
resumed turns are identified by name and asserted non-empty first. I kept the
blanket `PASS` because a resumed run whose *earlier* turns lost their verdicts
would also be a regression worth catching.

**6.4 — `constraint-retention: PASS` on the tracked path is not free.**
Verified by two independent controls rather than assumed: the `--children`
control in test 4 (`NOT_APPLICABLE`), and the file's pre-existing *"a CLI resume
of a run that started without a contract invents none"* test, which is still
green.

**6.5 — Exactly five children, and I did not pin that.** The tracked planner
produces planner/scout/implementer/reviewer/tester today. Test 1 asserts
`> 1` for the control rather than `=== 5`, so a planner change does not break a
pause pin that is not about planning. Test 4 likewise asserts `> 1` assessed
turns.

**6.6 — The declined option (d) is a genuine production gap, recorded for a
future round.** An operator cannot pause a live tracked run today, because the
run id is printed only once the run is over. The wiring this slot landed is
what makes the pause *possible*; discoverability of the id is a separate,
unsigned decision that needs `src/run/flowchart-run.ts` (not mine this round) to
do cleanly — a started-run callback on `FlowchartRunDeps` rather than a pause
controller doing double duty. Recommended as a Round 12 candidate, with the
determinism payoff noted: it would also make the pure-CLI arc's pause leg
provable without a single racy line.

## 7. Frozen surface — untouched

ADR-006 still Proposed. No `docs/**`, no `package.json`, no dependency change,
no ADR status line. Five `DOCTOR_ROUTED_NEXT` routes and `GENERIC_FAILURE_NEXT`
character-exact (consumer test green after my `main.ts` edit). Four-line BLOCKED
prefix, `INSPECT_SUMMARY` four keys, loopback supervised-resume stderr pin, the
R10-4 writer-carriage property, the R9-1 flip and never-synthesize pins, R8-3's
`applyRetry` absence pin: all untouched and green. `writeFileAtomic`,
`withExclusiveFileLock`, `withRunLifecycleLock`, jsonl signatures and the
append/checkpoint-unlocked rule are all unchanged — I added no writer, no lock
and no fs primitive.
