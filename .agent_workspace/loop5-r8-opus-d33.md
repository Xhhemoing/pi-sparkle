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
(**Superseded by the GPT-r8 rider below, item A**: the unknown-subcommand refusal now runs first.)

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

---

# Rider — GPT-r8-challenge **FIX** on D33 (slot kept)

Landed on the same branch as commit `8ca3026`, on top of the Fable-spec landing (`9613791`). Both
items below are operator-contract only; no auth, network, or access-control change. Files touched
are still just `src/cli/episode.ts` and `test/integration/m3/episode-cli.test.ts` (plus this
report). `src/episode/events.ts` was not edited.

## A. Unknown subcommand now precedes episode-id validation

Fable kept the id guard ahead of the subcommand branches, which made
`episode nonsense --episode banana` report the id. GPT-r8 called that the wrong operator order, and
it is: no `--episode` value could have made that argv work, so naming the id first describes a
defect the operator cannot act on while hiding the one they can.

The existing `subcommand !== "events" && subcommand !== "close"` refusal now runs immediately after
`parseArgs` and the help handling, **before** the required-`--episode` check and before the
`isEpisodeId` guard. Its contract is carried over unchanged — `stage: "parse-args"`,
`message: "Unknown episode command: <subcommand>"`, `next: "use episode events or episode close"`,
and `EPISODE_USAGE` still written to stderr ahead of the report. The old late copy of the check
(the `subcommand !== "close"` block that sat after the `events` branch) was removed rather than
duplicated; TypeScript narrows `subcommand` to `"events" | "close"` through the hoisted guard, so
the close path below it is unchanged and `tsc` stays clean with no cast.

One knock-on, intended and unpinned anywhere: `episode nonsense` with no `--episode` at all now
reports the unknown verb instead of "episode command requires --episode <epId>". Grep confirms no
test or doc pinned either message before this rider.

Live probe:

```
$ pnpm cli episode nonsense --episode banana
{"ok":false,"command":"episode","stage":"parse-args","message":"Unknown episode command: nonsense",
 "next":"use episode events or episode close"}
```

Malformed-id whole-report pins are kept on both **real** subcommands (`events` and `close`), and
both were upgraded from field-by-field assertions to a single `deepEqual` against a shared
`malformedIdReport(stateRoot)` expectation covering `ok`/`command`/`stage`/`message`/`next`.

## B. Control characters escaped in human detail fields

Fable interpolated operator-authored strings raw. The event schema constrains timestamps, ids and
statuses, but leaves the objective, the waiting reason, each evidence entry and the outcome id free
text — so a tab or a newline in any of them forged a column or a whole row in a tab-separated,
one-line-per-event surface.

One module-local helper, `humanField`, applies exactly four replacements **in this order**:

1. `\` → `\\`
2. tab → `\t`
3. CR → `\r`
4. LF → `\n`

(right-hand sides being literal backslash escape text). Backslash goes first, or the escapes the
helper introduces would be indistinguishable from a backslash the operator typed.

Applied to the OPENED objective, the ATTACHED run id, the WAITING reason and each evidence entry,
and the CLOSED outcome id. `status` and the timestamps are schema-constrained and pass through
untouched. The simple-value output is byte-identical to Fable's landing:

```
<occurredAt>\tEPISODE_OPENED\t<escaped objective>
<attachedAt>\tRUN_ATTACHED\t<escaped runId>
<occurredAt>\tEPISODE_WAITING\t<escaped reason>[: <escaped evidence joined by ", ">]
<closedAt>\tEPISODE_CLOSED\t<status>[ outcome=<escaped outcomeId>]
```

No currently valid event is rejected — the events are already validated and persisted, and a reader
that refuses to print one is worse than one that prints it unambiguously. Escaping is display-only:
`--json` is byte-identical and still emits the raw JSONL. `EPISODE_USAGE` is untouched.

Live probe through `cat -A` (`^I` is a tab, `$` a newline), one event per line with exactly two
structural tabs each:

```
2026-08-25T21:45:59.862Z^IEPISODE_OPENED^Iship\\now\tfast\r\nplease$
2026-08-25T21:45:59.862Z^IRUN_ATTACHED^Irun_riderrun1$
2026-08-25T21:45:59.862Z^IEPISODE_WAITING^Iblocked\ton\nreview: tests\tunit, docs\nadr$
2026-08-25T21:45:59.862Z^IEPISODE_CLOSED^IFAILED outcome=oc\\1\tb$
```

The seeded objective/reason/evidence/outcome carried real tabs, CRs and LFs; `wc -l` on the same
command returns 4 for the four events.

## Rider tests

`test/integration/m3/episode-cli.test.ts`: 15 → 17, all green. Every Fable pin is kept — the
four-type whole-line pins, the `Date.parse` timestamp assertions, both lookup retargets, the
truncation disclosure, and the malformed-close no-write pin all still run unmodified except for the
two malformed-id reports upgraded to whole-report `deepEqual`.

- **"an unknown episode subcommand is refused before the --episode value is judged"** — runs
  `episode nonsense --episode banana` (a malformed id deliberately present) and `deepEqual`s the
  whole report, plus pins that stderr still opens with `EPISODE_USAGE` and stdout is empty.
- **"episode events escapes control characters so one event is always one line"** — a fixture whose
  objective, reason, every evidence entry and outcome id each carry a literal backslash plus tab,
  CR and LF (**this claim was false when written** — the evidence entries carried neither a
  backslash nor a CR; corrected in the recheck rider below, item 1),
  appended through `EpisodeEventStore.append` so all four rows had to pass
  `validateEpisodeEvent`. It pins: exactly four physical lines (`raw.slice(0, -1).split("\n")`),
  no raw `\r` or `\n` anywhere in a line, exactly two structural tab delimiters per line, and the
  four exact escaped lines written out longhand rather than through the renderer's own helper, so
  the test pins the format and not the implementation. It then pins `--json` twice over: stdout
  equals the raw on-disk JSONL line for line, and the decoded events `deepEqual` an explicit array
  carrying the operator's **unescaped** originals — the escape is proven display-only.

## Rider verification

- `npx tsx --test test/integration/m3/episode-cli.test.ts` → **17/17 pass, 0 fail**.
- `node scripts/run-tests.mjs` (full suite) → **2292 pass, 0 fail, 1 skipped** (pre-existing skip).
- `npx tsc --noEmit` → clean; `npx eslint` on both files → clean.
- Host Node v22.14.0 against `engines: ">=22.19.0"` — pnpm warning only.

---

# Rider 2 — GPT-d33-recheck **FIX** (test pins only)

Landed as commit `08219b2`. GPT-d33-recheck confirmed the source behavior at `8ca3026` is correct
and required no change to it; the two defects were in my pins, which did not hold the contract they
claimed. This rider touches `test/integration/m3/episode-cli.test.ts` and this report only —
`src/cli/episode.ts`, `src/episode/events.ts` and `src/cli/main.ts` are untouched by it, and
`git diff` against the previous commit lists the one test file.

## 1. Every evidence entry now exercises all four replacements

The fixture's evidence array was `["tests\tunit", "docs\nadr", "plain"]`: no entry carried a
backslash, none carried a CR, and no single entry exercised all four replacements. It is now

```ts
const requiredEvidence = ["tests\\one\tunit\r\nlinux", "docs\\two\tadr\r\nreview"];
```

and the WAITING-line expectation was updated to the matching longhand escapes. The decoded-JSON
deep-equality pin still compares against the same unescaped array, so the round trip is unchanged.

This was a real hole, not a cosmetic one, because evidence is escaped through its **own** per-entry
`map(humanField)` call rather than the single interpolation the other fields use. I demonstrated the
gap by mutation: replacing that call with an evidence-only escape that handles tab and LF but
neither backslash nor CR —

```ts
event.requiredEvidence.map((e) => e.replaceAll("\t", "\\t").replaceAll("\n", "\\n")).join(", ")
```

— left the **old** fixture passing 17/17, and fails the corrected fixture. GPT's reading was exact.

I also made the fixture's own claim enforceable rather than a comment: a loop over
`[objective, reason, ...requiredEvidence, outcomeId]` asserts each field contains all four
characters, so a later edit cannot silently weaken the coverage without failing the test. The
overstated sentence in the Rider 1 test list above has been marked false-when-written.

## 2. Raw-JSONL pins are byte-exact

Both pins that claimed verbatim JSONL applied `trimEnd().split("\n")` to each side, which normalises
away exactly the drift the claim is supposed to exclude — a lost, added or altered trailing newline
would still have passed. The helper `rawEventLogLines` is replaced by `rawEventLogText`, which
returns the file contents unmodified, and both tests now compare directly:

```ts
assert.equal(asJson.out.join(""), await rawEventLogText(stateRoot, episodeId));
```

Mutation-checked as well: making the `--json` branch omit the final newline leaves **both** tests
failing (11 and 17), where the old normalising form would have passed. The explicit parsed-event
deep-equality pin proving the operator's originals survive unescaped is retained in both tests.

## Live probe of the corrected fixture

```
$ pnpm cli episode events --episode ep_rcprobe01 --state-root /tmp/d33rc/state | cat -A
2026-08-25T21:53:52.019Z^IEPISODE_WAITING^Iblocked\\hard\ton\r\nreview: tests\\one\tunit\r\nlinux, docs\\two\tadr\r\nreview$

$ pnpm cli episode events --episode ep_rcprobe01 --state-root /tmp/d33rc/state | wc -l
1

$ pnpm cli episode events ... --json | cmp - .../ep_rcprobe01.events.jsonl
byte-identical
```

Two structural tabs (`^I`) and one newline (`$`) for the event, both evidence entries rendered with
all four escapes, and `cmp` confirming the `--json` stream matches the log file byte for byte.

## Verification

- `npx tsx --test test/integration/m3/episode-cli.test.ts` → **17/17 pass, 0 fail**.
- `node scripts/run-tests.mjs` → **2292 pass, 0 fail, 1 skipped** (pre-existing skip).
- `npx tsc --noEmit` and `npx eslint` on the test file → clean.
- Mutation checks above ran against temporary edits to `src/cli/episode.ts` that were restored from
  a pre-mutation copy; `git status` confirms the file is unmodified in the committed tree.

Test pins only — no auth, network, or access-control change.
