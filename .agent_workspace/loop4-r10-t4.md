# Loop 4 · Round 10 · R10-4 — contract-retention CLI arc

Status: **PARTIAL — structural pin landed; pure-CLI pause arc is unreachable in the current production path**

## Census first

Both assigned paths exist:

- `test/integration/m2.5/resume.test.ts`
- `test/integration/m2.5/cli-contract-honesty.test.ts`

The initial working-tree census of every `materializeCheckpoint(` call found two
calls with a third, flowchart-payload argument:

1. `src/run/flowchart-run.ts` `persistCheckpoint`: local `flowchart` includes
   `...(ctx.contract !== undefined ? { contract: ctx.contract } : {})`.
2. `src/run/flowchart-run.ts` `unblockLockedFlowchartRun`: the inline payload
   includes `...(contract !== undefined ? { contract } : {})`.

The test added here deliberately does **not** freeze that count. It recursively
parses all `src/**/*.ts` modules, finds every `materializeCheckpoint` call with
a flowchart payload, resolves a local payload initializer when needed, and
requires a `contract` property. Its assertion wording is:
“every flowchart-payload writer carries contract”. A new discard writer is
therefore included automatically rather than rejected merely for increasing
the count.

Census refreshed at `2026-08-24T23:07:33Z`; concurrent Round 10 edits were
present outside this slot's owned files.

## Landed

- Added the structural writer-census property pin to
  `test/integration/m2.5/resume.test.ts`.
- Kept the R9-1 schema, never-synthesize, reserved-unimplemented,
  `main(["resume", …])` flip, `^\}$` region boundaries, and
  `doesNotMatch(/\bunblockCommand\b/)` assertions unchanged and green.
- No `src/**` changes and no new skip.

## Pure-CLI arc blocker

The offline producer itself is healthy. A production `main([...])` probe using
`run --track --assume-defaults --executor fake` returned code 0, completed
offline, and wrote a flowchart checkpoint whose durable contract contained
constraints `c-smallest` and `c-tests`. No live provider is needed to extract
or persist the contract.

The requested `run --track` → `pause` → `resume` arc nevertheless cannot reach
a paused boundary:

- `startTrackedRun` calls `startFlowchartRun` without a `pause` dependency
  (`src/track/loop.ts:157-175`).
- `startFlowchartRun` puts a pause controller in its loop context only when
  `deps.pause` exists (`src/run/flowchart-run.ts:1189`), and
  `pauseIfRequested` immediately returns when it does not
  (`src/run/flowchart-run.ts:840`).
- `runCommand` awaits the tracked run and prints its run id only after the
  outcome returns (`src/cli/main.ts:844-855`). With the deterministic fake
  executor, that outcome is terminal `COMPLETED`.
- The next shipped command then returns code 1 with
  `error: cannot pause a COMPLETED run`.

Observed production-path probe:

```json
{
  "runCode": 0,
  "runStatus": "COMPLETED",
  "constraintIds": ["c-smallest", "c-tests"],
  "pauseCode": 1,
  "pauseError": "error: cannot pause a COMPLETED run"
}
```

Calling `pause` concurrently would not make this an honest proof: the tracked
loop has no pause controller to observe the token, keeps executing to
`COMPLETED`, and resume is serialized behind the run lifecycle lock. I did not
substitute an embedder API, kill a process to manufacture a pause, or use a
live provider.

The production fix must first wire a file pause controller into the tracked
`startFlowchartRun` dependency path (for example, an explicit pause dependency
from `runCommand` through `TrackRunInput`). That requires `src/**`, including
files outside this slot's ownership, so the end-to-end test is not added in
this test-only slot.

## Verification

- Scoped ESLint over both assigned test files: **green**.
- `test/integration/m2.5/resume.test.ts`: **16/16 green**, repeated at least
  3×; no skips.
- `test/integration/m2.5/cli-contract-honesty.test.ts`: **1/1 green**, repeated
  at least 3×; no skips.
- Whole-tree `tsc --noEmit`: this slot's one initial narrowing error was fixed.
  A second retry cleared the concurrent `src/run/events.ts` error but was still
  blocked by R10-1's in-progress `test/unit/run/event-row-fuzz.test.ts`:
  `RUN_UNBLOCKED_WITH_DISCARD` was added to the event union before its required
  seed/indexing updates. Re-run after that sibling edit settles.
- No full gate run, as required.
