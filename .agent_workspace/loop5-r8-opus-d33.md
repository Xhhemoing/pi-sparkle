# Loop 5 · Round 8 · D33 — `episode` malformed-id guard + designed `events` lines

Slot: Opus-d33-episode-events (rank 3 implementer). Branch `cursor/episode-id-events-lines-0da8`,
based on `origin/cursor/pi-sparkle-sota-opt-0da8` at `09305ae`
(`docs(agent): record D31–D33; open Round 8`). Not merged to the integration branch — parent merges
after GPT-r8 KEEP.

Spec implemented exactly as written: `.agent_workspace/loop5-r8-fable-next.md` Rank 3, recorded as
D33 in `docs/agent-decisions.md`. D20/D26 (both KEEP) read first; nothing either owns changed.

## Files changed

- `src/cli/episode.ts` — the `isEpisodeId` guard, the `episodeEventLine` renderer, and the one call
  site that used to print `event.type`.
- `test/integration/m3/episode-cli.test.ts` — one updated pin, five new tests.

Nothing else was touched. `src/cli/main.ts`, `src/episode/events.ts`, `src/episode/manager.ts`,
`src/episode/store.ts`, `src/domain/ids.ts`, and `package.json` are byte-identical to the base
branch (`git diff --stat` shows exactly the two files above plus this report).

## 1. Malformed `--episode`

The bare `parseEpisodeId(values.episode)` is now preceded by an `isEpisodeId` guard, at the same
position as before: after the help/bare-subcommand handling and the required-`--episode` check, and
before the subcommand branches. `isEpisodeId` is the predicate `domain/ids.js` already exports —
the shape rule is not restated in the CLI.

```
command: "episode"
stage:   "parse-args"
message: invalid --episode "<raw>": expected an episode id of the form ep_<suffix>
next:    pass --episode <epId> as printed by pnpm cli list --state-root <stateRoot> --episodes
```

That `next` is the same episodes-list retarget both lookup paths already use, so the malformed and
the missing case hand the operator the same door. `parseEpisodeId` still runs immediately after, so
the branded type is unchanged and that call can no longer throw.

Position was deliberately **not** moved. Both outcomes the guard can mask — the unknown-subcommand
refusal and the close-dialect refusals — are themselves `parse-args` refusals naming a real
mistake, so `episode nonsense --episode banana` continues to report the id, per the spec.

Live probe on this VM (Node v22.14.0):

```
$ pnpm cli episode events --episode banana --state-root /tmp/d33probe/state
{"ok":false,"command":"episode","stage":"parse-args","message":"invalid --episode \"banana\":
 expected an episode id of the form ep_<suffix>","next":"pass --episode <epId> as printed by
 pnpm cli list --state-root /tmp/d33probe/state --episodes"}
```

(exit 1; before this change the same argv produced `stage: "validation"`, `Invalid EpisodeId:
expected "ep_<suffix>"`, and the doctor-preflight `next`).

## 2. Human `events` line format

One tab-separated line per event, timestamp first, from an exhaustive `switch` on `event.type` so
TypeScript narrows each shape to its own timestamp field. No shared timestamp field was invented —
there is none in `src/episode/events.ts`, which is exactly why this needed a designed format.

| type | line |
| --- | --- |
| `EPISODE_OPENED` | `${occurredAt}\tEPISODE_OPENED\t${episode.objective}` |
| `RUN_ATTACHED` | `${attachedAt}\tRUN_ATTACHED\t${runId}` |
| `EPISODE_WAITING` | `${occurredAt}\tEPISODE_WAITING\t${reason}${requiredEvidence.length > 0 ? `: ${requiredEvidence.join(", ")}` : ""}` |
| `EPISODE_CLOSED` | `${closedAt}\tEPISODE_CLOSED\t${status}${outcomeId !== undefined ? ` outcome=${outcomeId}` : ""}` |

Every field printed is already emitted by the `--json` path today, so this widens no disclosure
surface. `closeEpisode` sets `outcomeId` to `undefined` when the flag is absent and
`validateEpisodeEvent` drops the key before it lands, so an outcome-less close renders as bare
status with no ` outcome=undefined` tail.

Live probe, one episode carrying all three of its reachable types:

```
2026-08-25T21:39:55.946Z	EPISODE_OPENED	ship the operator contract
2026-08-25T21:39:55.947Z	RUN_ATTACHED	run_d33run01
2026-08-25T21:39:56.636Z	EPISODE_WAITING	acceptance-incomplete: tests
```

Before this change the same command printed `EPISODE_OPENED` / `RUN_ATTACHED` / `EPISODE_WAITING`
and nothing else — the operator could not see what the episode waits for or since when.

## `--json` confirmed unchanged

`episode events --json` still writes `JSON.stringify(event)` per row and is untouched by this diff.
Two pins hold it there:

- the pre-existing `deepEqual` of the type sequence (`["EPISODE_OPENED", "EPISODE_CLOSED"]`) in
  "episode close completes once every criterion has matching evidence and events are inspectable"
  passes unmodified;
- the new waiting-fixture test additionally asserts the `--json` stdout equals the **raw bytes of
  `<episodeId>.events.jsonl` on disk**, line for line, and that the decoded objects still carry
  `reason: "acceptance-incomplete"`. That is a verbatim-JSONL pin, stronger than a shape pin.

`EPISODE_USAGE` is unedited (it documents flags, not the line shape) and its exact-equality test
passes. The D20 `episode close` refuse-`--json` pin (message and `next` byte-for-byte) passes. The
`warnTruncatedJsonl` disclosure is unchanged; the truncated fixture still prints its one surviving
line, now timestamped.

## Tests

`test/integration/m3/episode-cli.test.ts` — 10 tests before, 15 after, all green.

Updated:

- **"a crash-truncated episode event log is disclosed and the surviving events still print"** — the
  `deepEqual` on `["EPISODE_OPENED"]` became a three-field assertion: exactly one line, three
  tab-separated fields, field 0 `Date.parse`s to a number, fields 1 and 2 are `EPISODE_OPENED` and
  the seeded objective. The truncation-warning pin is unchanged.

Added:

- **"episode events names what the episode waits for, and --json keeps its raw bytes"** —
  WAITING via the existing refused-COMPLETED-close fixture; pins the whole `EPISODE_WAITING` detail
  field as `acceptance-incomplete: tests`, plus the raw-bytes and type-sequence `--json` pins above.
- **"episode events prints the closed status, and the outcome id only when one was recorded"** —
  CLOSED both ways in one state root: `ABANDONED` with no outcome renders `ABANDONED`, and
  `FAILED --outcome oc_r8probe` renders `FAILED outcome=oc_r8probe`.
- **"episode events prints the attached run id for a RUN_ATTACHED event"** — the event is seeded
  through `EpisodeEventStore.append`, so its shape had to pass `validateEpisodeEvent` to reach the
  log; the rendered line is a real event, not a test-only object.
- **"a malformed --episode is an argv refusal on events, not a validation failure"** — whole-field
  `parseCliErrorJson` pins (command, stage, exact message) with `next` matching `/--episodes/` and
  containing the state root; stdout empty.
- **"a malformed --episode is an argv refusal on close and writes nothing"** — same field pins on
  the other subcommand, plus the no-write pin: the episodes directory listing and the seeded
  episode's snapshot log bytes are identical before and after, so the refusal precedes the
  exclusive lock and both stores.

Two small helpers were added to the harness: `rawEventLogLines` (reads the JSONL off disk for the
byte pin) and `assertTimestampedLine` (the three-field shape assertion), alongside
`humanEventLines`, which runs the human `events` command and returns its lines.

## Verification

- `npx tsx --test test/integration/m3/episode-cli.test.ts` → **15/15 pass, 0 fail**.
- `node scripts/run-tests.mjs` (full suite) → **2290 pass, 0 fail, 1 skipped** (the skip is
  pre-existing).
- `npx tsc --noEmit` → clean. The renderer's exhaustive switch satisfies `noImplicitReturns` by
  narrowing, with no `default` branch and no cast.
- `npx eslint src/cli/episode.ts test/integration/m3/episode-cli.test.ts` → clean.
- Host Node is v22.14.0 against `engines: ">=22.19.0"` — pnpm warning only, no failure.

## Freeze / disjointness

No new `Event` type, no schema change, no `main.ts`, no `package.json`. The line format is a CLI
view of events that `validateEpisodeEvent` already accepted. `episode events --json`, the D20
`episode close` refuse-`--json` dialect, and `EPISODE_USAGE` are byte-identical. Disjoint from D31
(`pause.ts`/`inject.ts`) and D32 (`commits.ts`), and from PR #12's file list — `test/integration/m3/`
holds none of its files, and `src/cli/episode.ts` is not among them. `episode.ts` was last touched
by D26, closed KEEP; nothing D26 landed here (the `parseArgs`-only catch, the `--help` boolean
honored before state reads, the required-`--episode` refusal) changed.

Operator-contract work only: an argv id guard and a CLI rendering of already-validated events. No
auth, network, or access-control change.
