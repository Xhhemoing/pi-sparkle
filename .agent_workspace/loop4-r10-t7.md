# Loop 4 · Round 10 · R10-7 — episode/contract authority boundary

Status: **PASS — additive unit freeze landed; no production changes**

## Census first

- Verified `src/run/episode-bind.ts`, `test/unit/run/`, and the existing
  behavioral pin in `test/integration/m2.5/resume.test.ts` all exist.
- The working tree contains 215 `src/**/*.ts` modules.
- Eight production modules import `episode-bind.js`:
  `run/flowchart-run.ts`, `run/coordinator.ts`, `run/supervisor.ts`, and
  `track/loop.ts` bind/settle episodes; `cli/main.ts`,
  `run/child-tracking.ts`, and `learning/from-episode.ts` read only the episode
  id; `privacy/deletion.ts` imports only the lock-path helper.
- The wider episode-data census found closure/status readers in
  `run/episode-bind.ts` and `episode/closure.ts`, an inspect-only reader in
  `cli/main.ts`, deletion-text handling in `privacy/deletion.ts`, and episode-id
  attribution in `learning/auto-loop.ts`. None presents episode data as a run
  `RequirementContract`.
- `ProjectEpisode` has `objective`, `contractVersion`, and `acceptance`, but no
  `contract`, `constraints`, or `acceptanceCriteria` field. The sole
  `openEpisode` projection in `bindEpisodeToRun` copies
  `contract.acceptanceCriteria` into `acceptance`.
- `contractFromObjective` is the existing initial-run fallback, evaluated
  before an episode is opened. It is not a reconstruction from a persisted
  episode. The freeze therefore targets the forbidden reverse direction
  instead of incorrectly banning all legitimate contract constructors.
- The pre-existing behavioral pin is
  “a CLI resume of a run that started without a contract invents none”. It
  asserts the checkpoint contract remains `undefined` and both legs report
  `NOT_APPLICABLE`, guarding specifically against reconstruction as
  `{ acceptanceCriteria: episode.acceptance, constraints: [] }`.

## Additive change

Added `test/unit/run/episode-contract-boundary.test.ts` with four pins:

1. An AST projection pin requires the `openEpisode` payload to contain only
   episode metadata plus `acceptance: contract.acceptanceCriteria`, and pins
   the absence of contract-shaped fields from `ProjectEpisode`.
2. A recursive AST census inspects all 215 source modules. Any function that
   reads episode data fails if it constructs/presents `contract`,
   `constraints`, or `acceptanceCriteria`, references `RequirementContract`,
   or calls a contract constructor.
3. A deletion/mutation guard proves the census rejects an episode-derived
   object with `constraints: []`.
4. A behavioral unit pin binds a contract carrying a distinctive constraint,
   then proves the persisted episode contains its acceptance criterion but no
   contract, constraints, or acceptance-criteria field.

The existing integration behavioral pin was not edited; R10-4 owns that file.
No per-task criteria sibling field was implemented.

## Verification

- `pnpm test -- test/unit/run/episode-contract-boundary.test.ts` — **4/4 pass,
  0 skipped**.
- Existing behavioral pin selected by name from
  `test/integration/m2.5/resume.test.ts` — **1/1 pass, 0 skipped**.
- `pnpm exec eslint test/unit/run/episode-contract-boundary.test.ts` —
  **green**.
- Whole-tree `pnpm exec tsc --noEmit` — **green**. An earlier retry at
  `2026-08-24T23:11:04Z` observed R10-1's in-flight event-union/row-fuzz-seed
  mismatch; after that owned seed landed, this slot re-ran the same command to
  exit 0.
- Node `v22.14.0`; the expected `>=22.19.0` engine warning appeared.
- No full gate, new skip, scratch file, `src/**` edit, checkout, commit, or push.

## Files owned by this slot

- `test/unit/run/episode-contract-boundary.test.ts` (new)
- `.agent_workspace/loop4-r10-t7.md` (this report)
