# Round 3 — gpt-sol-2

MODEL_SLUG: gpt-5.6-sol-xhigh-fast

## Changes

- Added an integration assertion that `main(["help"])` prints the complete
  `adapt promote` contract: `--candidate`, `--expected`, `--content-file`,
  `--review-file`, and `--approve`, plus optional `--eval-file`.
- Strengthened the fake-executor evidence-invariant test by pinning the terminal
  episode's `outcomeId` to the run status while retaining the explicit boundary:
  terminal-status evidence is not Outcome-supported evidence.
- Left the runtime benchmark unchanged; no additional field was needed.

## Verification

- PASS:
  `pnpm exec tsx --test test/integration/cli/commands.test.ts test/acceptance/evidence-invariant.test.ts`
  — 7/7 tests.
- PASS: `pnpm typecheck`.

No source or package metadata was changed. Per instruction, no commit was created.
