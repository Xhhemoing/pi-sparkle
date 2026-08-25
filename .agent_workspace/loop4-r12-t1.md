[Model: opus-fast]

# Loop 4 · Round 12 · R12-1 (spine) — `taskCriteria` writer + reader, and early run-id disclosure

**Both mandates landed in one diff.** Neither half was stopped-and-reported.

Branch `agent/opt-continuous`, working tree only. No `git checkout`, no commit, no push.

- **Mandate A** — the durable per-task criteria seam has a writer and a reader. A run paused, blocked or crashed before a child is dispatched no longer silently re-dispatches that child with an empty criteria list; a node nobody ever described still gets one.
- **Mandate B** — `FlowchartRunDeps.onRunStarted` fires once the run directory, the `RUN_CREATED` row and the lifecycle lock exist and before round 1's pause poll; `startTrackedRun` forwards it; `runCommand` prints `Run <id>: started` on the track path. R11-3's call-site pin is now backed by a **behavioural pure-CLI tracked pause** that is deterministic, races nothing and kills nothing.

Two disclosures need the parent's eye before anything else: **§2** (one edit outside my listed ownership, in a file no R12 slot owns) and **§3** (one place where I did more than the sign-off's literal text, and why the mandate is vacuous without it).

## 1. Census, taken first, against the working tree

Taken at **2026-08-25 00:46–00:50 UTC**, base `d694de1`. Every path the brief handed me exists and I verified each before writing:

| Path | State at census | Mine? |
|---|---|---|
| `src/run/flowchart-run.ts` (2021 lines) | exists | sole |
| `src/track/loop.ts` (333) | exists | sole |
| `src/cli/main.ts` (2118) | exists | sole |
| `test/integration/m2.5/resume.test.ts` (19 tests) | exists | yes |
| `test/integration/m2.5/cli-contract-honesty.test.ts` (2) | exists | yes — **not edited**, see §6 |
| `test/unit/tracking/option-a-preconditions.test.ts` (7 pins) | exists | yes — **not edited**, see §4 |

Line numbers the brief quoted had drifted: `childTasksFromLog`'s substitution is at **411** as stated, its sole call site at **1346** as stated. Both correct.

**Shared-tree transients observed, with timestamps, none mine:** `test/unit/run/checkpoint-writer-carriage.test.ts` appeared **00:47:54** (R12-10); `test/integration/run/criteria-gate.test.ts` appeared **00:49:14** (R12-3); `docs/**` modified when I looked at **00:50:03** (R12-4); HEAD moved `d694de1` → `03f4b74` at **00:56:29**, absorbing R12-3/R12-4/R12-5/R12-10. Every verification number below §7 was taken **after** that move.

## 2. Disclosure: one edit outside my listed ownership

`test/unit/run/flowchart-run-abort.test.ts` line 1013 asserted `attempt.acceptanceCriteria` deep-equal `[]` for a node the log never saw run. Mandate A makes that false by design — it is the same laundering scenario the field exists to stop, reached through a crash instead of a pause. The file is **not** in my ownership row and **not** on my do-not-edit list, and **no Round 12 slot owns it** (R12-5 owns `flowchart-applyretry-absence.test.ts`, a different file).

I truthed it up in the same diff rather than leaving the tree red or deferring to a follow-up commit, which is what §3 of the brief asks for when an obligation's file has no other owner. The edit is 28 lines, all comment except one flipped assertion and one strengthened message; the artifacts half (`inputArtifactIds` stays `[]`) is deliberately kept, because that is what makes the change a restoration rather than an invention. The R6-2 tripwire, the budget-substitution pins and the `childTasksFromLog` wiring pin in the same file are byte-untouched and green.

If the parent would rather this were a planned joint, the hunk is self-contained and revertible on its own.

## 3. Judgement call: the writer needs a third source, or the mandate is a no-op

The sign-off names two writer sources: logged `TASK_REQUEST`s, and first-write-wins against the checkpoint's existing record. **I built both, and then found that those two alone cannot ever make the reader do anything**, so I added a third and I want it flagged rather than buried.

The argument, verified in source rather than reasoned from the brief:

1. `CHILD_MESSAGE`/`TASK_REQUEST` is appended to the parent log by `ChildCoordinator` at **attempt start** (`child-coordinator.ts:651`), never earlier.
2. So on any one log, "the record knows task T" implies "the log has a request for T" — the record is built from the log. The reader only consults the record in the substitution branch, which is exactly the branch where the log has *no* request. The two sets are disjoint. The reader fires zero times.
3. The run log is append-only and nothing trims it, so there is no path where the record outlives the row it came from.

Meanwhile the bug is real and reachable in two ways I confirmed:

- **Pause before dispatch.** `runFlowchartLoop` checkpoints after leasing (line 875) and polls the pause token at 865 and 880 — both before `executeRemainingRunningNodes` dispatches anything. A run paused at round 1 has caller-supplied child specs and zero `TASK_REQUEST`s.
- **Crash before dispatch.** `flowchart-run-abort.test.ts`'s `resumedAfterCrashBeforeAcceptance` already constructs exactly this: node `tsk_b` unstarted when the crash lands.

In both, the resume rebuilds the child with `acceptanceCriteria: []`, runs it, and logs that empty list — which last-request-wins then makes authoritative forever. One pause permanently downgrades what a node is asked to satisfy, undetectably.

**What I did.** The record's third source is the caller's own `input.childTasks` on the **start path only** (`plannedTaskCriteria`), recorded when the run accepts the specs rather than when it dispatches them. These are the identical `acceptanceCriteria` arrays `buildTaskRequest` copies verbatim into each `TASK_REQUEST` (`child-coordinator.ts:392`), so this records a dispatch fact early, not a synthesised one.

**Why this is not the thing the sign-off forbade.** The prohibition is on writing `ctx.childByTaskId` *substitution empties*, and its stated reason is that on a resume that map is rebuilt by `childTasksFromLog` and carries laundered empties. I never touch `ctx.childByTaskId`. The resume path seeds the context **only** from the durable checkpoint record, never from the rebuild, so no substitution empty can enter the record through the context.

**And one tightening the sign-off did not ask for, in the same spirit.** `advanceTaskCriteria` ignores a logged request whose `acceptanceCriteria` is empty. On the log a caller who genuinely asked for none and a node the rebuild substituted for are byte-identical, and recording the second as the first is the laundering one step removed. The only producer that can tell them apart is the caller's spec, which the start seed records — empty list included, because that *is* the meaningful "dispatched with none". Without this guard, the unrecorded node in §5's test would be absorbed as known-none on the resume's own checkpoint write; with it, it stays unknown forever. Mutation-checked (§7).

**Net semantics, all three sources:** the record is monotone (never revised, never dropped), holds caller specs from the start path, real criteria from any logged request, and *nothing* for a task neither source names.

## 4. What landed — Mandate A

`src/run/flowchart-run.ts` only. Three new helpers plus wiring at five seams.

- **`plannedTaskCriteria(tasks)`** — the start seed (§3). Duplicate task ids resolve last-wins, matching `childTaskMap`, so the record describes the spec that would actually run. Empty input → `undefined`, never an empty array.
- **`advanceTaskCriteria(recorded, requests)`** — one checkpoint write's advance. First-write-wins; empty logged requests ignored; ascending `taskId`; `undefined` when nothing is known. It produces the validator's shape rather than merely satisfying it.
- **`withRecordedCriteria(tasks, events, recorded)`** — the reader. Applied at `childTasksFromLog`'s sole call site, and **only** to specs the log has no request for. A task the log knows keeps the log's answer; a task neither source names keeps its empty list.

Seams:

| Seam | Change |
|---|---|
| `FlowchartLoopContext` | new `taskCriteria?: TaskAcceptanceCriteria[]` |
| `persistCheckpoint` | advances the record, then spreads it beside `contract` |
| `startLockedFlowchartRun` | seeds from `input.childTasks` |
| `resumeLockedFlowchartRun` | seeds from `checkpoint.flowchart.taskCriteria`; threads it into the rebuild |
| `restoreFlowchartSession` (pause/inject) | carries it forward, exactly as it does `contract` |
| `unblockLockedFlowchartRun` | carries it onto the reopened checkpoint |

**Why the reader is a post-step at the call site rather than a fifth parameter.** `test/unit/run/flowchart-run-abort.test.ts:1297` pins the call site character-exactly — `? childTasksFromLog(read.events, definition, registry, deps.router.config.models) : []` — and 1302 pins `const childByTaskId = childTaskMap(rebuilt);`. Adding a parameter would have forced a second edit to a file no slot owns. I renamed the raw result to `fromLog` and let `rebuilt` be the restored value, so both pins match byte-for-byte and `childTasksFromLog(` still appears exactly once in the region. The semantics are the mandate's; only the plumbing differs, and the reason is in-source on the helper.

**Not done, deliberately:** no `continuation.taskCriteria`. The contract has one because a caller may legitimately answer it; this is a record of what the run already dispatched, and a caller re-answering it would be exactly the invention the seam exists to prevent. Pinned negatively (`assert.doesNotMatch(resumeRestorer, /continuation\.taskCriteria/)`).

**Never-synthesize discipline held.** Nothing in the new code reads the bound episode, the flowchart definition or the run contract. R11-10's whole-`src` census (`episode-contract-boundary.test.ts`, R12-6's file) is green: my new scopes construct `taskCriteria` and `acceptanceCriteria` but have `readsEpisode: false`, which is the census's exact discriminator. R11-1's 7th pin is green untouched (§6). R12-10's writer-carriage property is green: both flowchart payloads carry `contract` as a property, and both now mention and carry `taskCriteria`.

## 5. What landed — Mandate B

- `FlowchartRunDeps.onRunStarted?: (runId: RunId) => void`, fired in `startLockedFlowchartRun` immediately after the `PROJECT_DISCOVERED` and `RUN_CREATED` appends. That is the earliest honest moment: the appends created the run directory, the log names the run, the lifecycle lock is held so nothing can delete the records out from under the id, and round 1's pause poll has not run.
- Wrapped in `try/catch` and swallowed. A throwing disclosure would abandon a run with records but no checkpoint, and `resumeFlowchartRun` refuses that state outright ("no durable checkpoint; refusing to invent state"). Stated in-source.
- `TrackRunInput.onRunStarted` forwarded verbatim by `startTrackedRun`. The clarification path deliberately does not fire it — that run never reaches the flowchart loop and is `WAITING_FOR_USER` before it returns, so there is nothing to pause.
- `runCommand`'s track path prints `Run <id>: started\n`.

**The pause controller was not overloaded.** `onRunStarted` is a one-way notification with no return value and nothing read back; stopping a run still goes only through `PauseController`.

**No race, no process killed.** `onRunStarted` is synchronous and the run is suspended inside it, so a `stdout` handler that seeds the pause token has strictly ordered itself ahead of the first poll. The new test writes `pause.json` directly rather than through `createFilePauseController`, for two reasons that are both properties of the shipped code and are stated in the test: `requestPause` is `async` and cannot be awaited from a synchronous sink, and it takes the run's cooperative lock (`runLockPath`) — which this very run holds for its whole lifetime, so an in-process request would block rather than pause. The bytes still have to satisfy the production reader, since `PauseController.token` throws on a malformed `pause.json`.

**Census of every `startFlowchartRun` / `startTrackedRun` deps literal.** Both new fields are optional, so no consumer required a change: `src/cli/main.ts` ×3, `src/track/loop.ts` ×1, `scripts/crash-probe.mjs` ×2, and 60+ test literals across 20 files. All exercised green (§7). **No `blocked-next` / doctor-routed-next update is needed and I edited neither** — I added no route string and changed no existing output line; `doctor-routed-next-freeze.test.ts` (5 routes + `GENERIC_FAILURE_NEXT`) and `blocked-next.test.ts` are green untouched. Nothing to prescribe to R12-7.

Output-shape check before writing the line: `runIdFromOutput`'s `/Run (run_[A-Za-z0-9_-]+):/` in `cli-contract-honesty.test.ts` matches the same run's id either way; no test asserts a tracked run's whole stdout; `public-prior-cli.test.ts`'s `doesNotMatch(/COMPLETED/)` cases fail before the run starts; `track-loop.test.ts`'s `WAITING_FOR_USER` case is the clarification path, which does not fire.

## 6. Files I own and did not touch, with reasons

- **`test/unit/tracking/option-a-preconditions.test.ts`** — the brief allowed a 7th-pin truth-up "if its no-writer language needs it". It does not. Read at HEAD: the pin asserts the field's declaration, the `never *synthesized*` and `not from the bound episode` sentences, absence-stays-absent, a known-empty round trip, and eight fail-closed refusals. Every one is still true. It never claimed there was no writer; that claim lives in the two source docstrings in §8.
- **`test/integration/m2.5/cli-contract-honesty.test.ts`** — its two tests are about which contract each command records. The early-disclosure line does not change either answer and both are green. The pure-CLI pause proof belongs next to R11-3's pin it replaces, in `resume.test.ts`.

## 7. Verification

Everything below at **2026-08-25 01:00–01:04 UTC**, HEAD `03f4b74` plus my working tree, Node v22.14.0.

- **Whole-tree `tsc --noEmit`: exit 0.**
- **Scoped `eslint`** over all five edited files: exit 0, zero findings.
- **Whole suite: 1947 tests / 1946 pass / 0 fail / 1 skipped.** The single skip is the `PI_SMOKE=1` real-provider gate — I introduced none. Baseline was 1938/1937/0/1; **+9**, of which **+2 is mine** (`resume.test.ts` 19 → 21, counted per-file base-vs-tree) and **+7 belongs to the four sibling files** landed between 00:47 and 00:56 (`criteria-gate.test.ts`, `checkpoint-writer-carriage.test.ts`, and additions to `terminal-replay-statuses-freeze.test.ts` and `independent-evidence-posture.test.ts`). `flowchart-run-abort.test.ts` keeps its count — my edit was in place.
- **`node scripts/crash-probe.mjs`: `ok: true`, 11 cases × 3 iterations**, original ten names and order unchanged, `unblock-discard-append-before-checkpoint-sigkill` last. Run because `persistCheckpoint` changed.
- **Timing-sensitive owned tests 3×**: `resume.test.ts` + `cli-contract-honesty.test.ts` + `flowchart-run-abort.test.ts`, 46/46 on each of three consecutive runs.
- **`live-isolation.test.ts` green.** Run because the diff adds imports; the only `src` import added is a type-only `TaskAcceptanceCriteria` in `flowchart-run.ts`, erased at runtime. Everything else was already imported.

**Nine mutation checks, every one reverted and re-verified green.**

| Mutation | Red tests |
|---|---|
| drop the start seed | 3 — both substitution proofs and the pause-retention pin |
| drop `withRecordedCriteria` at the call site | 2 — both substitution proofs |
| drop the `taskCriteria` spread in `persistCheckpoint` | 4 |
| drop the empty-logged-request guard (§3) | 1 — the unrecorded node is absorbed as known-none |
| drop the carry-forward in `restoreFlowchartSession` | 2 |
| drop the carry-forward in the unblock writer | 1 — source pin only, see below |
| drop `onRunStarted` from `runCommand` | 2 — the wiring pin and the behavioural pause |
| drop the forward in `startTrackedRun` | 2 |
| drop the fire site in `startLockedFlowchartRun` | 1 — the behavioural pause |

The unblock carry-forward is the one seam with no behavioural proof: reaching it needs a BLOCKED run that also has recorded criteria, and the cheap blocked fixtures in my files are childless stalls. It is guarded by a source pin plus R12-10's AST property, which is exactly the posture `contract` itself had before R10-4 gave it one. Recorded as a residual rather than papered over.

**Frozen contracts, re-verified at HEAD after my diff:** restore-side `assertDiscardAuditMatchesLog` still called from `applyClearingEvent` and `restoreCheckpointedSupervisor`, set before sums, R10-1's message dominant; zero `applyRetry`/`scheduler.js` matches in `flowchart-run.ts`; `RUN_UNBLOCKED` three keys; no fourth `RunStatus`; `independentEvidence` still exactly one `void` in whole `src`; ADR-006 untouched (I edited no docs). `ctx.contract !== undefined ? { contract: ctx.contract }` and the unblock's `...(contract !== undefined ? { contract } : {})` are byte-identical, so R10-4's pins match unchanged.

## 8. Prescriptions — two stale source docstrings I may not edit

Both were exactly true at Round 11 and become false the moment this diff lands. Neither is asserted by any test (whole-tree grep: the phrases appear in these two places only), so nothing goes red; they are honesty debt.

1. **`src/run/replay.ts:107–110`** — on my explicit do-not-edit list. Currently: *"No `src` writer fills this yet — the flowchart checkpoint writer is `run/flowchart-run.ts`, outside this diff's ownership. Declared and validated here so the shape is fixed and a malformed value fails closed; the writer is prescribed in `.agent_workspace/loop4-r11-t1.md`."* Suggested replacement, keeping every sentence the option-(a) pins match (`never *synthesized*`, `not from the bound episode`) intact:

   > `run/flowchart-run.ts` fills this: the caller's child specs when a run accepts them, and any logged `TASK_REQUEST` that carries criteria, first-write-wins and ascending `taskId`. A logged request with no criteria is deliberately ignored — on the log it is indistinguishable from a substituted one — so absence still means unknown and only the caller's own spec can say known-none.

2. **`src/tracking/prescore.ts:174`** — not in my ownership. *"…which is declared and validated but has no writer yet"* is now false, and obligation 1 above it ("resumed child specs are re-synthesised with empty criteria") is now true only of nodes nobody recorded. The `coverageOutcome` body is untouched and its FAIL-unreachable range is unchanged; this is a comment-only correction.

3. **`docs/**` — R12-4's, landed at `d1b451c` (00:52) before this diff.** Two claims go stale: `docs/specs/m0-m2-architecture.md:553` ("no Round 11 `src` writer populates it" — accurate as a Round 11 statement, but the surrounding text reads as current state) and `docs/status-matrix.md:36` ("A node never requested keeps empty criteria/artifacts"), which is now true only of a node the record does not name. The run-id-at-end gap recorded in all three doc headers is likewise closed for the track path.

## 9. Residuals

1. **The unblock carry-forward has a source pin, not a behavioural one** (§7). Closing it needs a BLOCKED run with recorded criteria; `unblock-flow.test.ts` has the right fixtures and is saturated/owned elsewhere.
2. **`--flowchart` and `--children` still print their run id only at the end.** The same operator gap, deliberately out of scope: the mandate scoped `onRunStarted` to the track path, and those two paths' stdout is censused by `blocked-next.test.ts`, which I must not edit. One line each plus R12-7's consent would close it.
3. **A run started before this writer existed stays unknown for any task whose logged request carried no criteria** — by design (§3's guard), and the fail-closed direction. It is not recoverable and should not be guessed at.
4. **Resumed tester nodes can now move `check-coverage` from PASS to UNOBSERVED**, because they are asked for criteria they previously were not. That is the intended consequence of the approved semantic and it moves the numeric prescore, never the directive: `coverageOutcome` still has no FAIL in its range, and the FAIL-unreachable tripwire is green. No run changed status anywhere in the suite.
5. **Cost.** `persistCheckpoint` gains one in-memory pass over the event array it already replays, and a resume gains one more; no I/O, no lock, no writer changed. Below any threshold worth a bench, and I make no perf claim.
