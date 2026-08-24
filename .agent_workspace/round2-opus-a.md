# Round 2 — R2-opus-A: `run --thinking <level>`

Branch `cursor/pi-adapt-aux-features-e1e3`. No commits made (per instructions).

## What landed

`src/cli/main.ts` (only source file touched):

- `run` now parses `--thinking <level>` against the existing `THINKING_LEVELS`
  tuple (`off|minimal|low|medium|high|xhigh|max`).
- New `resolveThinkingLevel(flag, env = process.env.PI_THINKING_LEVEL)`
  (exported for tests) implements the precedence `--thinking` >
  `PI_THINKING_LEVEL` > `off`. The env read moved out of `createExecutor` so a
  single place resolves the level; `createExecutor` gained a 5th optional
  `thinkingLevel` parameter and falls back to `resolveThinkingLevel(undefined)`
  when a caller (resume) does not supply one, which preserves today's env-only
  behaviour on those paths.
- The resolved level is threaded into both `runCommand` executor constructions
  (plain/`--children`/`--track` path and the `--flowchart` path), so it reaches
  `createConfiguredPiExecutor` → `PiAgentExecutor` for `--executor pi`. The
  fake executors ignore it but the value is still parsed and validated.
- Invalid `--thinking` value: `cliFail` at `stage: "parse-args"` naming the flag
  and listing the allowed values. Invalid `PI_THINKING_LEVEL` keeps throwing
  `DomainValidationError` (now on every `run`, not only `--executor pi`).
- USAGE: `[--thinking <level>]` on the three `run` lines plus a prose paragraph
  stating the precedence, that it is per-run only (headless counterpart of Pi's
  session-scoped `/thinking` TUI selector, never persisted — Ctrl+S is not our
  job), and that Google clamps `xhigh`/`max`.
- One-line clamp/mirror comment sits at the `THINKING_LEVELS` declaration.

Adapter untouched: `SparkleThinkingLevel` still lives in
`src/pi-adapter/pi-executor.ts`, nothing re-exports Pi's `ThinkingLevel`, and
the CLI keeps a local `CliThinkingLevel = (typeof THINKING_LEVELS)[number]`.
Assignability to `SparkleThinkingLevel` is enforced by the existing
`createConfiguredPiExecutor` call (the old `as` cast there is gone), so a
divergence between the CLI tuple and the adapter union now fails typecheck.

## Tests

New `test/unit/cli/thinking-flag.test.ts` (8 tests): default/env resolution,
flag-over-env precedence including an unusable ambient value, every level
round-tripping, both error messages, `run --thinking ultra` failing at
parse-args with no stdout, a fake-executor run accepting `--thinking high`
while `PI_THINKING_LEVEL=ultra`, `run` rejecting an unusable
`PI_THINKING_LEVEL` with no flag, and USAGE documenting the flag.

Results (all green):

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test test/unit/cli/*.test.ts` — 52 pass
- `pnpm test test/integration/cli/*.test.ts test/integration/m1/cli-children.test.ts test/integration/track/track-loop.test.ts` — 66 pass
- `pnpm test test/unit/pi-boundary.test.ts test/unit/pi-compat/*.test.ts test/unit/pi-adapter/*.test.ts` — 30 pass

## Notes for the parent

- Behaviour change worth a line in the changelog: an invalid
  `PI_THINKING_LEVEL` now fails `run` on the fake executor too (previously only
  `--executor pi` construction validated it). This is what the spec asked for
  ("fake path may ignore it but must still parse/validate").
- `resume` still reads `PI_THINKING_LEVEL` only; a `resume --thinking` was out
  of scope here and would need the same 5th argument passed at the two resume
  call sites if anyone wants it.
- Docs (`README.md` §`PI_THINKING_LEVEL`, `docs/how-to-adapt-to-pi.md`,
  `.agents/skills/pi-sparkle`) still describe the env var as the only knob and
  a `--thinking` flag as hypothetical. Those files are owned by other Round 2
  agents; they should now say the flag exists and wins over the env var.
