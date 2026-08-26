# D35 recheck — KEEP

Reviewed PR [#20](https://github.com/Xhhemoing/pi-sparkle/pull/20) at
`86fc92698c479c9d2e8b2781ce8163c4bfb05f7a` against
`origin/cursor/pi-sparkle-sota-opt-0da8`.

The landing includes the GPT-r9 FIX rider:

- The unknown-provider `next` points to `models list --available` using the
  same `--state-root`, without interpolating the raw path.
- Unset `--from-env` remedies are split between a named custom `envVar` and
  builtin ambient sources.
- A padded custom `envVar` is retained and visibly quoted in the failure
  report. The test sets only its trimmed spelling, proves that does not satisfy
  the probe, identifies the raw configured bytes, and proves the secret value
  is not emitted.

The parse-args/validation/preflight split, blank-positional folding, and
ordinary-case message bytes are preserved. No catch was added or widened, and
the `AUTH_STATUS` implementation and exact-shape pins are unchanged.

Verification from the detached PR-tip worktree:

`npx tsx --test test/unit/cli/auth.test.ts test/integration/cli/commands.test.ts`

Result: 38 passed, 0 failed.
