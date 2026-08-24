[Model: gpt-5.6-sol-xhigh-fast]

# Loop 4 Round 9 — R9-7

## Census

- Branch: `agent/opt-continuous`; no checkout or commit performed.
- Baseline `src/cli/main.ts` has exactly five `DOCTOR_ROUTED_NEXT` entries:
  `LOCK_TIMEOUT_CODE`, `RUN_RECORDS_SURVIVED_CODE`,
  `BANDIT_STATE_UNREADABLE_CODE`, `PREFERENCE_SNAPSHOT_UNREADABLE_CODE`, and
  `CATALOG_OBSERVED_CORRUPT_CODE`.
- `GENERIC_FAILURE_NEXT` and all five route wordings match the Round 6/7 frozen
  text at HEAD.
- The requested freeze test did not exist before this slot.

## Change

Added `test/unit/cli/doctor-routed-next-freeze.test.ts`. It reads
`src/cli/main.ts`, parses the source with the TypeScript AST, locates the two
private top-level constants, and compares:

- `GENERIC_FAILURE_NEXT` character-for-character;
- the complete ordered route-key/wording tuples character-for-character.

The tuple comparison requires exactly five entries, so adding a sixth route or
dropping any route fails. `CATALOG_OBSERVED_CORRUPT_CODE` remains explicitly
frozen as the defense-in-depth fifth entry.

The second test deletes the catalog tuple from an in-memory source mutant using
its AST span and proves the same freeze assertion throws. No runtime source is
modified.

## Verification

- `pnpm exec eslint test/unit/cli/doctor-routed-next-freeze.test.ts` — PASS
- `pnpm exec tsc --noEmit` — PASS (whole tree)
- `node --import tsx --test test/unit/cli/doctor-routed-next-freeze.test.ts` —
  PASS (2 tests, including deletion mutant)

No full gate was run. This slot did not edit `src/**`, `package.json`, live R1,
or ADR-006.
