# Loop 5 · Round 11 — D42 as corrected by GPT-r11-challenge

Branch `cursor/episode-outcome-flags-0da8` off `05566af`
(`docs(agent): record GPT-r11 FIX riders; reorder D40→D42→D41`).
Rank 2 per GPT's reorder: the blank-`--outcome` defect is a durable
append-only write, not wording. Files touched: `src/cli/episode.ts`,
`test/integration/m3/episode-cli.test.ts`, this note. No store, no
`src/episode/closure.ts`, no `src/cli/main.ts`, no `package.json`.

## What landed

1. **Blank `--outcome` → `parse-args`.** In the close branch, after the
   `--status` refusal and before the lock:
   `values.outcome !== undefined && values.outcome.trim() === ""` →
   `command: "episode"`, `stage: "parse-args"`,
   `message: 'invalid --outcome "<raw>": outcome id must be a non-empty string'`,
   `next: "pass --outcome <id> or omit it"`. Live at HEAD this wrote
   `"outcomeId":""` / `"outcomeId":"  "` into the append-only event log at
   exit 0. Any nonblank string is still accepted — the held any-string value
   domain is not reopened and no Outcome support is claimed.
2. **`already-closed` → the FAILED-path envelope, once.** When
   `!decision.canClose && decision.reason === "already-closed"`, the COMPLETED
   branch now returns the envelope the non-COMPLETED guard already issued:
   `stage: "close"`, `message: "already-closed"`,
   `next: "inspect --episode to see the terminal status"`, with the duplicate
   bare `decision.reason` stderr line skipped for that reason only. The
   `acceptance-incomplete` path keeps every byte: the WAITING_FOR_USER append
   and its disclosure note, the already-waiting note, the
   `acceptance-incomplete: tests` line, and the
   `satisfy required evidence or close as FAILED/ABANDONED` next.
3. **`events` refuses the close-only flags.** A supplied `--status` or
   `--outcome` on `episode events` is refused as `parse-args` before either
   store read and in both output modes:
   `message: 'episode events does not accept <flag>; <flag> applies to episode close'`,
   `next: 'drop <flag>, or use episode close'`.

## The GPT order FIX (binding, applied)

Fable's Rank 3 asked for a single order pin claiming that
`episode events --status FAILED --state-root ""` reports the blank root first.
GPT refuted that live: the literal argv reports
`episode command requires --episode <epId>`, because D39 placed missing
`--episode` ahead of the blank-root guard. The implemented and pinned order is
therefore D39's, unchanged:

1. help
2. unknown subcommand (D33 verb-before-flags)
3. missing `--episode`
4. blank `--state-root`
5. malformed episode id
6. events-only `--status`/`--outcome` relevance
7. store read

Fable's single pin was replaced with three assertions in one test: the literal
no-episode command keeps the missing-`--episode` report; the same command with
`--episode ep_evflags` added reports the blank root before judging `--status`;
and an unknown-verb probe carrying a malformed id, a status and a blank root
still reports `Unknown episode command: nonsense`. The new relevance guard sits
inside the `events` branch, after `parseEpisodeId`, so items 1–5 cannot move.

## Tests

`test/integration/m3/episode-cli.test.ts`: 23 baseline → 30, all passing.
Seven new tests: blank `--outcome` (`""` and `"  "`, on FAILED and COMPLETED,
whole-field refusal plus byte-compare of both logs); nonblank `--outcome`
still closes and `--status banana --outcome ""` still reports the status;
COMPLETED re-close of a FAILED episode (whole-field envelope, no
`satisfy required evidence`, no bare `already-closed` line, no write, and
stderr byte-identical to the FAILED path's); FAILED re-close unchanged;
`acceptance-incomplete` COMPLETED close pinned end-to-end on today's bytes;
`events --status`/`--outcome` in plain and `--json` modes plus a
success-path `--json` byte pin against the raw JSONL; and the three order pins.

## Freeze

No live R1, no topology, no new Event or stage value, no store/closure/`main.ts`
edit, `EPISODE_USAGE` untouched, `episode events --json` success bytes
identical (every new refusal precedes the store read). D33's dispatch order and
escaped-event rendering and D39's corrupt-log catches and blank-root order keep
their bytes. Disjoint from D40 (`src/cli/commits.ts`), D41 (`src/cli/inject.ts`)
and PR #12.

## Verification

- `npx tsx --test test/integration/m3/episode-cli.test.ts` → 30/30 pass.
- `npx tsc --noEmit` → clean.
- `npx eslint src/cli/episode.ts test/integration/m3/episode-cli.test.ts` → clean.
- `npx tsx --test test/unit/cli/list.test.ts test/unit/cli/readme-command-parity.test.ts`
  → 26/26 pass (the only other files mentioning the episode verbs).
