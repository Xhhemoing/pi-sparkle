# Loop 5 · R7 · D28 independent landing recheck

Target: `origin/cursor/auth-dialect-json-0da8` at
`4d3fcc49798ecd29380c5f592103f3eaa598628e`

Parent: `origin/cursor/pi-sparkle-sota-opt-0da8` at
`dcbf467361e5630954bd339cb567743cbb761e58`

Ranked contract: GPT D28 FIX plus Fable Rank 1, with the parser-error test
rider on top of runtime `ad14592`.

## Verdict: KEEP

Keep Fable Rank 1 and land D28 as specified. The parser-error freeze is now
complete; no remaining bytes were found.

1. **PASS — unknown subcommand.** Usage is echoed before the structured
   refusal. The report pins `command: "auth"`, `stage: "parse-args"`, and
   `next: "use auth status, login, or logout"`.

2. **PASS — parser-error test boundary.** One table-driven test now sends
   `--bogus` through status, login, and logout and parses each refusal through
   `parseCliErrorJson`. Equality assertions pin:

   - `command`: `auth status`, `auth login`, and `auth logout`, respectively;
   - `stage: "parse-args"`;
   - `message: "Unknown option '--bogus'"`;
   - `next: "run pi-sparkle auth --help"`.

   The test also pins exit 1, empty stdout, and no credential-file creation.
   `src/cli/auth.ts` is byte-identical to `ad14592`: the catch still encloses
   only synchronous `parseArgs`; provider validation, credential-store work,
   and damaged-store classification remain outside it.

3. **PASS — help ordering and zero-write surface.** Status flag help and
   login/logout flag and provider-position help return usage with exit 0 before
   provider or store work. The tests cover the forms and verify that
   `runtime/auth.json` is not created; a direct positional-login probe agreed.

4. **PASS — `AUTH_STATUS`.** Stored mode is exactly
   `type/preview/mode/stored`; rows are exactly
   `{providerId, credentialType}` and sorted. `--all` adds sorted
   `environment` rows exactly `{providerId, label, source}`, reusing
   `sourceLabel` and its D24 raw configured-byte equality. Sentinel tests keep
   credential values out. Empty arrays retain the discriminated shape.
   Whole-object deep equality and one compact newline-terminated JSON line are
   pinned.

5. **PASS — footprint and landing compatibility.** The rider changes only
   `test/unit/cli/auth.test.ts`; cumulative D28 changes remain limited to
   `src/cli/auth.ts` and `test/unit/cli/auth.test.ts`. There is no `main.ts`,
   Event-union, or PR #12 file change. The cumulative target applies cleanly
   to the current parent tip.

Verification: the exact target passed all 28 auth unit tests and `pnpm
typecheck`. The rider test passed all three equality-pinned parser cases.
