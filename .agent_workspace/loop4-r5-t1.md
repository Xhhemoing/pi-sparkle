# R5-1 — The run lifecycle takes the run lock

Slot: R5-1 (P1, privacy/operability posture) · branch `agent/opt-continuous` · dispatch HEAD `6975aab`, tree HEAD at report time `c8e2524` (parent committed R5-4/R5-7/R5-8/R5-10 mid-slot). No commits from me; no branch changes.

**Result: shipped.** The three CLI-reachable run lifecycles now hold `runLockPath` for the whole run, so `delete --run` aimed at a live run waits for it instead of removing its subtree and then refusing. Measured cost is **0.148 ms per run** (median of 200 uncontended acquire+release), which is **+0.6 %** of a representative 8-node fake-executor run and **+2.0 %** of the shortest run the plane can do — inside the 5 % bar with margin, and below the harness's own drift on this VM. `EventStore.append` and `CheckpointStore.write` are untouched and their decision pins are green.

One cross-slot defect found and attributed by bisection, **not mine to fix**: R5-2's mirroring of this pattern into `resumeSupervisedRun` breaks R5-8's committed `loopback-cli-resume.test.ts`. Details in §7 — the parent needs to route it.

---

## 1. Census (before coding)

- `runLockPath(stateRoot, runId)` in `run/event-store.ts`; taken by `deleteRunRecords` (across rm + verify, plus the post-release verify), `requestPause`, and the track loop's questions write. Not taken by `EventStore.append` / `CheckpointStore.write` — decision-pinned in their own tests.
- The refusal R4-1 shipped happens **after** `rm -rf` has already run: `removeRunSubtreeLocked` takes the free lock, removes the subtree, the live run's next append recreates it, and `verifyRunRecordsRemoved` throws. So the pre-change behaviour against a live run was not "refuse" — it was "destroy part of a live run's records, then refuse". That is the strongest argument for this slot and it is not in the brief; it is now in the `deleteRunRecords` docstring.
- `src/run/crash-terminal.ts` **already existed** (untracked, R5-2 in flight) exporting `recordCrashTerminal(ctx, error, prefix = RUN_CRASH_PREFIX)` with a `CrashTerminalContext` that `FlowchartLoopContext` satisfies structurally, and a default prefix producing the byte-identical `run crashed: …` reason. Swap taken (§6).
- Shared worktree: R5-2, R5-4, R5-7, R5-8, R5-10 were all writing while I worked. Every failure I saw was reproduced and attributed to a file before I acted on it; I edited no unowned file to "fix" a transient.

## 2. What changed

| File | Change |
|---|---|
| `src/run/coordinator.ts` | New exported `withRunLifecycleLock(stateRoot, runId, body, options?)` (the pattern, documented with its trade); `startRun` and `startParentRun` wrap their record-writing body in it; `CoordinatorDeps.runLock?: FileLockOptions` (additive) |
| `src/run/flowchart-run.ts` | `startFlowchartRun` and `resumeFlowchartRun` wrap through the same helper; pre-flight hoisted out of the lock; private `recordCrashTerminal`/`crashReason` deleted in favour of `./crash-terminal.js`; `FlowchartRunDeps.runLock?` (additive) |
| `src/run/event-store.ts` | Comment-only: the `runLockPath` and `EventStore` docstrings said the lifecycle acquisition was *not* taken and lived in "other modules' files". Stale at HEAD; corrected. No code change — `runLockPath` and `append` are byte-identical |
| `src/privacy/deletion.ts` | Message/comment-only: `RunRecordsSurvivedError`'s remedy now says what survivors mean after the change, and the `deleteRunRecords` docstring records that a live run is now a wait, not a partially-destroyed refusal. Code paths, the double verify, and `RUN_RECORDS_SURVIVED` are untouched |
| `test/unit/run/run-lifecycle-lock.test.ts` | **New** (7 tests): the lifecycle-lock unit test |
| `test/unit/privacy/deletion.test.ts` | +2 tests: the delete-waits case and the delete-times-out case, both driven by a real `startFlowchartRun` |
| `test/integration/cli/delete.test.ts` | +1 test: `delete --run` issued against a live run at the CLI; one stale docstring corrected |
| `test/unit/run/flowchart-run-abort.test.ts` | +1 source pin: the crash terminal comes from the shared helper and no private copy survives |

`startRun` (M0) is **beyond the brief's literal list** and I took it deliberately: `pi-sparkle run --objective …` without `--flowchart`/children reaches it (`main.ts:916`), so leaving it unlocked would have made the new `RunRecordsSurvivedError` message — which blames "an embedder that does not take the lifecycle lock" — false for the plainest CLI run there is.

### The acquisition pattern (published for R5-2, who has already mirrored it)

```ts
export function withRunLifecycleLock<T>(
  stateRoot: string,
  runId: RunId,
  body: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  return withExclusiveFileLock(runLockPath(stateRoot, runId), body, options);
}
```

Three rules for mirroring it, all learned the hard way here:

1. **Wrap the record-writing body, not the whole function.** Pre-flight that can refuse the run — argument validation, coverage assertion, `discoverProject` — stays outside. `withExclusiveFileLock` does `mkdir -p` on the lock's parent, so acquiring before a refusal creates `runtime/runs/` for a run that never happened. `test/integration/m0/coordinator.test.ts`'s "a missing project root rejects without persisting a run directory" catches exactly this, and caught me.
2. **Never wrap a function that itself takes the lock.** `pauseFlowchartRun` calls `requestPause`, which takes `runLockPath`; the lock is not reentrant, so wrapping it self-deadlocks. `injectFlowchartRun` is left unwrapped too, but for a different reason: it is documented as a side channel usable against a run another process is driving.
3. **Thread an options seam** (`deps.runLock?: FileLockOptions`) so tests can bound the wait. Default is `withExclusiveFileLock`'s 5 s.

For handle-returning embedders (`startRun`, `startParentRun`, `startSupervisedRun`), the shape is `const done = (async () => { const project = await discoverProject(...); return withRunLifecycleLock(stateRoot, runId, () => body(project), deps.runLock); })();` — the handle is still returned synchronously and `runId` is still available before the lock is acquired.

## 3. The posture decision, stated

**What it buys.** A `delete --run` aimed at a live run has exactly two outcomes now, both honest and neither destructive:

- the run settles inside the bounded wait → the delete removes the subtree and returns a verified `DeletionResult`;
- the wait runs out → `LOCK_TIMEOUT`, **nothing removed**, records intact.

The outcome it replaces was: remove the subtree, watch the live run put it back, throw `RUN_RECORDS_SURVIVED` over a run whose records are now partly gone. Fail-closed, but expensively so.

**What it costs.** Everything else that takes the lock waits while a run holds it:

- `pi-sparkle pause --run` against a **live** run now fails closed with `LOCK_TIMEOUT` instead of writing `pause.json` and then settling that run's episode and checkpoint from underneath the process still driving it (`pauseFlowchartRun` ends in `finish`, which writes a checkpoint and settles the episode — doing that concurrently with a live run was never sound). Pausing a run that is *not* live is unchanged, which is every existing pause test. Pinned: `a cross-process pause of a live run fails closed rather than racing it`.
- A **SIGKILLed** run leaves the lock behind — locks are never stolen — so delete, pause and track-question writes for that run fail closed until an operator removes the file. Accepted with parent sign-off; `doctor` already inventories run locks with age, recorded PID and remediation, and `runStates` names the run. R5-9 routes `LOCK_TIMEOUT`/`RUN_RECORDS_SURVIVED` to that surface.
- A **resume** can no longer drive a run another process is still driving. This is new behaviour, it is correct, and it is what broke R5-8's fixture (§7).

Everything above is stated on `withRunLifecycleLock` in source, not only here.

## 4. Bench

**Harness.** Two source trees compiled into one process and alternated: `locked` = `src` as shipped, `control` = byte-identical `src` with only the two `withRunLifecycleLock` call sites in `flowchart-run.ts` removed (the strip script asserts both sites are found, so an arm can never silently be the wrong build). A third arm imports the *locked* module again under a second binding, giving the A/A noise floor next to the A/B delta. Fresh temp state root per rep, 3 discarded warm-up reps, rep order alternated, 81 reps per set. Workload: end-to-end `startFlowchartRun` with fake child results — every append, every checkpoint, episode bind and settle, real teardown. Everything lives in `/tmp/r51-bench`, nothing in the repo.

```json
{
  "harness": "two arms in one process, alternating order, fresh state root per rep",
  "node": "v22.14.0",
  "nodesPerRun": 8,
  "reps": 81,
  "unit": "ms per end-to-end startFlowchartRun",
  "arms": {
    "locked":        { "medianMs": 23.128, "meanMs": 23.187, "minMs": 15.048, "maxMs": 32.441 },
    "control":       { "medianMs": 24.898, "meanMs": 24.864, "minMs": 16.931, "maxMs": 40.452 },
    "lockedControl": { "medianMs": 22.909, "meanMs": 23.217, "minMs": 15.448, "maxMs": 32.486 }
  },
  "medianOfMediansDeltaPct": { "lockedVsControl": -7.11, "noiseFloorLockedVsLocked": -0.95 },
  "pairedDeltaPct":          { "lockedVsControl": -8.06, "noiseFloorLockedVsLocked": -0.92 },
  "acquisitionMs": 0.151,
  "bar": "±5% end-to-end"
}
```

```json
{
  "harness": "two arms in one process, alternating order, fresh state root per rep",
  "node": "v22.14.0",
  "nodesPerRun": 1,
  "reps": 81,
  "unit": "ms per end-to-end startFlowchartRun",
  "arms": {
    "locked":        { "medianMs": 7.401, "meanMs": 7.231, "minMs": 4.734, "maxMs": 10.972 },
    "control":       { "medianMs": 7.464, "meanMs": 7.317, "minMs": 4.699, "maxMs": 10.919 },
    "lockedControl": { "medianMs": 7.373, "meanMs": 7.184, "minMs": 4.892, "maxMs": 11.915 }
  },
  "medianOfMediansDeltaPct": { "lockedVsControl": -0.84, "noiseFloorLockedVsLocked": -0.38 },
  "pairedDeltaPct":          { "lockedVsControl": -0.63, "noiseFloorLockedVsLocked": -0.43 },
  "acquisitionMs": 0.147,
  "bar": "±5% end-to-end"
}
```

A single set on a VM shared with four other slots' test runs is not evidence, so here are all five sets per configuration (locked vs control, %; negative = locked faster):

| set | 8-node median-of-medians | 8-node paired | 1-node median-of-medians | 1-node paired |
|---|---|---|---|---|
| 1 | +0.01 | −0.49 | +2.10 | −0.10 |
| 2 | −1.25 | −2.36 | −0.73 | −1.93 |
| 3 | +2.95 | +3.67 | +0.70 | −1.25 |
| 4 | +0.19 | −2.53 | +2.55 | +0.16 |
| 5 | −7.11 | −8.06 | −0.84 | −0.63 |

The A/A noise floor over the same sets ran −0.95 … +0.98 % (8-node) and −4.52 … +2.06 % (1-node), i.e. the harness's own drift on this VM is as large as the signal. **The measurement that does not depend on that noise** is the acquisition itself: 0.141–0.161 ms, median 0.148 ms, over 200 uncontended acquire+release cycles per set. Against a 7.4 ms single-node run that predicts +2.0 %; against a 23 ms eight-node run, +0.6 %. Both predictions sit inside the observed spread, no set crossed the +5 % bar in the regression direction (largest positive: +3.67 %), and the sign flips between sets — the signature of a fixed 0.15 ms cost buried in noise. **No rollback.**

For scale: R4-1 measured the rejected per-write alternatives at +22.5 % and +17.5 % end-to-end. This buys the clean-delete behaviour those were rejected for, at roughly a thirtieth of the cost, because it is one acquisition per run rather than one per write.

## 5. Pins added

`test/unit/run/run-lifecycle-lock.test.ts` (7):
- a live flowchart run holds the run lock, and teardown releases it
- a resumed flowchart run holds the same lock and releases it
- a crashed run releases the run lock on its way out (and still records `run crashed: …`)
- a run refuses to start while another holder has the run lock, and writes nothing
- a cross-process pause of a live run fails closed rather than racing it *(the disclosed cost)*
- a parent run holds the run lock for its whole run
- source pin: all four call sites route through `withRunLifecycleLock`; `flowchart-run.ts` never rebuilds `runLockPath`; the helper is a thin wrapper over `withExclusiveFileLock`

`test/unit/privacy/deletion.test.ts` (+2): a delete aimed at a live run waits for it, then removes it cleanly (records provably untouched 80 ms in); a delete that cannot outwait a live run fails closed with the records intact, is `LOCK_TIMEOUT` and **not** `RunRecordsSurvivedError`, and is clean on retry once the run has released.

`test/integration/cli/delete.test.ts` (+1): the same at the CLI — `deleteCommand` issued from inside a live run exits 0 with `removed: …` after the run settles, and the run it raced still reports `COMPLETED`.

`test/unit/run/flowchart-run-abort.test.ts` (+1): the flowchart plane records its crash terminal through the shared helper; no private copy survives.

Unchanged and re-verified green: the two decision pins that `append`/`write` do not take the run lock; the existing `RUN_RECORDS_SURVIVED` behaviour and source pins (including the post-release re-verify regex); every R4-4 teardown/flush pin.

## 6. R5-2 coupling (crash terminal)

`src/run/crash-terminal.ts` was present in the tree at **2026-08-24 19:36 UTC** when I censused; I swapped at ~20:10 UTC. `flowchart-run.ts` now imports `recordCrashTerminal` from it and its private `recordCrashTerminal`/`crashReason`/`CRASH_REASON_LIMIT` are deleted. Byte-compatible: the shared default prefix `RUN_CRASH_PREFIX = "run crashed"` yields the identical `run crashed: <bounded message>` reason, the in-flight-only rule (`PLANNING`/`RUNNING` only) is identical, and every failure is still swallowed. All thirteen pre-existing abort pins pass unchanged, including the exact-reason assert. If R5-2's module is rolled back, this import must be rolled back with it — the new source pin in the abort test will fail loudly rather than silently.

R5-2 has also already mirrored `withRunLifecycleLock` into `startSupervisedRun` and `resumeSupervisedRun` (`supervisor.ts:657,751`). I did not edit `supervisor.ts`.

## 7. Cross-slot defect: R5-2 × R5-8, needs the parent

`test/integration/pi-adapter/loopback-cli-resume.test.ts` → "supervised resume overrides a distinct configured default on the HTTP request" **fails at HEAD+working-tree**. Attribution by bisection, not inspection:

- copied `src`, `test`, `scripts` to `/tmp/r51-attrib` (my changes included) → reproduces, 1/2 fail;
- removed **only** R5-2's two `withRunLifecycleLock` wrappers in `supervisor.ts` in that copy, leaving my `flowchart-run.ts`/`coordinator.ts` changes in place → **2/2 pass**.

Mechanism: the fixture starts a supervised run with a `HangingExecutor` to simulate an interrupted run, leaves it live, and then resumes **the same run id in the same process**. With the lifecycle lock the hanging run holds the lock, so the resume waits its full 5 s (the failing subtest's `duration_ms` is 5026) and fails closed. That is the new posture working as designed — the fixture is what is now invalid, because a genuinely interrupted run's process is *gone* and holds no lock.

Ownership: `supervisor.ts` is R5-2's, the test is R5-8's, neither is mine. The clean fix is on the fixture side (settle or cancel-and-await the interrupted run before resuming, so the lock is released the way a dead process would release it); the alternative — supervised resume not taking the lock — would leave the supervised plane with the old destructive-delete behaviour. I flag it here rather than touching either file, per the R4-10 lesson: the pattern I published is what surfaced it, so disclosing the joint is mine.

## 8. Disclosures

1. **`startRun` (M0) was locked too**, beyond the brief's list. Reason in §2. Same file, same posture, and it makes the new error message true.
2. **Two files outside my ownership list got comment/message-only edits**: `src/run/event-store.ts` (its docstring described the lifecycle acquisition as not-yet-taken and living in other modules' files — a documentation lie at HEAD once I landed it) and `src/privacy/deletion.ts` (the parent's brief explicitly asked for the remedy wording). No behaviour in either; `runLockPath`, `EventStore.append`, the double verify, and `RUN_RECORDS_SURVIVED` are all byte-identical in behaviour. `deletion.ts` is owned by no R5 slot.
3. **The pinned substrings in the survivors message are preserved** (`refusing to report the delete as successful`, `Stop or cancel the run before deleting it again`, and the `<runDir>.lock` mention); the added sentences are additive.
4. **A resume of a run id that does not exist now leaves an empty `runtime/runs/` directory** where it previously left nothing. `withExclusiveFileLock` (frozen) does `mkdir -p` on the lock's parent, and resume must acquire *before* it reads — reading first and locking second would let a delete land in between and have the resume rewrite records that were just deleted. No run subtree and no lock file are left, `deleteRunRecords` still treats the run as a no-op, and no test pinned the old behaviour. I chose the empty directory over the privacy hole; the start paths keep the strict "a refused run persists nothing" contract because their pre-flight is outside the lock.
5. **`pauseFlowchartRun` and `injectFlowchartRun` are deliberately unwrapped** — self-deadlock and documented side-channel semantics respectively (§2, rule 2).
6. **`track/loop.ts`'s clarification path writes a whole run's records without the lifecycle lock** (`waitForClarification` builds its own run id and log). Not my file, not in any R5 ownership list, and it already takes the run lock for its questions write. It is now the one CLI-reachable embedder the new error message's "an embedder that does not take the lifecycle lock" clause actually describes. Round 6 candidate; a two-line wrap once someone owns that file.
7. **The 5 s default wait is what "bounded" means for delete.** A long-running production run will still time out a `delete --run`; the operator stops the run and deletes again, exactly as the message says. Tuning that default is a CLI-surface decision, not this slot's.
8. **No new skip.** The only skipped test in anything I ran is the pre-existing `PI_SMOKE=1` provider gate.

## 9. Verification

- `npx tsc --noEmit` whole tree: **clean**, exit 0 (run after every structural change; the tree includes four other slots' in-flight edits).
- `npx eslint` scoped to the eight owned/edited files: **clean**, exit 0.
- Timing-sensitive owned tests **3×** (`run-lifecycle-lock`, `deletion`, `cli/delete`, `flowchart-run-abort`, `m3`, `m2.5`): 133 tests, 133 pass, 0 fail, 0 skip, three consecutive sets.
- Wider sweep (`test/integration` + `test/unit/{run,privacy,track,persist}`): 495 tests, 493 pass, 1 skip (`PI_SMOKE`), **1 fail** — the R5-2 × R5-8 loopback joint of §7, reproduced and attributed to `supervisor.ts` by bisection in an isolated tree copy.
- No full gate (parent's job). No scratch files in the repo: `git status` shows only my edits plus `test/unit/run/run-lifecycle-lock.test.ts` (mine, intended) and `src/run/crash-terminal.ts` (R5-2's). Bench and attribution trees live under `/tmp`.
