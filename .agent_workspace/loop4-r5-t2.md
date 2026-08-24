# R5-2 — Crashed-run settle tails + one `recordCrashTerminal`

Branch `agent/opt-continuous`, no commits by me. Dispatched at HEAD `6975aab`; the shared tree moved
underneath this slot while it ran and is at `27b6745` at report time (R5-1, R5-4, R5-7, R5-8, R5-10
landed in between). Report written 2026-08-24T19:58Z.

**Read this first (cross-slot break I caused):** `test/integration/pi-adapter/loopback-cli-resume.test.ts`
— R5-8's `supervised resume overrides a distinct configured default on the HTTP request` — is RED at
report time because of part (c). One-line remedy, in R5-8's file (not mine to edit), in §3.3.
Everything else in the tree is green.

Owned and touched: `src/run/crash-terminal.ts` (new), `src/run/supervisor.ts` (sole owner),
`src/run/child-coordinator.ts`, `test/integration/m2/supervisor-crash.test.ts`,
`test/integration/m2/resume.test.ts`. Not touched: `src/run/flowchart-run.ts` (R5-1),
`src/cli/main.ts` (R5-9), `test/integration/m2.5/children-flowchart.test.ts` (owned, needed no edit —
its two child-prefix pins already discriminate the extraction, see the mutation table).

## 1. Census before trusting the brief

| Claim in §R5-2 | Verified at dispatch | How |
|---|---|---|
| `crashReason`/`recordCrashTerminal` exist in three files | yes — `flowchart-run.ts:719/738`, `supervisor.ts:226/244`, `child-coordinator.ts:198/386` | read all three |
| the two run-plane copies are byte-identical | yes, character for character including comments | diffed |
| the child copy differs | yes, and in two ways the brief only named one of: prefix `child run crashed:` **and** a different already-settled guard (terminal-event-type check on the child's own log, not a replay) | read |
| the child's `bounded()` and the run planes' inline bound are the same function | yes — both 500 chars with a `…` suffix (`SUMMARY_LIMIT` = `CRASH_REASON_LIMIT` = 500) | read |
| a crashed supervised run leaves its episode bound and no checkpoint | yes — the settle tail sits after `runSupervisorRounds` in both embedders and the rethrow skips it | read + reproduced (new test 4 fails without the fix) |
| R5-1's run-lock acquisition in the tree | **no at 2026-08-24T18:5xZ** (first census: neither `flowchart-run.ts` nor `coordinator.ts` imported `runLockPath`/`withExclusiveFileLock`); **yes at 2026-08-24T19:2xZ** (second census, forced by an unrelated tree change) | `rg runLockPath src/**` twice |

The (c) census is the reason this report has a part (c) at all: the brief's instruction was "mirror if
already in the tree, otherwise census and skip with a timestamp", and the answer flipped mid-slot.

## 2. (a) One `recordCrashTerminal`, three planes

New `src/run/crash-terminal.ts` holds the contract and both recorders. The module doc states the three
frozen properties once (in-flight only, best-effort swallow, caller always rethrows) instead of three
times in three files.

```
crashReason(error, prefix = RUN_CRASH_PREFIX)        // bounded non-empty reason, 500 + "…"
RUN_CRASH_PREFIX = "run crashed"
CHILD_CRASH_PREFIX = "child run crashed"
interface CrashTerminalContext { eventStore: { readAll() }, append, make }
recordCrashTerminal(ctx, error, reasonPrefix?)       // run plane: replay must be PLANNING|RUNNING
recordChildCrashTerminal({ readEvents, appendFailed }, error, reasonPrefix?)  // child plane
```

Two entry points, not one, because the two planes' already-settled guards are genuinely different and
the brief froze both. Making the guard a caller-supplied predicate would have let any caller widen
in-flight-only by passing `() => false`; naming the two guards inside the module keeps the rule where
it can be mutation-tested (M1 below flips five tests across both run planes at once, which the three
copies could never do).

`CrashTerminalContext` is structural on purpose: `FlowchartLoopContext` and `SupervisorContext` both
satisfy it, so migrating a run plane is *delete the private copy, add the import* — the call site
`await recordCrashTerminal(ctx, error);` does not move. That is the one-line swap the brief promised
R5-1, and R5-1 has already taken it: `flowchart-run.ts:32` imports from this module at `27b6745`, and
the parent committed this file as part of R5-1's commit. Its `recordCrashTerminal` copy is gone from
`flowchart-run.ts` with no call-site edit.

Byte-compatibility of the reasons, argued rather than asserted: the run planes' inline bound and the
child's `bounded()` are the same 500-char/`…` function, and the only difference between the three
`crashReason`s was the literal prefix, which is now the parameter. Reason strings are unchanged on all
three planes; the existing exact-string pins in `children-flowchart.test.ts` (`run crashed: profile
lookup failed for tester`, `child run crashed: profile lookup failed for tester`) and in
`supervisor-crash.test.ts` (`/^run crashed: judge exploded$/`) are green untouched.

`TERMINAL_CHILD_EVENT_TYPES` moved with the child recorder and is module-private (no consumer outside
it; an exported-but-unused const is the dead surface R5-10 is deleting elsewhere this round).

## 3. (b) The supervised crash path settles

### 3.1 What changed

The two embedders had byte-identical settle tails after `runSupervisorRounds`. Both now go through one
`finishSupervisedRun(ctx, status)` (behaviour-preserving extraction: same calls, same order, same
arguments) reached via `runAndSettleSupervisedRun`, whose `catch` runs `settleCrashedSupervisedRun(ctx)`
and rethrows the original error.

`settleCrashedSupervisedRun` re-reads the log and settles against the status that log actually replays,
rather than a status passed in. That matters for honesty: after a crash the log reads `FAILED` because
`runSupervisorRounds` just recorded the crash terminal, so the episode closes `FAILED` and the
checkpoint reads `FAILED`; after a crash on a log that got **no** terminal (already `CANCELLED`,
`BLOCKED`, settled) the settle follows that state instead. The in-flight-only rule is not widened
anywhere — it is what decides which of those two cases you are in.

Two nested swallows, not one: the episode half and the checkpoint half each swallow their own failure,
so an episode that will not close does not also cost the checkpoint. Pinned in both directions (tests 6
and 7 below).

Scope of the wrap: from `runSupervisorRounds` through the tail. A crash *before* the rounds (e.g.
`discoverProject` or `bindEpisodeToRun` throwing) is outside it, deliberately — at that point there is
no bound episode to close and nothing but a `PLANNING` log to checkpoint. Stated as a residual, not
silently.

### 3.2 Pins added and changed (`test/integration/m2/supervisor-crash.test.ts`)

New:
- **a crashed supervised run closes its episode and leaves a FAILED checkpoint** — episode snapshot
  reads `FAILED`, `EPISODE_CLOSED` is on the run log, `CheckpointStore.read().status === "FAILED"`,
  replay reports no anomalies. This is the brief's asked-for pin.
- **a crashed supervised resume settles the same way** — same three assertions through
  `resumeSupervisedRun`, over a hand-seeded in-flight run (bound episode, graph accepted, no terminal);
  a run started with an exploding judge cannot reach that state, so the seed is the only way to reach
  the resume embedder's crash path.
- **a settle whose checkpoint cannot be written still closes the episode** — the judge creates a
  directory where `checkpoint.json` belongs (the atomic publish cannot rename over it) before throwing;
  the episode still closes and the original `judge exploded` still reaches the caller.
- **a settle whose episode cannot be closed still writes the checkpoint** — the judge appends a corrupt
  line (plus a following line, so it is not the recoverable torn tail) to the episode *snapshot* log
  before throwing; no `EPISODE_CLOSED`, checkpoint still `FAILED`, original error still rethrown.

Changed, and this is a disclosure: two existing asserts read `events.at(-1)?.type === "RUN_FAILED"`
("the crash terminal is the last event in the log"). The crash settle appends `EPISODE_CLOSED` after
the terminal, exactly as the non-crash tail always has, so that assert now pins the wrong thing. Both
became `afterTerminal(events)` — the list of event types recorded after the terminal — asserted to be
exactly `["EPISODE_CLOSED"]`. That keeps the property the asserts were for (no round-mate appending
after the terminal; the crash unwind waits for the round) and is strictly sharper than the old form: it
names *what* may follow rather than only that nothing does. The exactly-one-terminal assert
(`TERMINAL_TYPES` filter length 1) and the `replayRun(...).anomalies` deep-equals are untouched and
green; `EPISODE_CLOSED` after a terminal is not an anomaly by `replay.ts`'s rules and never has been.

### 3.3 (c) Run-lock mirror, and the R5-8 joint

R5-1's pattern is in the tree at `27b6745`: `withRunLifecycleLock(stateRoot, runId, body, options?)`
exported from `coordinator.ts`, consumed by `startFlowchartRun`, `resumeFlowchartRun` and
`startParentRun`. `startSupervisedRun` and `resumeSupervisedRun` now mirror it, with a
`runLock?: FileLockOptions` on `SupervisorDeps` matching the two other embedders' option. No import
cycle (`coordinator.ts` does not reference `supervisor.ts`); no re-entrant acquisition on the supervised
path (nothing inside a supervised run takes the run lock — `settleBoundEpisode` takes the *episode*
lock, the track-questions writer runs on its own separate run id, and the CLI's supervised resume takes
no lock of its own).

New pin, `test/integration/m2/resume.test.ts`: **a resume refuses a run this process is still driving**
— a live supervised run holds the lock, a resume of the same run with `runLock: { timeoutMs: 50 }`
rejects, discriminated on `LOCK_TIMEOUT_CODE` (code, never a message match).

The mirror invalidates a fiction two kinds of test relied on: "simulate process death by abandoning a
live in-process handle, then resume the same run id". An abandoned handle is still live, so it still
holds the lock, so the resume waits its bounded wait and fails closed — which is precisely what the
lock is for. Two tests in my own `resume.test.ts` now finish the fiction by removing the lock file the
dead process would have left behind (`simulateProcessDeath`), documented as the operator remedy R5-1's
sign-off already names, and safe against the abandoned run's own later release because
`withExclusiveFileLock` only unlinks a lock whose owner token is still its own.

**R5-8's `loopback-cli-resume.test.ts` uses the same fiction and is RED for the same reason** (it hangs
5027 ms on the acquisition, then the CLI resume fails and `resumed (BLOCKED)` never prints). I did not
edit it — not my file. The remedy is the two lines above, applied after `waitForTaskRunning`:

```ts
import { rmSync } from "node:fs";
import { runLockPath } from "../../../src/run/event-store.js";
// after waitForTaskRunning(stateRoot, interrupted.runId):
rmSync(runLockPath(stateRoot, interrupted.runId), { force: true });
```

Verified equivalent in my own suite: the same two lines are what took my two resume tests from RED
(5 s lock timeout each, 186 s suite) back to green (543 ms suite). R5-8, R5-1 and the parent should
treat this as the R4-6×R4-10 joint of this round: a lifecycle-lock slot changes what "abandon a handle
and resume in-process" means for every test that models a crash that way.

No bench: this slot adds no acquisition R5-1 did not already price — the supervised embedders are not
CLI-reachable for `run` (only `resume --supervised` is) and the cost is R5-1's measured once-per-run
acquisition, on one more plane. `EventStore.append` and `CheckpointStore.write` remain lock-free; their
decision pins are untouched.

## 4. Verification

- `npx tsc --noEmit` on the whole tree: clean.
- `npx eslint` on the five owned files: clean.
- Timing-sensitive owned tests 3×: `m2/resume.test.ts` + `m2/supervisor-crash.test.ts` +
  `m2.5/children-flowchart.test.ts` → 18/18 pass each time (557 ms / 420 ms / 475 ms).
- `test/integration/m2/**` + `test/integration/m2.5/**` + `test/unit/run/**`: 194/194 pass.
- Whole suite (`node scripts/run-tests.mjs`, not required of me, run because the tree is shared):
  **1725 tests, 1723 pass, 1 fail, 1 skipped.** The fail is R5-8's, described above. The skip is the
  usual `PI_SMOKE=1` real-provider gate — I introduced no skip. For reference the same command on the
  same tree with only my three then-existing files reverted was 1705/1704/1 skipped, i.e. the tree had
  already grown by other slots' work well past the brief's 1680 baseline.

Mutation table (each mutation applied, tested, reverted):

| Mutation | Result |
|---|---|
| in-flight guard in shared `recordCrashTerminal` → always record | RED ×5: both supervised settled-log tests **and** three flowchart-plane tests (`flowchart-run-abort`) — one guard, both planes |
| drop `settleCrashedSupervisedRun(ctx)` from the crash path | RED ×6: all four new settle pins plus the two `afterTerminal` asserts |
| drop the inner (episode) swallow, keeping the outer | RED ×1: `a settle whose episode cannot be closed still writes the checkpoint` — the two-swallow split is load-bearing, not decoration |
| drop `withRunLifecycleLock` from `resumeSupervisedRun` | RED ×1: `a resume refuses a run this process is still driving` (and the suite jumps to 180 s as the resume interleaves with the live run — the interleaving the lock exists to stop) |
| child prefix `CHILD_CRASH_PREFIX` → `"run crashed"` | RED ×1: `an error escaping a node closes both the run's log and the crashed child's` — the prefix parameter is pinned exactly, on both halves |

## 5. Frozen contracts held

- `recordCrashTerminal` in-flight-only (`PLANNING`/`RUNNING`) — reproduced verbatim in one place,
  widened nowhere; M1 proves it is the live rule on both run planes.
- Best-effort swallow and unconditional rethrow on all three planes.
- Exactly-one-terminal pins, including the shared-child-log case (`children-flowchart.test.ts` green
  untouched) and the supervised `TERMINAL_TYPES` count.
- `applyRetry` remains the sole BLOCKED→READY producer; `planRound` still 4-arg; `LeaseRegistry.restore`
  pins untouched. No status literals added.
- `preserveResumableState` and the no-terminal rule for paused/waiting/blocked logs: untouched (R5-1's
  file).
- `EventStore.append` / `CheckpointStore.write` stay lock-free; `runLockPath` no-steal posture consumed
  as published, not reshaped.
- No `package.json`, no `persist/` edit, no live R1, no new event type, no schema change.

## 6. Residuals for the next round

1. **The pre-rounds crash window.** A supervised run that dies inside `discoverProject`,
   `bindEpisodeToRun` or the opening appends gets neither a crash terminal nor a settle. It leaves at
   most a `PLANNING` log with no episode to close. Cheap to widen; I left it alone because widening the
   wrap is also widening what "crashed run" means, and the brief froze that.
2. **`settleSupervisedOutcome` is not called on the crash path.** It is a no-op without a
   `trackingAssessment`, and neither embedder supplies one, so calling it would be dead code today. If a
   supervised embedder ever passes an assessment, the crash path needs it too.
3. **The handle API vs. the lock.** `startSupervisedRun`/`resumeSupervisedRun` return a handle whose
   `done` a caller may abandon; the lock is released only when `done` settles. In-process, an abandoned
   handle blocks every other writer for that run until the process exits. Production (CLI) always awaits,
   so this is a test-shaped hazard — but it is the hazard that broke R5-8's test, and any future slot
   writing "start a run, abandon it, do something else to that run" will meet it.
4. **`crash-terminal.ts` is now a two-recorder module.** If a fourth plane appears, resist adding a
   third recorder before checking whether its guard is really new.
