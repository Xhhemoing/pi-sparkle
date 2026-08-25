[Model: gpt-5.6-sol]

# Loop 4 Round 12 — R12-6

## Outcome

REPORT-ONLY. `test/unit/run/episode-contract-boundary.test.ts` exists and already
pins the R12-1 writer boundary; another assertion would duplicate the existing
whole-source census rather than strengthen it. I made no change to the owned
test and no `src/**` change.

## Census

Taken first against working-tree commit `7b5b7cc`:

- `taskCriteria` occurs in `src/run/replay.ts` (schema/validator) and a
  `src/tracking/prescore.ts` comment. At census time
  `src/run/flowchart-run.ts` had no writer yet.
- The owned test recursively parses every `src/**/*.ts` module.
- Exact spelling remains pinned by requiring the checkpoint's discovered
  per-task field list to equal `["taskCriteria"]`.
- Equivalent spellings remain covered by `isPerTaskCriteriaFieldName`: a
  normalized name containing `task` or `child` plus `criteria` or `criterion`
  is treated as run authority.
- `ProjectEpisode` is pinned not to expose the exact or semantic per-task
  criteria field.
- The existing mutation proof constructs
  `taskCriteria[].acceptanceCriteria` from `episode.acceptance` and is rejected
  by the same whole-source census.
- `ORIGINAL_RUN_AUTHORITY_FIELDS` still contains all three original names:
  `acceptanceCriteria`, `constraints`, and `contract`.

This admits R12-1's approved shape: a scope constructing `taskCriteria` from
logged `TASK_REQUEST` facts does not read episode authority. The same scope
constructing it from `ProjectEpisode` or `episode.acceptance` sets both census
signals and fails. Recording logged dispatch facts is therefore not
synthesis.

The source consumer census found existing episode readers in the CLI,
episode/run, closure, and privacy surfaces; the owned test's recursive census,
rather than a fixed production-file allowlist, covers them.

## Verification

- `pnpm exec eslint test/unit/run/episode-contract-boundary.test.ts` — PASS
- `pnpm exec tsc --noEmit` — PASS
- `pnpm test -- test/unit/run/episode-contract-boundary.test.ts` — PASS 3/3
  (5/5 tests each run; 0 failed, 0 skipped)
- No full gate run, as required.

The only output warning was the known engine mismatch: repository
`node >=22.19.0`, VM `v22.14.0`.

## Shared-tree note

After verification, other slots had modified
`test/unit/run/terminal-replay-statuses-freeze.test.ts` and
`test/unit/tracking/independent-evidence-posture.test.ts` and added
`.agent_workspace/loop4-r12-t7.md`. None is owned or modified by R12-6.
Because R12-1's writer was not present during this slot's run, the parent
should rely on the round-level scoped rerun after that source diff lands; the
existing pin is designed to accept logged-request provenance and reject
episode provenance.
