# Loop 4 Round 11 — R11-10 (`gpt-sol`)

## Outcome

Strengthened `test/unit/run/episode-contract-boundary.test.ts` only. The original
never-synthesize boundary remains intact, and the census now also rejects a
checkpoint-style per-task/child criteria field derived from `ProjectEpisode`.
No `src/**` or `resume.test.ts` edit was made.

The handed-off test path was verified to exist before editing.

## Census first

Initial census preceded editing; the post-R11-1 checkpoint census was refreshed
at `2026-08-25T00:03:19Z`:

- All 215 `src/**/*.ts` modules remain in the AST census.
- The binding projection remains exactly
  `id, projectId, objective, contractVersion, acceptance`, with
  `acceptance` sourced from `contract.acceptanceCriteria`.
- `ProjectEpisode` still has `acceptance` and has no `contract`,
  `constraints`, `acceptanceCriteria`, or per-task/child criteria field.
- The existing anti-vacuity reader witnesses remain present:
  `src/run/episode-bind.ts:settleLockedEpisode`,
  `src/cli/main.ts:inspectEpisode`, and
  `src/privacy/deletion.ts:episodeTextOf`.
- No source episode reader constructs any original run-authority field or a
  `RequirementContract`.
- R11-1's checkpoint sibling is `FlowchartCheckpointState.taskCriteria`; it is
  explicitly pinned as the discovered per-task criteria field. Its exact
  spelling joins the forbidden synthesis set, while the semantic task/child
  criteria rule independently catches equivalent reconstruction spellings.

## Additive pins

- Centralized the original `contract` / `constraints` /
  `acceptanceCriteria` authority names without removing any.
- Extended object-literal and variable-declaration detection to checkpoint
  per-task criteria names.
- Asserted that neither the `ProjectEpisode` model nor a persisted episode
  acquires the checkpoint's exact `taskCriteria` sibling.
- Added a mutation proof: assigning `episode.acceptance` to
  `taskCriteria[].acceptanceCriteria` is rejected by the same whole-source
  census.

## Verification

- Scoped eslint:
  `pnpm exec eslint test/unit/run/episode-contract-boundary.test.ts` — exit 0.
- Owned test:
  `pnpm test -- test/unit/run/episode-contract-boundary.test.ts` — 5 pass,
  0 fail, 0 skipped.
- Whole-tree `pnpm typecheck` (`tsc --noEmit`) — final exit 0.
  An earlier pass observed a transient outside this slot at
  `src/run/flowchart-run.ts:1269` (`TS2554`, four arguments passed to an
  in-flight three-argument signature). Two later passes overlapped R11-1's
  schema/test replacement and saw its stale no-criteria pin plus call sites
  temporarily missing `criterionUnmet`. Both concurrent edits settled; the
  required whole-tree rerun and the post-settlement owned-test rerun were
  green.
- `git diff --check` — exit 0.
- No full gate, no scratch files, no new skip.
