# Loop 5 · Round 6 — D26 independent landing recheck

## Verdict: KEEP

Reviewed `origin/cursor/argv-help-dialect-0da8` at
`25742b4342d2cfa0357e463ea135e1d0d9840069` against
`origin/cursor/pi-sparkle-sota-opt-0da8`. The three-dot merge base is
`fb4b8659dff20f29acab81474b3cc11b3d3c044d`.

The landing satisfies the ranked D26 operator contract:

- The required path-filtered diff for `src/cli/inject.ts` and
  `test/integration/cli/pause-inject.test.ts` is empty. Commit `25742b4`
  removes the entire optional inject `--type` / `--confidence` rider from
  `daf7fc7`; no inject preflight remains in the landing.
- The parser catches in episode, commits preview, commits apply, validate,
  migrate-legacy, pi-compat, and init-examples end immediately after the
  synchronous `parseArgs(...)` statement. Every catch returns `cliFail` with
  `stage: "parse-args"`.
- Later work remains outside those catches: episode-id parsing and
  event/snapshot/lock work; commit run/checkpoint/file/git work; validate
  spec and live-catalog handling; migration scan and publish; pi-compat
  package and registry reads; and init target checks and writes.
- Help returns before state access. Episode checks the parsed help boolean
  before episode-id parsing or stores; both commits subcommands check it
  before run lookup; pi-compat checks it before package reads. Validate,
  migrate-legacy, and init preserve their earlier pre-read/pre-write help
  exits.
- The complete three-dot footprint is exactly the six source files and six
  named tests:
  `commits`, `episode`, `init-examples`, `migrate-legacy`, `pi-compat`, and
  `validate`. There is no `src/cli/main.ts` change, no Event declaration, and
  no overlap with the PR #12 source paths listed in the ranking contract.

Runtime probes reproduced the intended dialect:

- `episode events --help` and `commits apply --help` exited 0 with command
  usage and no state error.
- `validate --bogus` and `pi-compat --ofline` exited 1 with their respective
  command, `stage: "parse-args"`, the unknown option, and a `--help` next
  action.

Verification passed: all six changed test files (`81` tests) and
`pnpm typecheck`. The runner emitted only the environment warning that Node
`22.14.0` is below the package's declared `>=22.19.0`; no check failed.

Landing action: **KEEP**. No remaining source bytes are required.
