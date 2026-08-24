[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 · Round 8 — R8-2 durable resume-contract design and absence pins

## Outcome

Delivered the authorized test-only half: three current-absence tripwires in
`test/integration/m2.5/resume.test.ts` and this design/census. No `src/**`,
schema, CLI, package, or behavioral implementation was changed. The
load-bearing test `a resume that is handed no contract assesses its children
against none` is byte-for-byte unchanged.

The cheapest durable next-half shape remains an optional full
`RequirementContract` inside `FlowchartCheckpointState`. It must be validated,
written by every flowchart checkpoint writer, recovered by CLI resume through
the existing `FlowchartContinuation.contract` seam, and preserved by
pause/inject checkpoint rewrites. It must not be reconstructed from episode
acceptance criteria.

## 1. Census first — current state, checked structurally

The R7-1 premise is still true:

1. `src/run/events.ts` contains neither `contract` nor `constraints`; the parent
   run log has no full-contract record.
2. `src/run/replay.ts::FlowchartCheckpointState` has exactly `definition`,
   `snapshot`, and `limits`. `validateFlowchartCheckpointState` validates and
   returns those same three fields. There was no `contract` occurrence in the
   file at census time.
3. `src/run/checkpoint-store.ts` has no `contract`; it is deliberately a generic
   crash-atomic JSON byte store, so the future implementation does not need to
   teach the store about the field.
4. `src/run/flowchart-run.ts::persistCheckpoint` constructs the flowchart
   payload from only `ctx.definition`, the supervisor snapshot, and
   `ctx.flowchartLimits`, even though `FlowchartLoopContext` already has
   `contract?`. The initial call at the end of `startLockedFlowchartRun` therefore
   drops the input contract.
5. `src/run/episode-bind.ts::bindEpisodeToRun` passes
   `contractVersion: contract.schemaVersion` and
   `acceptance: contract.acceptanceCriteria` to `openEpisode`. It passes neither
   the full contract nor `constraints`; an episode cannot recover what
   constraint-retention needs.
6. `src/cli/main.ts::flowchartContinuation` accepts a `checkpoint`, but uses it
   only to correlate an approval reply. Its returned continuation has no
   `contract`. `resumeCommand` supplies the validated checkpoint to that helper
   and then calls `resumeFlowchartRun`, so the CLI currently crosses the resume
   boundary without the contract.
7. `src/run/flowchart-run.ts::resumeLockedFlowchartRun` already honours
   `continuation.contract`; this is the existing seam, not a new API to invent.

One additional durability consumer emerged from the census:
`restoreFlowchartSession`, shared by `pauseFlowchartRun` and
`injectFlowchartRun`, also restores only definition/snapshot/limits. Both paths
eventually call `finish` → `persistCheckpoint`. Adding the field only at start
would let the next pause or injection erase it.

## 2. Current-absence pins added

Three additive tests now make the temporary state explicit:

- `the flowchart checkpoint and its writer currently carry no run contract`
  source-pins the checkpoint type, validator, generic store, writer, and the
  pause/inject restore helper.
- `episode binding currently retains acceptance criteria, not the run contract`
  requires the acceptance projection while forbidding a full-contract or
  constraints projection.
- `the CLI flowchart continuation currently cannot recover a run contract`
  requires CLI resume to pass its checkpoint through the current continuation
  builder while that builder still projects no contract.

These are implementation tripwires, not desired end-state assertions. The next
schema slot should replace/update them in the same diff. The existing
behavioral no-contract pin was intentionally not weakened or flipped.

## 3. Prescribed next-half implementation

### Persisted shape and validation

Add an optional field without changing checkpoint `schemaVersion: 1`:

```ts
export interface FlowchartCheckpointState {
  definition: Flowchart;
  snapshot: FlowchartSupervisorSnapshot;
  limits: FlowchartRunLimits;
  contract?: RequirementContract;
}
```

Import `RequirementContract` and `validateRequirementContract` in
`replay.ts`. When `value.contract` is present,
`validateFlowchartCheckpointState` must run the domain validator and wrap
failures as `Invalid RunCheckpoint: flowchart.contract: ...`, alongside the
existing definition/snapshot/limits errors. Return the validated optional field.
Absence must remain valid so every existing checkpoint is backward-compatible.

### Writers and restorers

- In `persistCheckpoint`, include `ctx.contract` in the flowchart payload when
  defined. This writes it in the pre-loop checkpoint at start and retains it on
  every subsequent scheduling/terminal checkpoint.
- In `restoreFlowchartSession`, restore `checkpoint.flowchart.contract` into
  `ctx`; otherwise `pause` and `inject` strip the new field on their next
  checkpoint write.
- In CLI `flowchartContinuation`, project the validated
  `checkpoint.flowchart?.contract` into `FlowchartContinuation.contract`.
  Both `resumeCommand` and `answerCommand` already use this helper, so one
  change preserves the contract on both production continuation paths.

The named future flip-pin currently calls `resumeFlowchartRun` directly with no
manual contract. The implementation slot should either default the effective
contract inside `resumeLockedFlowchartRun` from the validated checkpoint, or
rewrite that pin into the real CLI-resume boundary prescribed by the Round 8
brief. The proof must not become another direct call that manually supplies the
contract: that would only re-prove R7-1's seam.

Explicit precedence, if the direct API also falls back, should be
`continuation.contract ?? checkpoint.flowchart.contract`: an explicit embedder
continuation remains authoritative, while ordinary recovery uses the run's
durable value.

### Never synthesize from the episode

Do not build `{ acceptanceCriteria: episode.acceptance, constraints: [] }` or a
fresh objective contract. The episode is a lossy projection. Empty constraints
presented as the run's constraints would turn missing evidence into
`NOT_APPLICABLE` and repeat the exact class of lie R7-1 removed.

## 4. Consumer and test census for the implementer

Production consumers/writers owed:

- `src/run/replay.ts`: `FlowchartCheckpointState`,
  `validateFlowchartCheckpointState`, and therefore `validateCheckpoint`.
- `src/run/flowchart-run.ts`: `persistCheckpoint`; resume contract recovery;
  `restoreFlowchartSession` for pause/inject preservation.
- `src/cli/main.ts`: `flowchartContinuation`, reached by both flowchart
  `resumeCommand` and `answerCommand`.
- `CheckpointStore` needs no schema-specific change.
- `src/cli/commits.ts` and `src/tools/decision-commit.ts` read only
  definition/snapshot from the flowchart payload and tolerate the additive
  optional field.

Tests owed:

1. Replace the three new current-absence pins with positive schema/writer/CLI
   pins.
2. Flip/rewrite
   `a resume that is handed no contract assesses its children against none` so
   a contract-ful run resumed through the production boundary reports
   `constraint-retention: PASS` on the resumed child.
3. In `test/unit/supervisor/flowchart-snapshot.test.ts`, pin a valid stored
   contract, a malformed stored contract failing with `flowchart.contract`, and
   an old flowchart checkpoint with no contract still validating.
4. `test/unit/persist/row-fuzz.test.ts` does fuzz `RunCheckpoint`, but its sole
   `CHECKPOINT_SEED` is a non-flowchart checkpoint. It will never mutate the new
   field. Add a contract-bearing flowchart-checkpoint seed (or an equivalent
   dedicated seeded mutation arm) so malformed durable contracts preserve the
   decoder's exact `DomainValidationError` discipline.
5. Add a pause-or-inject preservation assertion; otherwise a green CLI-resume
   test can coexist with a side command silently deleting the contract.

Checkpoint JSON snapshot census:

- There is no full literal snapshot/equality test for a flowchart
  `checkpoint.json` that needs an expected-object update.
- `flowchart-run-abort.test.ts` reads only node states/facts.
- CLI pause/inject tests read partial snapshot fields.
- `cli.test.ts` checks status text in parsed checkpoint JSON.
- `checkpoint-store.test.ts` byte-pins caller-supplied generic payloads, not the
  flowchart schema.
- `replay.test.ts` pins M0 checkpoints with no flowchart field; that
  compatibility pin should remain unchanged.

## 5. Verification

- Baseline owned suite before editing: 7/7 pass.
- Final timing-sensitive owned suite, three consecutive runs: 10/10 pass each,
  0 skipped. An exact 10/10 rerun also passed after R8-1's in-flight changes
  reached `replay.ts`, `flowchart-run.ts`, and `main.ts`.
- Scoped `pnpm exec eslint test/integration/m2.5/resume.test.ts`: pass.
- Whole-tree `pnpm exec tsc --noEmit`: pass on the current cumulative shared
  tree. One earlier rerun was transiently red solely because the in-flight
  unblock slot added `RUN_UNBLOCKED` to `src/run/events.ts` before adding its
  required exact-key seed to `test/unit/run/event-row-fuzz.test.ts` (TS1360 and
  two TS2551 errors). This slot touched neither file; after the owner completed
  that pair, the exact whole-tree rerun passed.
- Full gate not run, as instructed.

During authoring, the first new-test run exposed an over-specific source-region
boundary and the first lint run rejected a countable-space regex. Both test
code issues were corrected before the final 3× run.

## 6. Scope and shared tree

Own changes are confined to:

- `test/integration/m2.5/resume.test.ts`
- `.agent_workspace/loop4-r8-t2.md`

No scratch files, dependency changes, `src/**` edits, commits, pushes, branch
changes, ADR status changes, live routing changes, or full-gate run. Other
modified files visible in the shared working tree belong to concurrent Round 8
slots and were not edited here.
