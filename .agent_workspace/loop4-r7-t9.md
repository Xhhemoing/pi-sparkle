# R7-9 — Reject empty task graphs before persistence

Slot: R7-9 · branch `agent/opt-continuous` · no commits, no branch changes.

## Result

**Tightened.** `validateTaskGraph([])` now throws
`DomainValidationError("Task graph must contain at least one task")`. A fresh
supervised start reaches this validation in pre-flight, before the lifecycle
lock and every state write, so an empty task list leaves the state root empty
instead of binding an episode and publishing a FAILED run.

## Ownership claim

Before editing `test/integration/m2/supervisor-crash.test.ts`, I claim only the
R6-3 pre-rounds crash seed/pin swap authorized for R7-9. The file is otherwise
unowned this round and I will not alter its other coverage.

## Census before coding

- Production has two calls, both in `src/run/supervisor.ts`:
  - fresh start validates `input.tasks` after project discovery but before
    `withRunLifecycleLock`, so validation writes no runtime state;
  - resume reconstruction validates `TASK_GRAPH_ACCEPTED.payload.tasks`, whose
    event validator already requires a non-empty array.
- `src/run/scheduler.ts` consumes only the `TaskGraph` type.
- Direct test consumers are `test/unit/run/scheduler.test.ts`,
  `test/integration/m2/scheduler.test.ts`,
  `test/integration/m2/supervisor-crash.test.ts`,
  `test/unit/graph/dag.test.ts`, and
  `test/unit/graph/edge-cases.test.ts`. The lifecycle-lock source pin also
  consumes the fresh-start call shape. Every graph passed by these consumers
  was non-empty except the disclosed R6-3 crash seed.
- The children plane already rejects an empty spec independently in
  `compileChildrenToFlowchart`; the CLI empty-children test is therefore
  unaffected.
- Event validation rejects `TASK_GRAPH_ACCEPTED` with empty `tasks`; no
  persisted event or replay contract is widened.

## Changes and pins

- `src/graph/validate.ts`: added the O(1) non-empty guard before map allocation
  or graph traversal.
- `test/unit/graph/empty-graph.test.ts`:
  - exact type/message pin for direct graph validation;
  - production-shaped `startSupervisedRun` pin proving the executor is never
    reached and `readdir(stateRoot)` remains `[]`.
- `test/integration/m2/supervisor-crash.test.ts`: re-seeded only the R6-3
  pre-rounds crash case on the disclosed episode-store failure. A valid graph
  reaches an unwritable episode snapshot store, still records the guarded
  `RUN_FAILED`, exposes no invented episode closure, writes the FAILED
  checkpoint, and resumes read-only as terminal. This preserves coverage of
  the pre-rounds crash window without relying on empty-graph acceptance.

## Consumer consequences

- Empty task input changes from an asynchronously settled FAILED run to a
  `DomainValidationError` with no persisted run or episode records.
- The synchronous handle still publishes its generated `runId`; no record for
  that id is created.
- Non-empty graphs and replay of valid accepted-graph events are unchanged.
- The historical reproduction comment in `src/run/supervisor.ts` still names
  the formerly reachable empty-list seed. That file is R7-7 sole ownership, so
  I did not edit it; the episode-store half remains current and the comment
  should be truthed up by its owner/parent.

## Verification

- Scoped ESLint over `src/graph/validate.ts`, `test/unit/graph/`, and the owned
  supervisor-crash pin: clean.
- Owned tests (`test/unit/graph/` plus
  `test/integration/m2/supervisor-crash.test.ts`) after the final edit: 3
  consecutive runs, each **41 pass / 0 fail / 0 skip**.
- Censused consumer/lifecycle tests: **21 pass / 0 fail / 0 skip**.
- Whole-tree `npx tsc --noEmit`: clean on the final rerun. The first post-fix
  run caught and prompted removal of an invalid test-only `reason` property; an
  intermediate rerun exposed four R7-8-owned `src/cli/doctor.ts` errors while
  that sibling edit was incomplete, and those disappeared without changes to
  R7-9 files.
- No full gate, as instructed. No production import was added, so the
  live-isolation trigger does not apply.
- No scratch files remain in the repository.
