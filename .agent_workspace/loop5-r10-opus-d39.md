# Loop 5 · Round 10 — D39 (Opus-d39-episode-logs), as corrected by GPT-r10-challenge

Slot: Opus-d39-episode-logs. Branch `cursor/episode-corrupt-log-0da8`, cut from
`origin/cursor/pi-sparkle-sota-opt-0da8` at **`be4c7a9`**
(`docs(agent): record GPT-r10 FIX riders for D37–D39`), which was the latest origin tip at
dispatch. Not merged into the parent integration branch; no PR opened.

Files owned and touched — and only these three:

- `src/cli/episode.ts`
- `test/integration/m3/episode-cli.test.ts`
- `.agent_workspace/loop5-r10-opus-d39.md` (this file)

Untouched, deliberately: `src/episode/store.ts`, `src/run/episode-store.ts`, `src/cli/main.ts`,
`src/cli/errors.ts`, the D37/D38 verb modules, and `package.json`. The stores' refusal **messages
stay theirs**; only the envelope converts, inside the verb that owns it.

## The GPT argv-order FIX — the one place this implementation departs from raw Fable

Fable's Rank 3 item 3 said to place the blank-`--state-root` guard "at the resolution site
(`episode.ts:101`)". Taken literally that is wrong, and the GPT challenge (`D39 FIX`, correction 2)
is what was implemented instead: **line 101 sits above both help returns and above the
unknown-subcommand refusal**, so a guard placed there would make
`episode events --help --state-root ""` refuse instead of printing usage, and would answer
`episode nonsense --episode ep_probe --state-root ""` with a state-root complaint rather than
`Unknown episode command: nonsense`. Both would contradict D33's rule that the verb is settled
before that verb's flags are judged, and both would regress live behaviour that is already correct.

The shipped order in `episodeCommand` is therefore:

1. `parseArgs` (unchanged, including its parse-args catch).
2. The subcommand help return (`help` / `--help` / `-h` / `undefined`) — unchanged, still exit 1
   for `undefined` and exit 0 otherwise.
3. The `values.help === true` return — unchanged, exit 0.
4. The unknown-subcommand refusal (`Unknown episode command: …`, usage on stderr first) —
   unchanged.
5. The missing-`--episode` refusal — unchanged.
6. **NEW** — blank `--state-root` (`values["state-root"] !== undefined && …trim() === ""`):
   `command: "episode"`, `stage: "parse-args"`,
   `message: 'invalid --state-root "<raw>": state root must be a non-empty directory path'`,
   `next: "pass --state-root <dir> or omit it to use the default ~/.pi-sparkle"` — D37's exact
   bytes, path-free `next` per the D34 rider.
7. `const stateRoot = rawStateRoot ?? join(homedir(), ".pi-sparkle")` — the resolution moved down
   from line 101 to here, and nothing above it reads a root.
8. `isEpisodeId`, whose `next` interpolates the resolved root — unchanged bytes, now unreachable
   with a blank root, so it can no longer print `list --state-root  --episodes`.

For `events` and `close` with real subcommands and ids, the guard is ahead of every store read and
ahead of lock acquisition.

D33's command spelling is kept: `command: "episode"` on every refusal in the module. No
`episode events` / `episode close` dialect was invented.

## Corrupt-log conversion

Both catches classify identically and narrowly —
`error instanceof DomainValidationError && errorCodeOf(error) === undefined` — via one local
`isCorruptLogError` type guard, and **rethrow everything else**.

- Around `new EpisodeEventStore(stateRoot, episodeId).readAll()` only:
  `stage: "validation"`, the store's `message` bytes verbatim, and
  `next: "the episode event log is append-only and pi-sparkle never rewrites it: repair or move
  aside the file named above, then retry; pi-sparkle doctor does not inventory episode logs"`.
- Around `snapshots.readAll()` inside the close lock only:
  `stage: "validation"`, the store's `message` bytes verbatim, and
  `next: "the episode log is append-only and pi-sparkle never rewrites it: repair or move aside
  the file named above; pnpm cli list --episodes --json lists the readable episodes and names
  damaged records under errors[]"`.

`decideClosure`, both appends, and lock acquisition keep today's paths — the catch is around
`readAll` only. A **coded** `DomainValidationError` (the `FileLockTimeoutError` / `LOCK_TIMEOUT`
family) is rethrown and still reaches `main.ts`, which keeps routing it to the `locks[]` remedy.
That is not an argument in a comment: it is pinned by a held-lock test.

## Live probes on this branch

Seeded only under `/tmp/probe/**`; invoked through `node_modules/.bin/tsx src/cli/main.ts`. Every
refusal exited 1 unless an exit is stated.

- `episode events --episode ep_corrupt --state-root /tmp/probe/state` →
  `{"ok":false,"command":"episode","stage":"validation","message":"Invalid JSON at line 1 in
  /tmp/probe/state/runtime/episodes/ep_corrupt.events.jsonl","next":"the episode event log is
  append-only …; pi-sparkle doctor does not inventory episode logs"}`.
- `episode events --episode ep_badevent …` → same envelope with
  `Invalid episode event at line 1 in …/ep_badevent.events.jsonl: Unknown EpisodeEvent.type: BANANA`.
- `episode close --episode ep_badsnap --status FAILED …` → `stage: "validation"`,
  `Invalid JSON at line 1 in …/ep_badsnap.jsonl`, and the `list --episodes --json` / `errors[]`
  next.
- `episode events --episode ep_probe --state-root ""` →
  `{"ok":false,"command":"episode","stage":"parse-args","message":"invalid --state-root \"\":
  state root must be a non-empty directory path","next":"pass --state-root <dir> or omit it to use
  the default ~/.pi-sparkle"}`.
- `episode events --help --state-root ""` → `EPISODE_USAGE` on stdout, **exit 0**.
- `episode nonsense --episode ep_probe --state-root ""` → `Unknown episode command: nonsense`.

## Tests

`test/integration/m3/episode-cli.test.ts` grew from 17 to **23** tests; the 17 existing ones are
byte-untouched apart from one added `writeFile` import and new shared helpers above them.

- Whole-field `deepEqual` pins for the three corrupt-log envelopes (events bad JSON, events
  undecodable event, close bad snapshot), including the exact `next` strings.
- The close refusal writes nothing: both `<id>.jsonl` and `<id>.events.jsonl` are byte-compared
  either side of the refused close, so no WAITING_FOR_USER snapshot and no closing event can hide
  behind it.
- Blank-root pins for `""` and `"  "` on both `events` and `close`.
- Help and unknown-subcommand pins with `--state-root ""`, holding the D33 dispatch order.
- Passthrough pin: a pre-created `runtime/episodes/<id>.lock` drives `close` into its bounded
  five-second wait, and the refusal is asserted to be main's — `stage: "validation"`,
  `timed out waiting for lock at …`, and the routed
  `run pi-sparkle doctor --json --state-root <root> and read locks[] …` next.

The corrupt-log fixtures prepend the damaged row *before* the seeded rows, so
`readJsonlObjects` cannot treat it as a crash-truncated tail and fails closed — which is what the
two existing truncation pins (`warning: ignored truncated …`, exit 0) distinguish themselves from,
and both of those still pass unchanged.

Held: D33 dispatch order, `isEpisodeId` bytes, escaped events-lines, byte-exact `--json` JSONL, and
`EPISODE_USAGE`. The `--json` success path is unreachable from every new refusal.

## Verification

- `npx tsx --test test/integration/m3/episode-cli.test.ts` → **23/23 pass** (17 baseline + 6 new).
- `npx tsc --noEmit` → clean.
- `npx eslint src/cli/episode.ts test/integration/m3/episode-cli.test.ts` → clean.
- `npx tsx --test test/unit/run/episode-bind.test.ts test/unit/cli/list.test.ts
  test/unit/cli/doctor-routed-next-freeze.test.ts` → 34/34 pass (the two other files that import
  the episode CLI or pin the routed-next table this change relies on).

## Freeze gate

No live R1; ADR-006 stays Proposed; no new `Event` types; no store schema change; no new stage
value (`parse-args` and `validation` both already existed in this module); `episode events --json`
success bytes identical; `main.ts`, `errors.ts` and both stores untouched; `package.json`
untouched. `episode.ts` is reopened outside D33's closed scope (id guard, dispatch order, events
lines) — none of those classified the corrupt-log envelope or the blank root, and all of them keep
their bytes. `next` text stays operator-contract language with no raw operator path in it.
