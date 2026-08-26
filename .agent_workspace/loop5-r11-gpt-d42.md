KEEP

# D42 landing recheck

Reviewed PR [#28](https://github.com/Xhhemoing/pi-sparkle/pull/28) at
`30ba55961fe937a4d37b65b71a765c261b1a8753` against
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`9cc8761a944b1bd579cba1066e3aa6f1f86f58a4`.

- Blank and whitespace-only `--outcome` values are refused as `parse-args`
  after terminal `--status` validation and before lock acquisition. Both
  append-only logs remain byte-identical; padded nonblank values are still
  accepted.
- A COMPLETED re-close of a FAILED episode now emits the same `already-closed`
  envelope as the FAILED path, with
  `next: "inspect --episode to see the terminal status"` and no duplicate bare
  `already-closed` line. The `acceptance-incomplete` WAITING disclosure,
  evidence line, and satisfy-evidence remedy remain unchanged.
- `episode events` refuses `--status` and `--outcome` as `parse-args` before
  reading either store, in plain and JSON modes. Refused probes against an
  absent state root created no state tree.
- Precedence matches the binding order: the literal no-episode/blank-root case
  reports missing `--episode`; adding a valid episode reports blank root before
  events-flag relevance; an unknown verb still wins first.
- The diff owns only `src/cli/episode.ts`,
  `test/integration/m3/episode-cli.test.ts`, and the implementer report. It
  touches no store, closure, or `main.ts`; `git diff --check` is clean.

Verification:

- `npx tsx --test test/integration/m3/episode-cli.test.ts`: 30 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- Independent operator-contract probes passed under `/tmp/r11-gpt-d42/**`.
