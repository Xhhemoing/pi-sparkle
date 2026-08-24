MODEL_SLUG: claude-opus-5-thinking-high-fast

# Round 2 — R2-opus-B (pi-compat CLI tests + npm script aliases)

Status: done. Not committed (parent orchestrator commits the round).

## Files written (all inside my exclusive paths)

| File | Change |
|---|---|
| `test/unit/cli/pi-compat.test.ts` | New. 6 tests over `main(["pi-compat", ...])` and `piCompatBreakage` |
| `test/unit/cli/doctor.test.ts` | Appended one test for the `pi-packages` / `pi-compat` doctor lines. Existing three tests untouched |
| `package.json` | Added exactly three scripts: `pi-compat`, `pi:latest`, `pi:probe`. No dependency or other script changes |
| `README.md` | Three new Commands rows for those scripts, directly above `pnpm test` |
| `.agent_workspace/round2-opus-b.md` | This report |

`src/cli/pi-compat.ts` needed no change: `piCompatBreakage` and `readSparklePackageJson` were already exported.

Untouched as instructed: `src/cli/main.ts` (R2-opus-A owns `--thinking`), `src/pi-adapter/`, `src/pi-compat/`.

## Test results

```
pnpm exec tsx --test test/unit/cli/pi-compat.test.ts test/unit/cli/doctor.test.ts
# tests 9  # pass 9  # fail 0
```

`pnpm typecheck` clean; `eslint` clean on both files. `test/unit/package/pi-manifest.test.ts` still passes after the `package.json` edit (4/4).

## What the tests cover

1. `pi-compat --offline` — exit 0, human output has `pinned: agent-core=<v> ai=<v>`, `mode: offline`, `latest: skipped (offline)`, a `status:` line from the closed status union, and an empty stderr.
2. `pi-compat --json` — stdout parses whole as a `PiCompatReport` with `offline: true`, no `latest` key, pins equal to `readPinnedPiVersions(readSparklePackageJson())`, a thinking-level list containing `high`, and `piCompatBreakage(report) === undefined` on the current pin.
3. `--offline --online` — exit 1, stdout empty, `parseCliErrorJson` gives `command: "pi-compat"`, `stage: "parse-args"`.
4. `--online` against an unreachable registry (`PI_COMPAT_REGISTRY_URL=http://127.0.0.1:1`, restored in `finally`) — fails closed: exit 0, `offline: false`, no `latest`, `status: "unknown"`, one stderr `warning:` line. Runs in ~15 ms and never leaves the host.
5. `piCompatBreakage` over synthetic reports: healthy → `undefined`; `status: "behind"` with a behind-latest finding → `undefined` (being behind is not breakage); `BROKEN: ` finding → the message with the prefix stripped, chosen over an earlier non-BROKEN finding; `legacy-GoogleThinkingLevel` → the legacy message; empty `thinkingLevels` → the no-levels message.
6. doctor on a tmp state root + tmp project — exit 0, `ok  pi-packages: agent-core=<semver> ai=<semver>`, `ok  pi-compat: status=<status>`, and no `FAIL` on either check.

Follows the existing `capture()` io helper style; the pi-compat file has its own local copy, matching how each CLI test file in `test/unit/cli/` is self-contained.

## Two judgment calls worth a review look

- **Pins are read, not hardcoded.** The brief asked for "human output contains pinned 0.84.3". I assert the printed line against the pins read from `package.json` at test time, plus `agentCore === ai` (the matching-pin invariant from the Round 1 brief) and a numeric-semver shape. Today that is exactly `pinned: agent-core=0.84.3 ai=0.84.3`, but the next pin bump will not need an edit in this file. Synthetic version comparison is already covered by `test/unit/pi-compat/check.test.ts`, and `pnpm pi:latest` is the intended tripwire for a stale pin.
- **`google-thinking` is asserted negatively.** The adapter probe currently reports `absent`, not `GoogleApiThinkingLevel`: per the Round 1 brief the Google rename was a no-code-change bump because the adapter never imported that type. So the tests assert only that the value is not `legacy-GoogleThinkingLevel`, which is the ADR-001 regression that matters. An `absent` → `GoogleApiThinkingLevel` transition would be a real adapter change and should not fail this test.

## npm scripts, verified by hand

| Script | Result |
|---|---|
| `pnpm pi-compat` | Prints the offline report, exit 0 |
| `pnpm pi:probe` | 4 `PASS` lines (both pins, legacy identifier absent, `ThinkingLevel` imports from agent-core only), exit 0 |
| `pnpm pi:latest --offline` | 3 `PINNED` lines, exit 0 |

`pi-compat` uses `tsx src/cli/main.ts pi-compat` so it works without a build, matching the existing `cli` script; extra flags pass through (`pnpm pi-compat --json`). `pi:latest` / `pi:probe` are plain `node` on the `.mjs` probes, matching `security:probe`.

## Notes for the parent

- I did not add the scripts to `gate` or `prerelease`. `pi:latest` reaches the network by default and `pnpm pi-compat` overlaps the `pi-compat` doctor check that `pnpm test` already exercises, so wiring either into the gate would trade determinism for no new coverage. `pnpm pi:probe` is offline and deterministic and could reasonably join `prerelease` next to `security:probe` if you want it enforced — that is a `package.json` scripts edit outside what I was scoped to.
- Full-suite `pnpm gate` deliberately not run: R2-opus-A is editing `src/cli/main.ts` concurrently, so a whole-repo run would report their in-progress state as mine. I ran my two files plus `pi-manifest`.
