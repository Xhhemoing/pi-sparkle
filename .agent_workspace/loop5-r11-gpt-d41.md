KEEP

# D41 landing recheck

Reviewed PR [#29](https://github.com/Xhhemoing/pi-sparkle/pull/29) at
`95ade002f3b592deb6a4ac4c6a0f9a74db7f977c` against
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`53e2245380453e9c36579c20881dfcbe5355c7e5`.

- Override and skip reject present `--key`/`--value` as `parse-args` after
  their required per-type flags and before confidence, blank-flag, root, or
  state handling. Fact `--node` and every type's `--confidence` remain legal.
- Fact values are decoded by the imported `parseFactValue` at one call site,
  after the blank key/node/actor loop and before the D37 blank-root guard. The
  narrow `DomainValidationError` catch names `--value`; objects, arrays,
  `null`, and non-finite `1e999` are refused, while `--value ""` remains a
  legal empty-string fact.
- Precedence is preserved: unknown type remains first, blank `--key` beats an
  invalid value, and the complete valid-required-argv mixed case reports the
  value fault before a blank root without reading or creating state.
- New refusal coverage compares `events.jsonl` byte-for-byte before and after.
  The complete mixed case separately proves its temporary working directory
  remains empty.
- The diff owns only `src/cli/inject.ts`,
  `test/integration/cli/pause-inject.test.ts`, and the implementer report.
  It does not edit `src/run/injection.ts` or `src/cli/main.ts`;
  `INJECT_USAGE` is byte-identical to the base, and `git diff --check` is
  clean.

Verification:

- `npx tsx --test test/integration/cli/pause-inject.test.ts`: 40 passed,
  0 failed.
- `npx tsc --noEmit`: passed.
- Independent live probes under `/tmp/r11-gpt-d41/**` confirmed all four
  relevance refusals, all four invalid value classes, byte-identical events,
  unknown-type and blank-key precedence, complete-argv value-before-root with
  an empty working directory, and legal empty value/fact node/confidence.
