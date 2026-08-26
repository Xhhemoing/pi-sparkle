# Loop 5 · R7 · D30 independent landing recheck

Target: `origin/cursor/inject-preflight-0da8` at
`c2be255702347c7312560a1fce5ba97da76fe0f3`

Parent: `origin/cursor/pi-sparkle-sota-opt-0da8`; the target's direct parent is
`6a7c2dd5838a7f146615b9beac6407fa3d98a6df`.

Ranked contract: GPT D30 FIX plus Fable Rank 3.

## Verdict: KEEP

Land D30 as submitted. No contract bytes remain.

1. **PASS — shared type authority and refusal order.** `inject.ts` imports the
   exported `INJECTION_KINDS` from `src/run/injection.ts`; it does not restate
   the accepted set, and `injection.ts` is byte-unchanged. Unknown type reports
   `command: "inject"`, `stage: "parse-args"`, the supplied `runId`, the exact
   kind message, and the type remedy. That check follows only the required
   `--run`/`--type` check, so it precedes every per-type required-argument
   check, `parseRunId`, and `EventStore` lookup.

2. **PASS — confidence domain.** The raw confidence is checked with
   `trim() === ""` before the single `Number(raw)` conversion. The converted
   value must then be finite and within inclusive `[0,1]`. Empty, whitespace,
   `banana`, `2`, and `-1` are pinned as `parse-args` refusals with the supplied
   run ID and confidence remedy. Boundary values `0` and `1` are pinned through
   successful plane calls.

3. **PASS — failure boundary and precedence.** The only catch remains the
   lexical `parseArgs` catch. `EventStore.readAll()` and
   `injectFlowchartRun()` remain outside it, so lookup and plane failures keep
   their existing classifications. A direct missing-run probe with
   `--type banana` reported the type at `stage: "parse-args"` and did not report
   the missing run. A second missing-run probe with whitespace confidence also
   refused at `parse-args`.

4. **PASS — footprint.** The commit changes only `src/cli/inject.ts` and
   `test/integration/cli/pause-inject.test.ts`. There is no `main.ts` change.

Verification: the exact target passed all 19 tests in
`test/integration/cli/pause-inject.test.ts`. Direct bad-type and whitespace
confidence probes reproduced the required structured reports.
