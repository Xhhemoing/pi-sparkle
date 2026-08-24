MODEL_SLUG: gpt-5.6-sol-xhigh-fast

# Round 1 — R1-gpt-B

## API

- Added `src/pi-compat/check.ts` with `PiPinnedVersions`,
  `PiCompatAdapterProbe`, `PiCompatReport`, `readPinnedPiVersions`,
  `comparePiVersions`, `probeAdapterContract`, and `buildPiCompatReport`.
- Added stable re-exports from `src/pi-compat/index.ts`.
- The adapter probe reads the adapter source without importing Pi, keeps the
  sparkle-supported thinking-level strings local, and separates adapter type
  detection from documentation evidence.

## Tests

- `pnpm test -- test/unit/pi-compat/check.test.ts`: 11 passed, 0 failed.
- `pnpm exec tsc --noEmit --pretty false`: passed.
- Focused ESLint for source/tests: passed.
- `pnpm build`: passed; built-module smoke test passed.
- The requested `pnpm test -- test/unit/pi-compat` form fails before test
  discovery because Node treats the argument as an unsupported ESM directory
  import. Passing the test file explicitly succeeds.
- Environment warning: runtime Node 22.14.0 is below the package's declared
  Node >=22.19.0 engine.

## Round 2 leftover

- Add CLI integration tests if `src/cli/pi-compat.ts` is available. It did not
  exist when the Round 1 library tests were authored, so only library tests
  were added.
