KEEP

# D39 landing recheck

Reviewed PR [#23](https://github.com/Xhhemoing/pi-sparkle/pull/23) at
`0f773dfa83693d11d73ff4510b16f42aa6159c3b` against
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`7898a56237515a27de13c3462d75b44cc9215616`.

- Blank `--state-root` uses the D37 `parse-args` fields with
  `command: "episode"`. Help, unknown-subcommand, and missing-episode answer
  first; the blank-root guard answers before `isEpisodeId`. Its `next` is
  path-free.
- The events catch surrounds only `EpisodeEventStore.readAll()`, converts only
  an uncoded `DomainValidationError`, preserves the store message, and uses the
  exact append-only / doctor-does-not-inventory-episode-logs `next` for both
  malformed JSON and an unknown event type.
- The close catch surrounds only snapshot `readAll()`, keeps the same
  classification, and uses the exact `list --episodes --json` / `errors[]`
  remedy. Fresh probes confirmed that the corrupt close changed neither the
  snapshot log nor the event log, and that `list` names the damaged snapshot in
  `errors[]`.
- A coded lock timeout is rethrown to `main` and retains the routed `locks[]`
  remedy. Existing D33 pins for dispatch, episode IDs, escaped event lines,
  byte-exact JSONL, and `EPISODE_USAGE` all pass; the command dialect remains
  `"episode"`.
- The candidate three-dot diff contains only `src/cli/episode.ts`,
  `test/integration/m3/episode-cli.test.ts`, and the implementer report.
  `git diff --check` is clean. The two newer base-side commits are documentation
  only and do not overlap the candidate source or test.

Verification from `/tmp/d39-recheck`:

- `pnpm install --frozen-lockfile` — passed; Node 22.14.0 emitted the expected
  warning against the repository's `>=22.19.0` engine.
- `npx tsx --test test/integration/m3/episode-cli.test.ts` — 23 passed, 0
  failed.
- `npx tsc --noEmit` — passed.
- Fresh live probes seeded only under `/tmp/r10-gpt-d39/**` confirmed the exact
  blank-root precedence, both corrupt-event envelopes, the corrupt-snapshot
  envelope and unchanged bytes, the `errors[]` inventory, and the held-lock
  route.
