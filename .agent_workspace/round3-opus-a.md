MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 3 — R3-opus-A (thinking-mirror / Google clamp tests)

Status: done. Not committed (parent orchestrator commits the round).

## Files written (all inside my exclusive paths)

| File | Change |
|---|---|
| `test/unit/pi-adapter/thinking-clamp.test.ts` | New. 6 tests characterizing the Google clamp and proving the adapter does not clamp |
| `test/unit/cli/thinking-flag.test.ts` | Appended 5 tests (fake-run env rejection, USAGE level list, USAGE clamp warning, CLI↔adapter union mirror). The 8 Round 2 tests are untouched |
| `.agent_workspace/round3-opus-a.md` | This report |

**`src/cli/main.ts` needed no edit.** Round 2 already put the clamp sentence in
USAGE ("Google models silently clamp xhigh/max."), so the one change I was
allowed to make there was already landed. I left the file alone rather than
reword it, which also keeps it conflict-free for the other Round 3 agents.

Untouched as instructed: `src/pi-compat/`, `src/pi-adapter/`, skills, README,
`package.json`, docs.

## Test results

```
pnpm exec tsx --test test/unit/cli/thinking-flag.test.ts test/unit/pi-adapter/thinking-clamp.test.ts
# tests 18  # pass 18  # fail 0

pnpm exec tsx --test "test/unit/pi-adapter/*.test.ts" "test/unit/cli/*.test.ts"
# tests 73  # pass 73  # fail 0
```

`pnpm typecheck` clean over the whole repo; `eslint` clean on both files. Full
`pnpm gate` deliberately not run — R3-opus-B owns it and my files pass on their
own.

## Task 1 — `--thinking` validation still covers all seven levels

Unchanged and still asserted by the Round 2 tests (`every accepted level
round-trips`, plus the two error-message tests naming
`off, minimal, low, medium, high, xhigh, max`). I added two guards around them:

- **USAGE cannot drift from validation.** The new test parses the level list out
  of `pi-sparkle help` (`--thinking <off|…|max>`), feeds every documented level
  through `resolveThinkingLevel`, and asserts the parsed list equals the seven
  accepted levels. The regex tolerates the USAGE line being re-wrapped.
- **The CLI union cannot drift from the adapter's.** ADR-001 keeps the CLI on
  its own `THINKING_LEVELS`, so the two lists are independently editable. A
  compile-time `SameUnion<ReturnType<typeof resolveThinkingLevel>,
  SparkleThinkingLevel>` assertion fails `tsc` if a level is added on one side
  only. (Type-only import of our own adapter type; no Pi import in the CLI.)

## Task 2 — the Google clamp is documented, not changed

Nothing in this repo clamps, and nothing here now does either. The new file
records Pi 0.84.3's behaviour so the CLI's warning stays honest across pin
bumps. Its header says so explicitly: a failure means Pi moved and the docs
need an edit, not that the adapter regressed.

1. **The adapter forwards `xhigh`/`max` untouched.** Faux-provider run per
   level; the `reasoning` option that reaches `streamSimple` equals the
   requested level. (`test/integration/pi-adapter/stream-options.test.ts`
   covered `low` only, and for a different reason — verbatim option spread.)
2. **Telemetry keeps the requested level.** The three runs produce three
   distinct `config.parameterHash` values, so a clamped provider run is still
   distinguishable from a genuine `high` run in the invocation log.
3. **No builtin Google model accepts `xhigh`/`max`** — iterates every
   reasoning-capable model in `google` and `google-vertex` from pi-ai's
   generated catalog. This is the tripwire for a Gemini level above HIGH.
4. **Pi clamps `xhigh`/`max` to `high` for those models** — via pi-ai's public
   `clampThinkingLevel`, which is exactly what
   `dist/api/google-generative-ai.js` and `google-vertex.js` call before
   `resolveGoogleThinkingLevel`.
5. **A model that advertises `xhigh` keeps it** (today `anthropic/claude-fable-5`
   and `xai/grok-4.6`), so the clamp is a model capability, not a global cap —
   the reason the CLI must not pre-clamp.
6. **The Google type ceiling matches the how-to.** Compile-time equality
   assertions on `GoogleApiThinkingLevel`
   (`THINKING_LEVEL_UNSPECIFIED|MINIMAL|LOW|MEDIUM|HIGH`) and
   `ResolvedGoogleThinkingLevel` (`minimal|low|medium|high`). Verified the
   tripwire bites: adding `"XHIGH"` to the expected union makes `tsc` fail with
   `TS2322` at that line; reverted.

No hardcoded model ids anywhere — every Google assertion iterates the catalog,
so a pin bump that renames models does not need an edit here.

## Task 3 — invalid env still fails a fake `run`

Not reverted, and now pinned by a test that Round 2 did not have: `run
--executor fake` with `PI_THINKING_LEVEL=ultra` and no `--thinking` exits 1 with
**empty stdout** (no `COMPLETED`), so the fake executor never starts. Round 2's
test asserted the message but ran without `--executor fake`, which left room for
a future "fake path skips thinking resolution" shortcut to pass.

**One inconsistency I documented rather than fixed:** an invalid `--thinking`
flag reports `stage: "parse-args"` (explicit `cliFail` in `runCommand`), while an
invalid `PI_THINKING_LEVEL` reports `stage: "validation"` — it throws
`DomainValidationError` from `resolveThinkingLevel` and lands in `main`'s
catch-all at `src/cli/main.ts:1510`. Both reject before any run starts, so
behaviour is right; only the stage label differs. My test asserts `command:
"run"` and the message, not the stage, so it holds either way. Making both
`parse-args` is a one-line `main.ts` change outside my scope — parent's call,
and it would be a (small) contract change to the error JSON.

## Notes for the parent

- The new file imports pi-ai directly (root exports only:
  `clampThinkingLevel`, `getSupportedThinkingLevels`, `createModels`, faux
  helpers, plus `providers/all`). That matches `test/integration/pi-adapter/`
  precedent and does not touch the ADR-001 boundary, which scans `src/` only
  (`test/unit/pi-boundary.test.ts`). No deep `pi-ai/api/*` imports: I checked
  that `clampReasoning` and `resolveGoogleThinkingLevel` are reachable there and
  chose the root-export path instead so the test does not pin Pi internals.
- Runtime cost is small: the clamp file runs in ~0.5 s, mostly the three faux
  agent turns.
- `resolveGoogleThinkingLevel(model, "xhigh")` actually **throws**
  (`Unsupported Google thinking level mapping`) — the provider always clamps
  first. Worth knowing if anyone ever proposes passing a raw level deeper; not
  asserted, since it would pin an internal module.
