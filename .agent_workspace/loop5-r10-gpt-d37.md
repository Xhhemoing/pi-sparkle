KEEP

# D37 landing recheck

Reviewed PR [#25](https://github.com/Xhhemoing/pi-sparkle/pull/25) at
`d3c5249f4b5116b23f77d5050dc430508406c21f` against
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`e17b2e16738f1c9ec11a8bd716d04e9a67a04c0b`.

- All seven modules refuse a present blank `--state-root` at `parse-args` with
  the exact message, path-free next, and existing command dialect. Nonblank
  relative roots remain accepted.
- Guard placement preserves the required path-free argv precedence. In
  particular, `pause --run banana --state-root ""` reports the blank root,
  while the existing nonblank-root malformed-run pins remain unchanged.
- `validate` guards only the flowchart branch after spec selection and blank
  spec checks. The live flowchart probe refused before reading the cwd
  `providers.json`; `--children ... --state-root ""` still succeeded.
- Refused `auth login`, `models enable`, and `list --json` probes created no
  `runtime/` tree or success payload.
- The diff owns only the seven expected CLI modules, six expected test files,
  and the implementer report. It does not touch episode, D38, `errors.ts`, or
  `main.ts`; `git diff --check` is clean.
- The closed D25/D31/D32/D34/D35/D36 pins and existing success JSON assertions
  pass unchanged.

Verification:

- Required six-file test command: 184 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- Independent live probes were confined to `/tmp/r10-gpt-d37/**`.
