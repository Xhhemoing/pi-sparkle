[Model: claude-opus-5-thinking-high-fast]
# Loop 4 Round 2 — R2-1 report (flowchart run-level abort)

Scope: `src/run/flowchart-run.ts`, `test/integration/m2.5/flowchart-run.test.ts`,
`test/integration/m2.5/children-flowchart.test.ts`, new `test/unit/run/flowchart-run-abort.test.ts`.
No other file touched. No protocol shape change, no new event type, no signature change to any
frozen contract, no commit.

## The defect, restated from evidence

`flowchart-run.ts` built three `AbortController`s and `rg '\.abort\(' src/run/flowchart-run.ts`
returned nothing, so the run-level signal was inert in both directions:

1. The thin-executor path never even received it — `executeRemainingRunningNodes` called
   `executeFlowchartNode` without `signal`, and that helper falls back to
   `new AbortController().signal`, a controller nobody can ever fire.
2. Nothing called `ChildRunHandle.cancel()`, so T6's durable per-child cancel (queued and
   between-attempts windows) had no caller on the flowchart path.
3. An error escaping mid node left the children started for that node running with nobody awaiting
   them: `executeClusteredNode` spawns peers through the cluster `onSpawn` hook and only drains them
   *after* `await handle.done`, so a throw in that window orphans every live peer.

## Change

New module-private `RunAbortScope` replaces the bare `AbortController` in the loop context:

- owns the run's `AbortController` (the signal handed to `ChildCoordinator.startChildTask` and now
  also to `executeFlowchartNode`);
- tracks every child handle it hands out (`track`), forgetting each one as it settles;
- `cancelAndSettle()` aborts the signal, calls `cancel()` on every handle still in flight, and waits
  for them to settle. Both halves are needed: the signal stops a live attempt, `handle.cancel()`
  covers the queued and between-attempts windows where no attempt controller exists. It loops until
  nothing is live because a child can spawn peers while it unwinds.

Call sites:

| Where | Behavior |
|---|---|
| `persistFailed` | cancel + settle **before** the `RUN_FAILED` append — stop paying, then record |
| `pauseIfRequested` | cancel + settle before `PAUSE_REQUESTED` is written |
| `finish` | terminal teardown for every status (COMPLETED / BLOCKED / WAITING_FOR_USER / FAILED / PAUSED), before the final checkpoint |
| `withRunTeardown` | wraps `runFlowchartLoop` in `startFlowchartRun` and the resume prologue+loop; an escaping error tears down and rethrows unchanged |
| `attachChildRuntime.onSpawn` | tracks each spawned peer, and refuses to start a new peer once the scope is aborted |
| `executeClusteredNode` | tracks the node's child handle |
| `executeRemainingRunningNodes` | passes `signal: ctx.abort.signal` into `executeFlowchartNode` |

The resume tail (unpause / terminal short-circuit / approval / pending results, then the loop) moved
verbatim into `resumeRestoredRun(ctx, continuation)` so it can sit inside `withRunTeardown`; the only
edits inside it are `deps.*`/local reads rewritten to the identical `ctx.*` fields
(`ctx.pause ?? createFilePauseController(ctx.stateRoot, ctx.now)`, `ctx.eventStore`, `ctx.runId`,
`ctx.definition`). No ordering or condition changed.

Public surface unchanged: `startFlowchartRun`, `resumeFlowchartRun`, `pauseFlowchartRun`,
`injectFlowchartRun`, `FlowchartRunOutcome`. `RunAbortScope` is not exported.

## Tests (owned files only)

`test/unit/run/flowchart-run-abort.test.ts` (new, 4 tests) — a `RecordingExecutor` keeps the signal
handed to every `execute` call, which is exactly what a live provider call would be cancelled with;
an in-memory `FakePauseController` lets a pause land mid-run with no disk and no timers:

1. failed run → the node executor's signal is aborted;
2. completed 2-node run → both node signals aborted at teardown;
3. a pause raised *while* node `first` is executing → status `PAUSED`, `PAUSE_REQUESTED` recorded,
   the run signal aborted, and `second` is never launched (executor task ids are exactly
   `["tsk_first"]`);
4. a `childTasks` run → the signal the `ChildCoordinator` composed for the child attempt
   (`AbortSignal.any([parentSignal, attemptController.signal])`) is aborted by teardown, i.e. the
   abort really reaches a child, not just the parent.

`test/integration/m2.5/children-flowchart.test.ts` (+1 test, existing test untouched) — the real
orphan window. A `worker` child spawns two peers: a `reviewer` that keeps running until aborted and a
`tester` whose profile throws when its prompt is built (a registry double: `resolve("tester")` returns
a profile whose `systemInstruction` getter throws), so the peer's `runTask` rejects. The parent child
waits for the reviewer to actually enter its executor before finishing, so the ordering is
deterministic without timers. The rejected peer makes `drainSpawnedChildren`'s `Promise.all` reject,
the error escapes the node, and the assertions are: `startFlowchartRun` rejects with the launch
error, the live peer observed the abort, and exactly one child run log ends in
`RUN_CANCEL_REQUESTED`.

`test/integration/m2.5/flowchart-run.test.ts` (+2 tests, 10 existing untouched and green):

- cost-exhausted run (`remainingCostUsd 0.6`, two premium nodes) → `FAILED`, the unaffordable node is
  never launched, and the signal node `a` ran on is aborted — a second failure mode (limit
  exhaustion, not node failure) reaching the same teardown;
- in-budget 2-node run → `COMPLETED` and no node was ever launched on an already-aborted signal
  (`abortedAtLaunch === [false, false]`), pinning that teardown does not bleed into normal runs.

## Verification

- Owned tests: `node --test --import tsx test/integration/m2.5/flowchart-run.test.ts
  test/integration/m2.5/children-flowchart.test.ts test/unit/run/flowchart-run-abort.test.ts`
  → **18 tests / 18 pass / 0 fail**, run three times, stable.
- Whole-tree `pnpm exec tsc --noEmit`: clean.
- `pnpm exec eslint` on the four owned files: clean.
- Negative check (do the tests catch the old behavior?): `src/run/flowchart-run.ts` was temporarily
  replaced with the `HEAD` version and restored immediately after. All 4 unit tests fail
  (`aborted` is `false` everywhere), and the new integration test fails on the peer abort **and**
  the whole file then times out at 20 s — the orphaned peer keeps the event loop alive, which is the
  money-spending leak itself. The pre-existing tests in both integration files pass identically
  before and after the change.
- Not run, per instructions: `pnpm gate`, full `pnpm test`.

Extra safety check (not required, disclosed): the non-owned consumers of `flowchart-run.ts` were run
read-only because the resume/pause paths were touched — `test/integration/m2.5/resume.test.ts`,
`test/integration/m3/pause-inject.test.ts`, `test/unit/run/flowchart-learned-routing.test.ts`,
`test/integration/m2.5/cli-contract-honesty.test.ts` (12 pass) and `test/integration/cli/cli.test.ts`
+ `test/integration/cli/commits.test.ts` (31 pass). No file outside my ownership was edited.

## Disclosures

- **Reachability, stated honestly.** The loop awaits every child it starts, so at a normal terminal
  point (COMPLETED / BLOCKED / WAITING_FOR_USER / FAILED / PAUSED) nothing is usually still live; for
  those paths the fix means the run-level signal is now genuinely fired instead of being dead, and
  a child that *is* still live gets cancelled. The one window where children are demonstrably
  orphaned today is an error escaping between `startChildTask` and the drain — that is the window the
  new integration test exercises, and it is the only one where the old code hangs.
- `RunAbortScope.track` attaches a settle handler to `handle.done`. For a peer whose rejection is
  dropped on the floor (e.g. a second rejection after `Promise.all` already rejected) this now
  absorbs what would previously have been an unhandled rejection. That trades a possible process
  crash for a silent drop; the first rejection still propagates and fails the run.
- A spawn requested after teardown is refused rather than started-and-immediately-cancelled. The
  requesting child is itself being cancelled at that point, so no work is lost, but the drop is
  silent (no event).
- A run that dies by escaping error still writes no `RUN_FAILED`, and a child whose `runTask` throws
  still writes no terminal child event — both pre-existing, both outside this slot's files
  (`src/run/child-coordinator.ts` is R2-5). Flagged for the parent.
- `finish` awaits child settlement, so an executor that ignores its abort signal can slow teardown.
  That matches the loop's existing behavior (it already awaits every child) and T5/T6 made the
  in-tree executors honor cancellation.
- No live R1 / bandit / topology on the execution path, no Outcome-supported claim, no ADR-006 status
  change, no auto-promote, no `package.json` or dependency edit, no git history change, no commit, no
  cosmetic-only edit.
