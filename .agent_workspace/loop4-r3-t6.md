gpt-5.6-sol-xhigh-fast

# Loop 4 Round 3 — R3-6 stale-lock diagnosability

## Result

- Added a recursive, read-only `*.lock` inventory under the configured state root.
- Reports metadata status (`valid`, `empty`, `invalid`, or `unreadable`), age in milliseconds and its source (`acquiredAt` or file `mtime`), recorded PID, and local PID liveness.
- Labels PID liveness as advisory because PID reuse and shared/container filesystems cannot prove staleness, and explicitly states that doctor never steals or deletes locks.
- Preserved the existing doctor JSON fields and `nodeVersion` injection; `locks` and the appended `lock-inventory` check are additive.
- Kept `src/persist/file-lock.ts` unchanged and parsed lock metadata locally in `src/cli/doctor.ts`.

## Verification

- `pnpm test -- test/unit/cli/doctor.test.ts`: PASS in four consecutive runs, 12/12 each.
- `pnpm exec eslint src/cli/doctor.ts test/unit/cli/doctor.test.ts`: PASS.
- `pnpm exec tsc --noEmit`: PASS (whole tree). Two earlier attempts observed concurrent unowned edits; the final integrated-tree retry is green.

Tests pin recursive discovery, valid/invalid/empty metadata, metadata- versus mtime-derived age, recorded-PID liveness, the PID-reuse disclaimer, additive JSON shape, prose output, and byte-for-byte lock-file survival after doctor runs.
