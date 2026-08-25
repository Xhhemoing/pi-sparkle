[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 4 · R4-1 — A run-scoped cooperative lock, and the two writers that measurably cannot take it

Slot: R4-1 (P0, privacy/correctness). Branch `agent/opt-continuous`, working tree only — **not committed** (per instruction). Base HEAD `edb235b`.

## What shipped, in one line

`runtime/runs/<runId>.lock` exists, `deleteRunRecords` holds it across `rm` + verify and then **verifies a second time after releasing it**, `requestPause` and the track-questions write take it, and the two per-step writers (`EventStore.append`, `CheckpointStore.write`) do **not** — because measuring them says they cost +22.5% and +17.5% end-to-end against the brief's 5% bar. The adversarial leak the brief cited (~6/30 deletes returning success over resurrected records) is **0/30 for every writer shape**, and it is the second verify, not the lock, that closes it.

## The lock

`runLockPath(stateRoot, runId)` → `runtime/runs/<runId>.lock`, exported from `src/run/event-store.ts` (mirroring `episodeLockPath` living in `episode-bind.ts`: the plane's primary writer module owns the path template, so both sides cannot drift onto different files). It sits **beside** the run directory, never inside it — a lock file inside the subtree would be removed out from under its own holder by the `rm` it is guarding. Posture is the episode lock's, unchanged: `withExclusiveFileLock`, bounded wait, fail closed on timeout, **no stealing**. `file-lock.ts` was not touched.

| Writer | Takes the lock | Why |
|---|---|---|
| `deleteRunRecords` | yes, across `rm` + verify | the point of the round |
| `createFilePauseController.requestPause` | yes | writes `pause.json`, which creates the run directory; not on any hot path |
| `startTrackedRun`'s `track-questions.json` | yes | same, plus it now goes through `writeFileAtomic` |
| `clearPause` | no | an `unlink` cannot recreate the directory; taking the lock would make a *clear* create `runtime/runs/` |
| `token()` / `CheckpointStore.read` | no | published by rename, so a reader sees whole files |
| `EventStore.append` | **no — measured** | +372%/append, +22.5% e2e |
| `CheckpointStore.write` | **no — measured** | +62%/write, +17.5% e2e |

### `EventStore`'s queue vs. the lock (the brief asked for this to be documented, and it is, on the class)

They are different guarantees and only one of them is cheap. `queue` is in-process FIFO **ordering** for one instance — concurrent `append` calls land in call order and never interleave, for the price of one promise link; it says nothing about another `EventStore`, another process, or a delete. `runLockPath` is cross-writer **exclusion**. The lock was implemented inside the queue (so a store never has more than one acquisition outstanding), benchmarked, and rolled back per the brief's ≥5% rule. The docstring on `EventStore` states all of it including what the rollback leaves open, and `test/unit/run/event-store.test.ts` carries a decision pin (`append does not block on the run lock`) so a future re-introduction has to argue with a failing test rather than slip in.

### `deleteRunRecords`: the lock is not what makes it honest

Holding the lock across `rm` + verify closes the window against writers that take it. It does nothing about `EventStore.append`, which does not. So the delete verifies **twice**: once under the lock, once after releasing it (`if (removed.length > 0) await verifyRunRecordsRemoved(...)`, one `readdir` on an absent directory). Releasing a lock is itself two I/O turns, and an appender can use them; the second verify is what makes the returned `DeletionResult` a claim about the moment the call returns instead of the moment it let go. `RunRecordsSurvivedError` is kept, and its remedy text now names the lock and says which writers do not take it, so an operator reading the message knows the survivors mean *a live run*, not a broken delete.

Two smaller properties, both tested: nothing on disk for the run (no records **and** no lock) is a genuine no-op — no lock is created just to delete from an empty plane, matching `unlinkEpisodeFiles`; and a lock present with no records still means a live writer, so it is waited on and whatever that writer leaves is then removed. The presence check is re-done inside the lock because the pre-check is stale in both directions by then.

### Also in scope, done

- `src/track/loop.ts:254` — `mkdir` + plain `writeFile` of `track-questions.json` → `writeFileAtomic` under the run lock (R3-2 precedent; the file holds the objective and is scanned for residual episode text, so a torn write is a real failure mode).
- `src/privacy/deletion.ts` — R4-7's `writeFeedbackTombstones` **had landed at HEAD**, so `cascadeFeedbackTombstones` now calls it instead of its own `mkdir` + `writeFile`. Both writes in that cascade are crash-atomic now, and the doc says so.

## Bench (this VM, Node v22.14.0) — the rollback evidence

Harness: both arms loaded into **one process** via `tsx`, arm order **alternated every rep** so "second in the rep" bias cancels, rep 0 discarded as warm-up, medians of 9 reps. Per rep: 500 `EventStore.append`, 200 `CheckpointStore.write`, 5 end-to-end `startFlowchartRun` fake-executor runs (fork/join flowchart, 4 nodes). Baseline arm is a clean worktree at `edb235b`; the locked arms are that worktree plus the shipped diff plus the rolled-back acquisitions, gated by env var so all three variants come from one tree.

**The control matters as much as the treatment.** The shipped tree's `append` and `write` are byte-identical to baseline (doc comments plus one new export), so any delta on those metrics is pure harness noise — which is how the numbers below are calibrated: an unchanged hot path reads between -0.1% and +7% on this VM.

```json
[
  {"arm":"shipped vs baseline (run 1)","ok":true,"reps":9,"appendsPerRep":500,"checkpointsPerRep":200,"runsPerRep":5,"medians":{"baseline":{"eventAppendMs":22.605,"eventAppendPerOpMs":0.045,"checkpointWriteMs":72.421,"checkpointWritePerOpMs":0.362,"e2eRunMs":63.987,"e2eRunPerRunMs":12.797},"working":{"eventAppendMs":22.81,"eventAppendPerOpMs":0.046,"checkpointWriteMs":77.496,"checkpointWritePerOpMs":0.387,"e2eRunMs":66.635,"e2eRunPerRunMs":13.327}},"deltaPct":{"eventAppendMs":0.9,"checkpointWriteMs":7,"e2eRunMs":4.1},"rawE2eMs":{"baseline":[64.922,62.868,63.988,63.987,66.161,72.47,60.632,63.177,60.297],"working":[62.393,66.744,69.875,69.665,64.914,66.635,68.753,61.062,57.237]}},
  {"arm":"shipped vs baseline (run 2)","ok":true,"reps":9,"appendsPerRep":500,"checkpointsPerRep":200,"runsPerRep":5,"medians":{"baseline":{"eventAppendMs":22.364,"eventAppendPerOpMs":0.045,"checkpointWriteMs":79.201,"checkpointWritePerOpMs":0.396,"e2eRunMs":68.568,"e2eRunPerRunMs":13.714},"working":{"eventAppendMs":23.202,"eventAppendPerOpMs":0.046,"checkpointWriteMs":84.339,"checkpointWritePerOpMs":0.422,"e2eRunMs":68.479,"e2eRunPerRunMs":13.696}},"deltaPct":{"eventAppendMs":3.7,"checkpointWriteMs":6.5,"e2eRunMs":-0.1},"rawE2eMs":{"baseline":[67.197,62.412,72.985,68.568,71.673,68.834,75.506,67.648,61.196],"working":[66.499,68.479,66.814,70.109,62.745,69.97,72.456,67.552,68.753]}},
  {"arm":"control: locked-variant tree with both acquisitions compiled out","ok":true,"reps":9,"appendsPerRep":500,"checkpointsPerRep":200,"runsPerRep":5,"medians":{"baseline":{"eventAppendMs":21.699,"eventAppendPerOpMs":0.043,"checkpointWriteMs":72.754,"checkpointWritePerOpMs":0.364,"e2eRunMs":62.086,"e2eRunPerRunMs":12.417},"working":{"eventAppendMs":22.838,"eventAppendPerOpMs":0.046,"checkpointWriteMs":74.714,"checkpointWritePerOpMs":0.374,"e2eRunMs":62.716,"e2eRunPerRunMs":12.543}},"deltaPct":{"eventAppendMs":5.2,"checkpointWriteMs":2.7,"e2eRunMs":1},"rawE2eMs":{"baseline":[62.086,71.145,68.754,60.082,65.42,60.548,58.614,59.747,63.195],"working":[69.686,59.834,62.716,65.605,64.739,59.403,66.086,48.058,53.169]}},
  {"arm":"EventStore.append takes the run lock (rolled back)","ok":true,"reps":9,"appendsPerRep":500,"checkpointsPerRep":200,"runsPerRep":5,"medians":{"baseline":{"eventAppendMs":21.706,"eventAppendPerOpMs":0.043,"checkpointWriteMs":77.677,"checkpointWritePerOpMs":0.388,"e2eRunMs":63.529,"e2eRunPerRunMs":12.706},"working":{"eventAppendMs":102.488,"eventAppendPerOpMs":0.205,"checkpointWriteMs":78.369,"checkpointWritePerOpMs":0.392,"e2eRunMs":77.85,"e2eRunPerRunMs":15.57}},"deltaPct":{"eventAppendMs":372.2,"checkpointWriteMs":0.9,"e2eRunMs":22.5},"rawE2eMs":{"baseline":[63.404,64.637,62.183,72.887,64.413,58.639,54.674,63.529,67.937],"working":[82.084,71.449,76.737,73.429,77.85,72.294,83.886,78.384,78.149]}},
  {"arm":"CheckpointStore.write takes the run lock (rolled back)","ok":true,"reps":9,"appendsPerRep":500,"checkpointsPerRep":200,"runsPerRep":5,"medians":{"baseline":{"eventAppendMs":21.534,"eventAppendPerOpMs":0.043,"checkpointWriteMs":83.601,"checkpointWritePerOpMs":0.418,"e2eRunMs":62.907,"e2eRunPerRunMs":12.581},"working":{"eventAppendMs":22.923,"eventAppendPerOpMs":0.046,"checkpointWriteMs":135.613,"checkpointWritePerOpMs":0.678,"e2eRunMs":73.919,"e2eRunPerRunMs":14.784}},"deltaPct":{"eventAppendMs":6.5,"checkpointWriteMs":62.2,"e2eRunMs":17.5},"rawE2eMs":{"baseline":[70.182,65.785,73.029,63.714,61.328,60.772,57.087,62.907,56.767],"working":[71.573,84.791,76.59,75.866,60.215,73.919,81.916,66.904,62.112]}},
  {"arm":"both per-step writers take the run lock (rolled back)","ok":true,"reps":9,"appendsPerRep":500,"checkpointsPerRep":200,"runsPerRep":5,"medians":{"baseline":{"eventAppendMs":21.909,"eventAppendPerOpMs":0.044,"checkpointWriteMs":84.512,"checkpointWritePerOpMs":0.423,"e2eRunMs":65.77,"e2eRunPerRunMs":13.154},"working":{"eventAppendMs":101.302,"eventAppendPerOpMs":0.203,"checkpointWriteMs":126.758,"checkpointWritePerOpMs":0.634,"e2eRunMs":83.588,"e2eRunPerRunMs":16.718}},"deltaPct":{"eventAppendMs":362.4,"checkpointWriteMs":50,"e2eRunMs":27.1},"rawE2eMs":{"baseline":[64.936,67.454,70.546,69.027,58.43,49.772,67.19,65.77,53.517],"working":[91.259,77.438,78.583,82.933,87.921,91.158,82.812,83.588,87.075]}}
]
```

Reading it: an acquisition costs ~0.16 ms, which is exactly the Round 2 figure the brief quoted — the problem is not the lock, it is that an unlocked append is ~0.043 ms, so the lock is **four appends' worth of work per append**. On a per-step writer that lands as +22.5% (append) and +17.5% (checkpoint) end-to-end, +27.1% together, against a 5% bar and a noise floor of a few percent. Rolled back on both, per the brief's rule. The shipped tree reads +4.1% and -0.1% on two runs of a hot path that is byte-identical to baseline — i.e. zero, measured twice.

## Adversarial probe — the actual R4-1 acceptance number

Throwaway probe: 300 files under the run directory (so the recursive removal spans several event-loop turns), a tight-loop writer running for the whole delete, 30 attempts per writer shape. `leaked` = **`deleteRunRecords` returned a `DeletionResult` while `runtime/runs/<id>/` was on disk at the moment it returned** — the failure the round exists to kill. `refused` = `RunRecordsSurvivedError`. `clean` = returned with the directory gone.

```json
{
  "baselineHEAD_edb235b": [
    {"writer":"event","attempts":30,"clean":5,"leaked":5,"refused":20},
    {"writer":"checkpoint","attempts":30,"clean":27,"leaked":2,"refused":1},
    {"writer":"mixed","attempts":30,"clean":9,"leaked":0,"refused":21},
    {"writer":"raw mkdir+append","attempts":30,"clean":11,"leaked":5,"refused":14}
  ],
  "shipped": [
    {"writer":"event","attempts":30,"clean":0,"leaked":0,"refused":30},
    {"writer":"checkpoint","attempts":30,"clean":0,"leaked":0,"refused":30},
    {"writer":"mixed","attempts":30,"clean":0,"leaked":0,"refused":30},
    {"writer":"raw mkdir+append","attempts":30,"clean":0,"leaked":0,"refused":30}
  ],
  "rejectedVariant_perStepWritersAlsoLock": [
    {"writer":"event","attempts":30,"clean":30,"leaked":0,"refused":0},
    {"writer":"checkpoint","attempts":30,"clean":30,"leaked":0,"refused":0},
    {"writer":"mixed","attempts":30,"clean":30,"leaked":0,"refused":0}
  ]
}
```

**120/120 leak-free, and I want to be precise about what bought it.** Not the lock — the second verify. Against a writer that does not take the lock, the lock cannot prevent the resurrection; verifying after release is what stops the delete reporting it as a removal. The lock's contribution on the shipped tree is that `requestPause` and the track-questions write can no longer cause a refusal at all.

**What the third block costs and buys, stated plainly:** locking the per-step writers turns every one of those refusals into a clean delete — 90/90 — because the delete then genuinely waits for the run. That is the +27.1%. So the shipped posture is: *a delete racing a live run refuses, every time, instead of sometimes lying;* a delete of a stopped run removes and returns. The error message names the remedy ("stop or cancel the run before deleting it again"), which is the same remedy the brief assumed. Buying the clean-delete convenience cheaply means **one acquisition per run** taken by the run lifecycle (`coordinator.ts` / `flowchart-run.ts`) rather than one per write — other slots' files, and a posture change ("a delete waits for a live run; a killed run leaves a lock an operator must clear"), so it is disclosed below rather than done here.

## Tests (+15, all owned files)

`test/unit/privacy/deletion.test.ts` (43 pass) — the delete side: waits for a live lock holder then reports the removal; fails closed with `LOCK_TIMEOUT_CODE` and removes **nothing** when the lock cannot be taken; waits on a lock with no records and removes what that writer wrote; leaves no lock behind and does not list one in `removedPaths`; a run with nothing on disk creates neither directory nor lock; the lock path is the writers' path (`runLockPath` pin). The pre-existing "recreated by a live writer fails loudly" test now also asserts the returning case — a delete that *does* return has the directory gone — which is the second verify's pin. New: `a live run's own writers cannot make a delete report a removal it lost`, driving a real `EventStore` + `CheckpointStore` pair.

`test/integration/cli/delete.test.ts` (11 pass) — `delete --run` waits for whoever holds the lock, then reports the removal, through the CLI.

`test/unit/run/pause-controller.test.ts` (10 pass) — `requestPause` waits on the lock then writes; a pause that cannot take it fails closed and writes nothing; `token`/`clearPause` do not take it; clearing a pause for an absent run creates neither directory nor lock.

`test/unit/run/event-store.test.ts` (10) / `checkpoint-store.test.ts` (6) — the lock path's location, and the two decision pins asserting the hot paths do **not** block on the lock, each carrying the measurement in its docstring so the pin is falsifiable rather than dogmatic.

## Verification (this VM, Node v22.14.0)

- `npx tsc --noEmit` → exit 0, zero diagnostics.
- `npx eslint src test` → clean.
- Owned suites 3× consecutive (deletion unit, pause-controller unit, CLI delete integration): identical 43 / 10 / 11 pass, 0 fail each time — no flake in the timing-sensitive lock tests.
- Writers' suites: event-store 10, checkpoint-store 6, track-loop integration 4 — all pass.
- Whole tree (`node scripts/run-tests.mjs`): **1680 tests, 1678 pass, 1 fail, 1 skip**. The single failure is `test/integration/pi-adapter/loopback-cli-resume.test.ts:172` (asserts empty stderr, receives R4-6's new resume warning); **it fails identically at baseline `edb235b`** in the clean worktree, so it is not this slot's.

## Scope discipline

Files touched: `src/run/event-store.ts`, `src/run/checkpoint-store.ts`, `src/run/pause-controller.ts`, `src/track/loop.ts`, `src/privacy/deletion.ts`, `test/unit/privacy/deletion.test.ts`, `test/integration/cli/delete.test.ts`, `test/unit/run/{event-store,checkpoint-store,pause-controller}.test.ts` — all exclusive to this slot. Forbidden list respected: no `file-lock.ts` edit (used as published), no `jsonl` signature change (`appendJsonlLine`'s ENOENT recovery is left exactly as it is and is the mechanism the docs point at), no live R1, no Outcome-supported claim, **no commit, no branch change**. `createFilePauseController` and `deleteRunRecords` gained an optional trailing `FileLockOptions` parameter each — additive, defaulted, every existing call site unchanged. The bench and probe scripts are throwaways under `/tmp`, not added to the repo.

## Residual risk / follow-ups (disclosed, not done)

1. **A delete racing a live run always refuses now** (0 clean out of 120 under an adversarial tight loop). That is the correct fail-closed direction and the error names the remedy, but it is a real operator-experience change from "usually succeeds, occasionally lies". The fix that makes it succeed honestly is the per-run acquisition in the run lifecycle, above — Round 5 material, and it needs a posture decision about killed runs leaving locks.
2. **The last window cannot be closed from the delete side.** A write landing after the final verify is a new fact, not a resurrection — the same posture the shared invocation log already documents. Only a lock the appender takes closes it, and that is what the bench rejected.
3. **No-steal means a killed holder blocks pauses, track-question writes and deletes** for that run until an operator clears the lock. Identical to `delete --episode`; `doctor` inventories run locks with age and PID, so it is diagnosable, but it is a new way for a delete to fail.
4. **`runLockPath` lives in `event-store.ts`, whose own `append` does not take it.** It reads oddly and the docstring says why (path template beside the plane's primary writer, exactly like `episodeLockPath`). If the run plane grows a `run-lock.ts`, this is the first thing to move.
