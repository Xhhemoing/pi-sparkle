# Loop 5 · Round 5 — GPT D24 independent recheck

## Verdict: KEEP

Reviewed fetched `origin/cursor/pi-sparkle-sota-opt-0da8` at
`099dd2d08f92ef6cba3ff4944dccbff584a66d07`, including D24 merge
`618129e` and the later decision/progress docs. No blocking finding.

## Evidence

1. **Custom source equality: PASS.** `sourceLabel` keeps
   `custom.envVar` untrimmed and requires `source === envVar`; `trim()` is used
   only for the existing nonblank guard (`src/cli/auth.ts:170-180`). The focused
   test configures and resolves the exact padded name
   `" SPARKLE_TEST_PADDED_KEY "` and pins an `env` row
   (`test/unit/cli/auth.test.ts:528-565`).

2. **Keyless collision boundary: PASS.** A custom provider is classified from
   its own configured `envVar`, not from whether its source happens to name a
   live process variable. The existing negative pin sets an environment
   variable literally named `keyless (no key)` and still requires the row to
   remain `ambient` (`test/unit/cli/auth.test.ts:512-526`).

3. **Builtin explanation: PASS.** The comment no longer groups
   `"AWS access keys"` with file/profile/role paths. It explicitly says Pi
   returns that source only after both AWS environment variables resolve and
   honestly documents the live-single-variable heuristic's resulting
   understatement: the row prints `ambient` despite environment configuration
   (`src/cli/auth.ts:149-163`). A new `amazon-bedrock` test pins that limitation
   (`test/unit/cli/auth.test.ts:567-591`).

4. **D21 behavior and footprint: PASS.** The D24 range changes only
   `src/cli/auth.ts` and `test/unit/cli/auth.test.ts`; it does not touch
   `src/pi-adapter/runtime.ts` or `src/cli/main.ts`. The keyless-custom
   `--key`/`--oauth`/interactive refusal, the five missing-argument
   `cliFail` sites, F9 dropped-default disclosure, F13 nonempty
   `auth status --all`, and F14 missing-catalog annotation remain unchanged.

5. **Freeze: PASS.** D24 adds no Event type and does not modify
   `src/run/events.ts`. It does not modify `src/cli/doctor.ts`; the doctor
   `auth` check still calls `checkProviderAuth`, preserving stored-first and
   ambient-second resolution. The concurrent D22 doctor merge is already
   present at the reviewed head, but its doctor file is byte-identical before
   and after the D24 merge.

## Verification

- Focused `test/unit/cli/auth.test.ts`: **21 passed, 0 failed, 0 skipped**.
- `pnpm typecheck`: **passed**.
- `git diff --check 778f0be..099dd2d`: **passed**.
- The VM used Node `v22.14.0`, below the package's declared `>=22.19.0`; pnpm
  emitted an engine warning, but both requested checks completed successfully.
- Analysis only: no application source was edited, and no commit or push was
  made.
