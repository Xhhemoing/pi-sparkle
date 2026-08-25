[Model: gpt-5.6-sol]

# Loop 4 Round 13 — R13-7

## Outcome

REPORT-ONLY. The existing 5/5 tests already cover the Round 13
never-synthesize boundary, so I did not edit
`test/unit/run/episode-contract-boundary.test.ts` or any `src/**` file.

## Census

The first census was taken at `dfb185bd2b7b02973c91b01a54719de702aa98a8`.
During verification HEAD advanced to
`e744b4acb87bfd73b2510e5b34b9bbe09aec33e1`; the intervening orchestrator
commit changed only `.agent_workspace/OWNERSHIP.md` and
`.agent_workspace/PROGRESS.md`.

The refreshed in-flight census was clean: no working-tree diff in
`src/run/replay.ts`, `src/tracking/prescore.ts`,
`src/run/flowchart-run.ts`, or the owned test.
The final shared-tree status did show R13-4's in-flight
`docs/status-matrix.md` edit and sibling reports for R13-5/R13-8/R13-9/R13-10;
all are outside this slot's boundary.

The owned test already contains five tests and the required discriminator:

- It recursively parses every `src/**/*.ts` function scope.
- A violation requires both signals in the same scope: the scope reads episode
  data and constructs a run-authority field.
- Run authority includes the checkpoint-discovered `taskCriteria` field and
  semantic `task`/`child` + `criteria`/`criterion` spellings.
- Therefore caller-spec and logged-request construction passes because it does
  not read the episode, while the existing mutation that constructs
  `taskCriteria` from `episode.acceptance` fails.
- `ProjectEpisode` and a persisted episode are both pinned not to expose
  per-task criteria authority.
- `ORIGINAL_RUN_AUTHORITY_FIELDS` remains exactly
  `acceptanceCriteria`, `constraints`, and `contract`.

R13-1 is comment-only and R13-2 is test-only; neither sibling's authorized
scope can add production episode provenance. No additive assertion would
strengthen the existing whole-source census, so the discriminator was left
unchanged.

## Verification

- `pnpm exec eslint test/unit/run/episode-contract-boundary.test.ts` — PASS
- `pnpm exec tsc --noEmit` — PASS
- `pnpm test -- test/unit/run/episode-contract-boundary.test.ts` — PASS 3/3
  (5/5 tests each run; 0 failed, 0 skipped)
- No full gate run, as required.

The owned-test runs emitted only the known engine warning: the repository
requires Node `>=22.19.0`, while this VM has Node `v22.14.0`.
