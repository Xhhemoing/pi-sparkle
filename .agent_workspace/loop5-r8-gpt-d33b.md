# Loop 5 · Round 8 · D33b test-pin rider recheck

## Verdict: **KEEP**

The rider at `origin/cursor/episode-id-events-lines-0da8` (`9d47907`) satisfies
the prior FIX:

1. Both `requiredEvidence` entries contain a runtime backslash, tab, CR, and
   LF. The fixture enforces all four characters per field, the exact WAITING
   line includes every escape, and decoded JSON deep-equals the original
   unescaped `requiredEvidence` array.
2. Both raw-JSONL pins use `assert.equal(asJson.out.join(""),
   await rawEventLogText(...))`, where the helper returns the direct UTF-8 file
   contents. Neither raw-byte assertion trims or splits either side. Remaining
   `trimEnd().split("\n")` uses only parse human output.
3. `git diff 8ca3026..origin/cursor/episode-id-events-lines-0da8 --
   src/cli/episode.ts` is empty.

The original contracts also remain pinned and correct: unknown-subcommand
dispatch precedes episode-id validation; malformed IDs are refused on both
`events` and `close`; all four event formats are covered; `humanField` escapes
backslash, tab, CR, then LF and is applied to every unconstrained rendered
field; and `--json` retains the original unescaped values.

`src/episode/events.ts` and `src/cli/main.ts` have identical base/target blob
IDs. Extracted `EPISODE_USAGE` content is also identical. After `8ca3026`,
`08219b2` changes only the integration test and `9d47907` changes only the
implementer report; there is no later implementation delta.

Verification from the detached target worktree:

```text
npx tsx --test test/integration/m3/episode-cli.test.ts
17 tests, 17 pass, 0 fail
```
