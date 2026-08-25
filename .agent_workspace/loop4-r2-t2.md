[Model: gpt-5.6-sol-xhigh-fast]
# Loop 4 Round 2 — R2-2

Implemented:
- Added `FileLockTimeoutError.code: "LOCK_TIMEOUT"` while preserving the timeout message and `withExclusiveFileLock` signature.
- Changed the invocation sink classifier from timeout-message matching to the typed discriminator.
- Removed the redundant successful-path `mkdir` filesystem operation and added an immediate first contention retry before the configured timer cadence.
- Added coverage for the timeout code and for rejecting a message-only imitation of a timeout without retrying.

Benchmark (`node scripts/bench-runtime.mjs`, 1,000 samples, same VM):

Before:
```json
{"ok":true,"samples":1000,"jsonlAppendMs":46.827,"jsonlAppendFsyncMs":204.854,"jsonlReadMs":0.545,"lockSerialMs":190.689,"lockContendedMs":202.963}
```

After:
```json
{"ok":true,"samples":1000,"jsonlAppendMs":46.64,"jsonlAppendFsyncMs":190.715,"jsonlReadMs":0.52,"lockSerialMs":166.539,"lockContendedMs":177.583}
```

Result: `lockSerialMs` improved 12.66%; `lockContendedMs` improved 12.50%. The performance change is retained because both exceed the 5% threshold.

Verification:
- `pnpm test -- test/unit/persist/file-lock.test.ts test/unit/telemetry/invocation-log.test.ts` — 23 passed.
- `pnpm exec eslint src/persist/file-lock.ts src/telemetry/invocation-log.ts test/unit/persist/file-lock.test.ts test/unit/telemetry/invocation-log.test.ts scripts/bench-runtime.mjs` — passed.
- `pnpm typecheck` — passed.
