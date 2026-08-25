# Loop 5 · Round 6 — GPT independent ranking challenge

Analysis only. Fetched and verified
`origin/cursor/pi-sparkle-sota-opt-0da8` at
`fb4b8659dff20f29acab81474b3cc11b3d3c044d`. Fable ranked at
`83beb1e37c9dee3088ad039a135b5cee98480eb8`; the only `src/` and `test/`
changes since that baseline are the now-KEEP D24 changes in
`src/cli/auth.ts` and `test/unit/cli/auth.test.ts`. D22 is also KEEP.
Neither free file set is used to manufacture another slot.

PR #12 was re-read live at open head `5c6376c`. Its source files remain
`src/adaptation/eval-routing.ts`, `src/cli/adapt.ts`,
`src/cli/inspect-format.ts`, `src/cli/main.ts`,
`src/feedback/redaction.ts`, `src/pi-adapter/runtime.ts`,
`src/run/flowchart-run.ts`, and `src/run/inspection.ts`. An exact
path-filtered diff found no ranked source or test file in PR #12.

Independent probes reproduced the three claimed surfaces:

- a run log with `RUN_CREATED`, `RUN_STARTED`, and a half-written terminal
  line produced a successful `RUN_LIST` row with status `RUNNING`,
  `errors: []`, and empty stderr;
- `episode events --help` and `commits preview --help` failed as
  `stage: execute` with the generic doctor remedy; `validate --bogus` and
  `pi-compat --bogus` did the same;
- `models list --json` and `models list --help` both failed as
  `stage: execute`.

## D25 — FIX

Keep rank 1: the silent shortened-history defect is real, the recency option
is useful, and the footprint is freeze-safe and PR-disjoint. Two details need
to be made load-bearing before implementation.

### `warnings` is a legal additive field, with one ordinary pin update

`EventStore.readAll()` and `EpisodeStore.readAll()` both return `recovery`,
but `inventory.ts` currently discards it. A warning is the correct result:
the recovered row remains useful, while treating it as `errors` would falsely
say it was unreadable.

There is no `Object.keys` pin or whole-object `deepEqual` on `RUN_LIST` or
`EPISODE_LIST`. The JSON tests pin fields individually, and D3 explicitly
permits additive keys with same-diff pin updates. Therefore an always-present
`warnings` array does not violate the frozen contract.

There is one non-frozen exact-shape collision that the landing must update:
`test/unit/run/inventory.test.ts` expects the two empty inventories to be
exactly `{ runs: [], errors: [] }` and `{ episodes: [], errors: [] }`.
Both must gain `warnings: []`. Untruncated success fixtures should also assert
an empty warning list; the current `err === []` CLI pins then remain true.

### `last-event` must sort instants, while id order remains the default

The existing id-order pin is load-bearing only for the inventory/default
contract. Keep both inventory sorts unchanged and keep absent `--sort`
equivalent to `--sort id`. Apply `last-event` only to a copied CLI row array,
after reading (status filtering may happen before or after because it is
order-preserving). This leaves the current id-order tests byte-for-byte valid.

Do not compare timestamp strings with `localeCompare`. `IsoTimestamp` accepts
offsets and preserves their original spelling:
`2026-08-25T23:00:00+14:00` is earlier than
`2026-08-25T10:00:00Z`, although lexical local-clock order says otherwise.
Compare `Date.parse(lastEventAt)` descending, then id ascending. Add an
offset-bearing pin as well as the id-inversion pin.

The proposed undefined-timestamp episode fixture cannot be produced through
`EpisodeStore`: `validateEpisode` requires `startedAt`, exactly as the
inventory type comment says. Keep the comparator's `undefined`-last branch,
but test it at a factored row-sort seam if one is introduced; do not weaken
episode validation or add a fake persisted shape just to reach it.

Corrected D25 stays within `src/run/inventory.ts`, `src/cli/list.ts`, and their
two existing unit-test files. No `main.ts`, Event, `RunStatus`, or PR #12 file
is touched.

## D26 — KEEP

The six-module argv/help batch is real operator pain and is already scoped
correctly. The required safety boundary is lexical: each `try/catch` must
contain only the synchronous `parseArgs(...)` call.

That boundary converts unknown options, missing option values, and parser
positionals to `stage: "parse-args"` without reclassifying later failures:

- `parseEpisodeId`, event/snapshot reads, and episode locking remain outside;
- commit input/checkpoint/file parsing and git work-tree checks remain outside;
- validate's spec/catalog catches retain their current validation/execute
  classification;
- migration scanning/publishing, package reads/online checks, and init
  filesystem writes remain outside.

Honor the new help booleans before any state read or mutation. Existing
`--help` handling in validate, migrate-legacy, and init remains valid;
episode, both commits subcommands, and pi-compat gain the missing placements.
No JSON/Event/frozen key set changes.

The optional inject rider is not needed for D26. It is a value-domain
preflight on a command whose `parseArgs` is already caught, not part of the
six missing parser boundaries. Leave it out of the mechanical landing; if it
is ever included, validate only `type`/finite `[0,1]` confidence explicitly
and do not widen a catch around run lookup or injection.

The six source files and six named test files are absent from PR #12. This
slot remains rank 2.

## D27 — FIX

Keep rank 3: machine-readable model configuration and the models error dialect
are real gaps, and the two-file footprint is PR-disjoint. Fix the JSON contract
before freezing it.

The proposed enabled shape encodes defaults twice: top-level `primary`/`fast`
strings, conditionally present, and per-row `primary`/`fast` booleans. Its
example omits the top-level keys while the following sentence requires them.
That is not an exact day-one key set, and the duplicate representations are
unnecessary.

Use one explicit discriminated contract:

- enabled mode always has top-level keys
  `type`, `preview`, `mode`, `primary`, `fast`, `models`;
  `primary` and `fast` are `string | null`, and each model row has exactly
  `id` and `inCatalog`;
- available mode has exactly `type`, `preview`, `mode`, `models`, and each row
  has exactly `id`.

This reports configured defaults even if a hand-edited valid config leaves a
default outside `enabled`, gives empty state a stable shape, and lets callers
derive row tags without freezing duplicate facts. Pin populated enabled,
empty enabled, unfiltered available, and provider-filtered available objects
with whole-object `deepEqual`, plus the one-compact-line assertion.

Describe this as stored model configuration, not “what a run will route to.”
Source shows explicit run flags and `PI_PROVIDER`/`PI_MODEL` can override the
stored defaults, and catalog construction has fallback aliases. `MODELS_LIST`
does not observe those per-run inputs.

As in D26, catches around the four models `parseArgs` calls must end
immediately after parsing. `loadProvidersConfig`, model-ref validation,
catalog imports/resolution, and config writes must not become parse failures.
`MODELS_LIST` remains a `preview: true` CLI view object outside the Event
union. PR #12's new README parity test checks top-level dispatched verbs and
`main.ts` usage, not the local `MODELS_USAGE` flag spelling, so it does not
create a path or contract collision.

## Verdicts

| Slot | Verdict | Action |
|---|---|---|
| D25 | **FIX** | Keep rank 1; add warnings, preserve default/inventory id order, compare timestamp instants, and correct the impossible undefined-snapshot test plan. |
| D26 | **KEEP** | Keep rank 2; catch only each `parseArgs` call and leave later domain/IO failures outside. Omit the optional inject rider. |
| D27 | **FIX** | Keep rank 3; freeze one non-duplicated discriminated `MODELS_LIST` shape and call it stored configuration, not effective per-run routing. |
