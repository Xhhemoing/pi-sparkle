# R6-3 — The last unlocked embedder, the supervised pre-flight, and the pre-rounds window

Slot: R6-3 (P2, lifecycle-lock completeness) · branch `agent/opt-continuous` · dispatch HEAD `b4cc072`. No commits, no branch changes, no `package.json` edits.

**Result: shipped, all three parts, each reproduced at HEAD before it was fixed.** The track loop's clarification path now holds the run lifecycle lock, so it is no longer the embedder the survivors error's "an embedder that does not take the lifecycle lock" clause describes. `startSupervisedRun`'s pre-flight is hoisted out of the lock, so a refused supervised start leaves an empty state root like the M0, parent and flowchart planes. And (c) is decided **widen, not document**: the pre-rounds window was reachable from an ordinary empty task list, not just a disk failure, and the run it left was unsettleable by any command — so it now gets the same terminal-then-settle pair the rounds get.

One consequence I took deliberately and disclose in §6: the supervised resume's terminal check moved above its state reconstruction, because otherwise the widening produces a run whose honest FAILED nobody can read back.

---

## 1. Census (before coding)

- **Track loop tests do not live in `test/unit/track/` or `test/integration/m3/`.** They are `test/integration/track/track-loop.test.ts` (4 tests, 3 driving `startTrackedRun` directly, 1 through the CLI). Unclaimed by any Round 6 slot, so I claimed it; in the end I added nothing to it, because the lock pins are better placed beside the other unit-level lock pins (§4). `test/unit/track/` holds `clarify-plan` and `primary-split` only; `test/integration/m3/` holds no track-loop test.
- `supervisor.ts` entry points are called from `src/cli/main.ts:1251` (`resumeSupervisedRun` only), and from four test files besides mine: `m2/resume.test.ts`, `m2/supervisor.test.ts`, `pi-adapter/loopback-cli-resume.test.ts`, `unit/cli/invocation-sink-wiring.test.ts`. All four run green after the change (§7).
- `waitForClarification` already took `runLockPath` for its questions write. That acquisition had to **go**, not nest: R5-1's rule 2 (the lock is not reentrant) means keeping it inside a `withRunLifecycleLock` body self-deadlocks. The exclusion it bought is not lost — it is now held across the whole run instead of one write.
- The R5-1 source pin in `test/unit/run/run-lifecycle-lock.test.ts` covers the four `coordinator.ts`/`flowchart-run.ts` call sites and does not mention `supervisor.ts`. That file belongs to no Round 6 slot; rather than edit it I put the supervised source pins in my own file (§4).
- `settleSupervisedOutcome`'s `trackingAssessment` parameter is still a no-op on every production path (R5-2 residual 2, R6-9's known suspect). Not in this slot's change list and not touched — handed on in §8.

## 2. The evidence, reproduced at HEAD

All three defects were reproduced before any edit, with probes under `/tmp/r63-probe` (nothing in the repo). Verbatim results:

**(a) The clarification run wrote a whole run past a lock holder.** Holding `runtime/runs/<runId>.lock` — what a `delete --run` in progress, or a SIGKILLed run, leaves — and then running `startTrackedRun` on a vague objective:

```
recordsWrittenWhileHeld:
  runtime/episodes/ep_….events.jsonl
  runtime/episodes/ep_….jsonl
  runtime/runs/run_…/events.jsonl        ← PROJECT_DISCOVERED, RUN_CREATED,
  runtime/runs/run_….lock                  EPISODE_OPENED, RUN_ATTACHED,
outcome: REJECTS: timed out waiting for lock                RUN_STARTED, RUN_WAITING_FOR_USER
```

So it wrote the run's discovery, its bound episode and its waiting terminal *through* the holder, and only the last write — the questions file — failed closed. The run is left half-written and the delete it raced is the thing that has to cope.

**(b) A refused supervised start persisted `runtime/runs/`.** A cyclic task graph at HEAD: `tree: ["runtime/", "runtime/runs/"]`. The M0 plane's pin for the same class of refusal asserts `readdir(stateRoot)` deep-equals `[]`.

**(c) A pre-rounds death left a run nothing could settle.** Two seeds, same shape:

| seed | log at HEAD | checkpoint | episode | resume says |
|---|---|---|---|---|
| episode store unwritable | `PROJECT_DISCOVERED, RUN_CREATED` | absent | never bound | `has no TASK_GRAPH_ACCEPTED event` |
| **empty task list** | `PROJECT_DISCOVERED, RUN_CREATED, EPISODE_OPENED, RUN_ATTACHED, RUN_STARTED` | absent | **bound forever** | `has no TASK_GRAPH_ACCEPTED event` |

The second seed is the one that decided (c). It needs no filesystem sabotage: `validateTaskGraph([])` accepts an empty list, and the `TASK_GRAPH_ACCEPTED` append is then refused by event validation (`payload.tasks must be a non-empty array`). Replay reads RUNNING forever, the operator's two durable views are absent and stale-open respectively, and **no command can settle it** — `resumeSupervisedRun` refuses a log with no accepted graph, which is every log this window can leave. That is strictly worse than the post-rounds case R5-2 fixed, and it is reachable through the public API with a plausible input.

## 3. What changed

| File | Change |
|---|---|
| `src/track/loop.ts` | `waitForClarification` splits into pre-flight (`discoverProject`) + `recordClarificationRun`, the record-writing body, wrapped in `withRunLifecycleLock`. The questions write's own `withExclusiveFileLock` is deleted (not reentrant) and is now covered by the run's acquisition. `TrackRunInput.runLock?: FileLockOptions` (additive) |
| `src/run/supervisor.ts` | `startSupervisedRun`'s `discoverProject` and `validateTaskGraph` hoisted outside the lock; the locked body is the named `startLockedSupervisedRun(project, graph)`. `runAndSettleSupervisedRun` takes an `open: () => Promise<SupervisorState>` and gives that pre-rounds window the same terminal-then-settle pair the rounds get. Resume's terminal check moved above its state reconstruction (§6). Resume's nonexistent-run posture recorded on the function |
| `src/run/event-store.ts` | Comment-only: two clauses named the track-questions write as a separate holder of `runLockPath`. It is now covered by `withRunLifecycleLock`; the list would over-count |
| `src/privacy/deletion.ts` | Comment-only, same clause, same reason |
| `test/unit/track/clarification-lifecycle-lock.test.ts` | **New** (5 pins) |
| `test/integration/m2/supervised-lifecycle-lock.test.ts` | **New** (7 pins) |
| `test/integration/m2/supervisor-crash.test.ts` | +3 pins for the pre-rounds window |

Nothing else. `applyRetry`, the crash-terminal module and its two guards, the `afterTerminal === ["EPISODE_CLOSED"]` contract, `withRunLifecycleLock` itself and its rules are all untouched.

### (a) The clarification run, per R5-1's rules

Rule 1 — pre-flight outside: `discoverProject` runs before the acquisition, so a bad project root leaves an empty state root rather than `runtime/runs/`. Rule 2 — never wrap a body that takes the lock: the questions write's own acquisition is **deleted**, because nesting it under the new one self-deadlocks. Rule 3 — thread the seam: `TrackRunInput.runLock`.

The exclusion the deleted acquisition bought is strictly wider now: previously only the last of the run's seven writes was serialized against `delete --run`; now all of them are.

### (b) The supervised pre-flight

`startSupervisedRun` uses R5-1's published handle-returning shape — the async IIFE runs discovery and graph validation, then acquires. The handle is still returned synchronously and `runId` is still known before either. `assertCoverageAllowsStart` was already outside and stays there.

Measured after: a cyclic graph and a missing project root both leave `readdir(stateRoot) === []`, the M0 pin's exact assertion.

### (c) Decision: widen the settle wrap to the pre-rounds window

**Decided: widen.** The alternative on offer — record the accepted contract in-source — was rejected on the evidence in §2. Recording an accepted cost is right when the cost is rare and the run is still readable; here the window is reachable from an empty task list, and the run it leaves is not readable by any command. That is not a cost to accept, it is the defect R5-2 fixed one loop earlier, in a window R5-2 did not cover.

The shape mirrors the rounds window exactly rather than inventing a second discipline:

```ts
try {
  state = await open();
} catch (error) {
  await recordCrashTerminal(ctx, error);   // what runSupervisorRounds does
  await settleCrashedSupervisedRun(ctx);   // what the catch below does
  throw error;
}
```

Three properties I checked rather than assumed:

- **Settle-without-terminal was considered and rejected.** Writing a checkpoint over a log that still reads PLANNING would publish "resumable" for a run nobody is driving — precisely the disagreement R5-2 removed. The terminal has to come first or not at all.
- **The in-flight-only guard already handles the degenerate logs.** A log that is empty, or that already reads settled, gets no terminal — the same rule, unchanged, doing its job at the other end of the run. A `RUN_FAILED` over `PROJECT_DISCOVERED` + `RUN_CREATED` replays FAILED with `anomalies: []`.
- **Best effort survives.** With the event log itself unwritable the crash terminal cannot land either; the original error is still what the caller sees and no checkpoint is invented. Pinned.

Resume passes a trivial `open`: its pre-flight only reads, and it must stay outside the protected region — a resume that refuses someone's log must not append a terminal to it.

After: the empty-task-list run ends `… RUN_STARTED, RUN_FAILED, EPISODE_CLOSED`, episode FAILED, checkpoint FAILED, `anomalies: []`, and `resumeSupervisedRun` reports FAILED.

### The nonexistent-run-resume posture, pinned once for all planes

R5-1 disclosure 4 was per-plane folklore. It is now stated on `resumeSupervisedRun` in source and pinned as a table-driven test over **both** resume planes (supervised and flowchart): a resume of a run id that does not exist leaves `runtime/runs/` empty and nothing else — no run subtree, no lock file, `deleteRunRecords` still a no-op. The reason is in source too: resume cannot hoist pre-flight the way a start can, because every check it makes is a read of the records the lock protects, and reading first would let a delete land in between.

I drove `resumeFlowchartRun` read-only to pin the second plane; `src/run/flowchart-run.ts` (R6-1's file this round) is untouched.

## 4. Pins added (15)

`test/unit/track/clarification-lifecycle-lock.test.ts` (5):
- a clarification run refuses to start while another holder has the run lock, **and writes nothing** — no event log, no checkpoint, no questions file, no episode bound past the holder *(the (a) defect, inverted)*
- a clarification run mints its id before the lock and its records under it — the run id is minted with the lock absent (so a refused run leaves no `runtime/runs/`), the last record with it held, and teardown releases it
- a clarification run still publishes its questions file crash-atomically, with no temp file left behind
- a clarification run refused by discovery persists nothing
- source pin: the record-writing body is what is wrapped, the options seam is threaded, `runLockPath`/`withExclusiveFileLock` no longer appear in the file, and discovery precedes the acquisition

`test/integration/m2/supervised-lifecycle-lock.test.ts` (7):
- a supervised run refused by **a missing project root** persists nothing *(mirrors the M0 pin verbatim)*
- a supervised run refused by **a cyclic task graph** persists nothing
- a supervised run refused by the run lock persists nothing, with `LOCK_TIMEOUT`
- a live supervised run holds the run lock, and teardown releases it
- a **supervised** resume of a run that does not exist leaves an empty `runtime/runs/` and nothing else
- a **flowchart** resume of a run that does not exist leaves an empty `runtime/runs/` and nothing else
- source pin: pre-flight is outside the acquisition (`validateTaskGraph` immediately precedes `withRunLifecycleLock(… startLockedSupervisedRun(project, graph) …)`), resume routes through the same helper, and `supervisor.ts` never rebuilds `runLockPath`

`test/integration/m2/supervisor-crash.test.ts` (+3):
- a supervised run that dies in its opening appends records a terminal and settles — exact reason `run crashed: Invalid Event: payload.tasks must be a non-empty array`, `afterTerminal === ["EPISODE_CLOSED"]`, episode FAILED, checkpoint FAILED, `anomalies: []`
- a run that died before accepting a graph resumes as terminal rather than as a missing graph, read-only
- a pre-rounds crash whose own terminal cannot land still rethrows and writes no checkpoint *(best-effort preserved)*

Unchanged and re-verified green: all nine pre-existing supervisor-crash pins including both `afterTerminal` asserts and the two settled-log cases; R5-1's seven lifecycle-lock pins including the four-call-site source pin; the M0 refused-start pin; the deletion suite's lock-holder pins.

## 5. Perf

**No bench, and the claim is structural rather than measured.** Nothing acquires a lock more often than before: the clarification run swaps one acquisition (the questions write) for one acquisition (the whole run), and the supervised start still takes exactly one. The widened window adds one `try`/`catch` and one closure call per run and no I/O on any path that does not crash. The hoist *removes* an acquisition from every refused start. There is no arm here worth 81 reps.

`node scripts/crash-probe.mjs` → `ok: true`, **9 cases × 3 iterations** (the case set grew by one in the shared tree — R6-8's `sigkill-run-lock-operator-recovery` — and it is green with these changes).

## 6. Disclosures

1. **Supervised resume's terminal check moved above its state reconstruction.** Without it the widening only half-works: a run that dies in its opening appends now settles honestly (log FAILED, checkpoint FAILED, episode closed), but `resumeSupervisedRun` would still answer `has no TASK_GRAPH_ACCEPTED event` — refusing to report a state it can plainly read. A terminal run is resumed read-only and has nothing to reconstruct, so the check belongs first. This is observable **only** on logs that are terminal *and* carry no accepted graph, and until this slot no writer could produce one. A `WAITING_FOR_USER` clarification run (also graph-free) is unaffected — it is not terminal. Pinned.
2. **Two comment-only edits outside my ownership list.** `src/run/event-store.ts` and `src/privacy/deletion.ts` each named the track-questions write as a distinct holder of `runLockPath`; after (a) it is covered by `withRunLifecycleLock`, so both lists over-counted. Behaviour, `runLockPath`, the double verify and `RUN_RECORDS_SURVIVED` are untouched, and no test pins the prose I changed (checked). Same precedent and same reason as R5-1 disclosure 2. `event-store.ts`'s older sentence listing which embedders `withRunLifecycleLock` wraps was already incomplete at HEAD and I left it alone — R6-7 owns the truth-up.
3. **`test/integration/track/track-loop.test.ts` was claimed by census and then not edited.** It is unowned this round and holds the only other `startTrackedRun` tests; I ran it every sweep (5 tests, green) but the lock pins read better beside the other lock pins.
4. **The empty-task-list case is now a *settled failure*, not a refused start.** I did not make `validateTaskGraph` reject an empty list — `src/graph/validate.ts` is not my file, and the widening handles it honestly at the right layer. If a later slot does tighten that validator, the pre-rounds pin should be re-seeded on the episode-store variant (§2, first row), which is the same window reached a different way.
5. **`runtime/runs/` still appears for a refused *resume*.** That is the pinned posture, not a leak, and §3 says why in source. Only *starts* keep the strict "a refused run persists nothing" contract.
6. **No new skip.** The only skipped test anywhere I ran is the pre-existing `PI_SMOKE=1` provider gate in `test/integration/pi-adapter`.
7. **No process-death semantics changed**, so the R5-2 census obligation does not fire: `simulateProcessDeath` in `m2/resume.test.ts` and the loopback suite's inline lock removal both still mean what they meant, and both suites are green.

## 7. Verification

- **`npx tsc --noEmit`, whole tree: clean, exit 0.** An intermediate run showed 20 errors in `test/integration/m2.5/resume.test.ts` (R6-2's file, mid-edit — missing imports); attributed by grouping errors per file, not inspected-and-assumed, and gone on the next run once that slot finished. No file of mine ever errored.
- **`npx eslint`, scoped to all seven owned/edited files: clean, exit 0.**
- **Timing-sensitive owned tests 3×**, three consecutive sets: `test/integration/m2`, `test/unit/track`, `test/integration/track`, `test/unit/run`, `test/integration/m0`, `test/unit/privacy` — **283 tests, 283 pass, 0 fail, 0 skip**, identical all three runs.
- **Wider sweep, all green**: `test/integration/m2.5` (23), `test/integration/m3` (31), `test/integration/cli` (78), `test/unit/cli` (108), `test/integration/pi-adapter` (9, 1 pre-existing skip). Every caller of `startSupervisedRun`/`resumeSupervisedRun`/`startTrackedRun` in the tree is in that list.
- `node scripts/crash-probe.mjs` → `ok: true`, 9 cases × 3 iterations.
- No full gate (the parent's job). No scratch files in the repo — probes live in `/tmp/r63-probe`. `git status` shows only my seven files plus other slots' in-flight work.

## 8. Handed on

- **R6-9**: `settleSupervisedOutcome`'s `trackingAssessment` parameter is still a no-op on every production path — `finishSupervisedRun` is the only caller and never passes one, so the whole tracking-gate branch is dead outside tests. I owned the file and deliberately left it: it is a census-and-delete decision, not a lock-completeness one, and deleting a published seam mid-round without the census behind it is how seams come back. It is a clean candidate for Round 7 with the census in hand.
- **R6-7 (docs)**: three things are now true that no doc says — the clarification run holds the lifecycle lock (so the survivors error's "an embedder that does not take the lifecycle lock" clause no longer describes any shipped embedder); a refused supervised start persists nothing; and a supervised run that dies before its rounds settles to FAILED rather than replaying RUNNING forever. The nonexistent-run-resume posture is now one contract across both resume planes, source-stated and pinned, rather than an R5-1 disclosure.
- **Anyone touching `graph/validate.ts`**: see disclosure 4.
