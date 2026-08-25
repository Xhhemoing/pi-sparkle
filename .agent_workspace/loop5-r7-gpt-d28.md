# Loop 5 · R7 · D28 independent landing recheck

Target: `origin/cursor/auth-dialect-json-0da8` at
`ad14592516c2d36c83acdbdee65d512cf2526488`

Parent: `origin/cursor/pi-sparkle-sota-opt-0da8` at
`dcbf467361e5630954bd339cb567743cbb761e58`

Ranked contract: GPT D28 FIX plus Fable Rank 1.

## Verdict: FIX

Keep Fable Rank 1 and the implementation. Do not land until the parser-error
freeze pins all three owning subcommands exactly.

1. **PASS — unknown subcommand.** Usage is echoed before the structured
   refusal. The report pins `command: "auth"`, `stage: "parse-args"`, and
   `next: "use auth status, login, or logout"`.

2. **FIX — parser-error test boundary.** Runtime behavior is correct:
   `parseAuthArgs` is called with `auth status`, `auth login`, and
   `auth logout`; its catch encloses only the synchronous `parseArgs` call.
   Provider validation, credential-store work, and damaged-store
   classification remain outside that catch. Direct login/logout `--bogus`
   probes reproduced the correct command, stage, message, and remedy.

   The committed freeze is incomplete. The only mistyped-flag test exercises
   status, matches the message only by `/--bogus/`, and matches the remedy only
   by `/--help/`. It does not exercise login or logout parser throws.

   **Remaining bytes:** in `test/unit/cli/auth.test.ts`, pin three
   `parseCliErrorJson` cases (`status --bogus`, `login openai --bogus`,
   `logout openai --bogus`) with exact:

   - owning `command`: `auth status`, `auth login`, `auth logout`;
   - `stage: "parse-args"`;
   - `message: "Unknown option '--bogus'"`;
   - `next: "run pi-sparkle auth --help"`.

   No `src/` correction is indicated.

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

5. **PASS — footprint and landing compatibility.** Commit-local changes are
   only `src/cli/auth.ts` and `test/unit/cli/auth.test.ts`; there is no
   `main.ts`, Event-union, or PR #12 file change. The commit applies cleanly to
   the current parent tip.

Verification: the exact target passed all 28 auth unit tests and `pnpm
typecheck`. Direct login/logout parser probes emitted the expected owning
commands and created no credential file.
