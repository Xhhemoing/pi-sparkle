# Loop 2 Round 1 — gpt-sol-2

- Added `test/integration/m2.5/cli-contract-honesty.test.ts`.
- Pinned the current CLI distinction without inventing a product contract:
  - `--children` persists only the synthetic `run-complete` acceptance criterion.
  - Child acceptance criteria are not promoted into a parent contract.
  - `--track --assume-defaults` persists its extracted `ac-objective` and
    `ac-tests` criteria and does not use `run-complete`.
- Made no source or package changes and did not commit.

Verification:

- `pnpm test -- test/integration/m2.5/cli-contract-honesty.test.ts` — passed.
- `pnpm test -- test/unit/run/episode-bind.test.ts test/integration/m1/cli-children.test.ts test/integration/m2.5` — passed (29 tests).
- `pnpm typecheck` — passed.
- `pnpm exec eslint test/integration/m2.5/cli-contract-honesty.test.ts` — passed.
