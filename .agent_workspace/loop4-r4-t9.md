# Round 4 R4-9 — derived/learned JSON stragglers made crash-atomic

Slot: R4-9 (P2/P3, crash-atomicity). Base `agent/opt-continuous`, no commit (as instructed).

## Outcome

Both non-atomic JSON writers now publish through the shared atomic writer, and both readers
fail closed with a code-discriminated typed error instead of a bare `SyntaxError`.

| File | Write | Read posture on damaged bytes |
|---|---|---|
| `runtime/routing/catalog-observed.json` (derived) | `writeFileAtomic` | `CatalogObservedCorruptError` / `CATALOG_OBSERVED_CORRUPT` |
| `adaptation/preferences.json` (learned) | `writeFileAtomicSync` | `PreferenceSnapshotUnreadableError` / `PREFERENCE_SNAPSHOT_UNREADABLE`, binding unchanged |

No API changed shape: `persistCatalogObserved`, `loadCatalogObservedSnapshot`, and the whole
preference-store surface keep their signatures, the store stays a process-global singleton, and
nothing rebinds it.

## Decision 1 — `catalog-observed.json` is derived, and still throws

The brief left the choice open between a typed error and treat-torn-as-absent. I chose the
typed error, and documented the reasoning in the class doc comment:

- Absent already means something specific here. `observedStatsForVersion` turns a missing
  version into `emptyObservedStats`, which every consumer reads as "this model version has no
  observations". Answering that question out of bytes we failed to read is an invented answer,
  not a missing one — the same distinction the file's own `optionalNumber` guards ("absent stays
  undefined, present 0 is kept, never coerce missing to 0").
- The recovery is cheap and stated in the message: rebuild with
  `buildCatalogObservedFromStateRoot` + `persistCatalogObserved`, or delete the file. Deleting is
  the explicit opt-in to absent-on-damage, so ENOENT stays the one silent path — and the only one.
- Scope is deliberately narrow: this is a **JSON-integrity** failure. Content that parses but
  carries unexpected shapes still degrades to `emptyObservedStats` through the existing
  `parseSnapshot`, because that is version skew between writers, not damage. A test pins both
  halves so the distinction cannot rot.

There is no production caller of `loadCatalogObservedSnapshot` yet (census: only the unit tests
call it; `deletion.ts` uses `catalogObservedPath` to unlink), so the blast radius of the throw is
a test surface plus any future reader, which now gets a `DomainValidationError` subclass with a
`code` rather than a `SyntaxError` from someone else's `JSON.parse`.

## Decision 2 — `preferences.json` fails closed on both sides

The evidence in the brief understated the hole. The old `configurePreferencePersistence` set
`persistFile` **before** loading, so a caller that logged or swallowed the `SyntaxError` left the
singleton bound to the damaged file, and the very next observation overwrote it. Reproduced
against the pre-change code (script under `/tmp`, old behaviour restored):

```
configure threw: SyntaxError - Unterminated string in JSON at position 50
file overwritten by the next observation: true
learned history remaining on disk: {"observations":[{"id":"evd_55fdf24b-…","scope":"user",…
```

That is the silent reset the brief forbids: learned, behaviour-bearing state destroyed and
replaced by a one-row store. Same script against the change:

```
configure threw: PreferenceSnapshotUnreadableError - preference snapshot at …/preferences.json
file overwritten by the next observation: false
learned history remaining on disk: {"observations":[{"id":"pref_1","scope":"user","sc
```

So the posture is:

- `loadFromDisk` parses and validates **before** touching any in-memory state, so a throw leaves
  observations, tombstones, and views exactly as they were.
- Binding happens only after a successful load, so the store keeps persisting where it did
  before and nothing can be written over bytes we could not read.
- Structural gate, not row validation: the store is the sole writer of its rows, so fields are
  trusted, but the shapes damage produces (truncation, a JSON array, `null`, a non-array
  `observations`, a non-string tombstone id) are rejected instead of quietly reading as an empty
  history. `{}`, `{"observations":[]}` and friends stay valid — a user with no preferences yet is
  a real state.
- Via the CLI this now surfaces as a `stage: "validation"` failure carrying the repair guidance
  (`main.ts:1701` classifies `DomainValidationError`), where before it was a raw `SyntaxError`
  under `stage: "execute"`.

## Disclosure — one additive edit outside the exclusive list

`src/persist/atomic-file.ts` gained a **new** export, `writeFileAtomicSync` (+
`AtomicWriteSyncOptions`), and a private `tempName` helper the two writers now share. The frozen
`writeFileAtomic(path, contents, options?)` signature and behaviour are untouched, and its
existing tests pass unchanged.

Why the file had to move at all: the preference store's API is synchronous
(`recordPreference`/`deleteObservation` persist inline) and the brief forbids changing it, so it
cannot await the async writer. The alternative — a temp+rename block inside `preferences/store.ts`
— is exactly what R1/T3 froze against ("no private tmp+rename copies may reappear"), so a shared
sync sibling is the only option that satisfies both rules. It reuses the same publish protocol,
the same `RENAME_FALLBACK_CODES`, the same `MAX_TEMP_NAME_ATTEMPTS`, and the same temp-name shape.

Reviewer note: the Round-3 freeze check "`git diff` over `src/persist/` is empty" will no longer
hold at HEAD. The diff there is this addition and the one-line `tempName` extraction inside the
private `openUniqueTemp`; nothing else in `persist/` changed. Its tests live beside the async
ones in `test/unit/persist/atomic-file.test.ts` (unowned but unclaimed this round — no other slot
lists `persist/`), because splitting a helper from its tests to respect a directory line would
have been worse. A source-level pin in the owned preferences test keeps the store on the shared
writer (`writeFileAtomicSync` present, no `writeFileSync(`/`renameSync(`).

## Tests

`test/unit/routing/catalog-observed.test.ts` (+7, 16 total):

- a reader looping beside two concurrent 2000-version persists only ever observes whole
  snapshots, and no `.tmp` survives;
- a temp abandoned by a crashed persist is neither adopted nor truncated, and does not block;
- a truncated snapshot throws `CatalogObservedCorruptError` — code, `name`, `path`,
  `instanceof DomainValidationError`, `cause instanceof SyntaxError`, message names the rebuild;
- a zero-byte file is corruption, not an absence of observations;
- the documented recovery works end to end (rebuild from `invocations.jsonl` over a corrupt file);
- parseable-but-unexpected JSON (`[]`, `null`, `{"versions":3}`, `{"schema":"v2"}`) still degrades
  to an empty snapshot — the version-skew half of the documented distinction.

`test/unit/preferences/persistence-atomic.test.ts` (new, 8 cases): exact published bytes
(unchanged from the old writer, which `deletion.test.ts`'s byte-identity assertion depends on),
no temp left behind, a crashed writer's temp untouched, valid round-trip of observations +
tombstones, the typed-error/no-silent-reset case above, zero-byte file, the rejected shape table,
the accepted empty-history shapes, and the shared-writer source pin.

### Negative controls (old behaviour restored, then reverted)

- `catalog-observed` back to `mkdir` + plain `writeFile` and an uncaught `JSON.parse`: 3 of the
  new cases fail, and the concurrency case fails with exactly the reported defect —
  `SyntaxError: Unexpected end of JSON input` from a reader that caught the file mid-write.
- preference store back to `writeFileSync` + bind-then-load: 4 of the 8 new cases fail
  (`unexpected error SyntaxError: Unterminated string in JSON at position 50`, plus the empty-file,
  shape-table, and shared-writer pins).

## Verification (this VM, Node v22.14.0)

- `pnpm test -- test/unit/preferences/ test/unit/routing/catalog-observed.test.ts test/unit/persist/atomic-file.test.ts` — **64/64 pass, 0 skipped, 3 consecutive runs** (the concurrency case is timing-sensitive).
- `npx eslint src/routing/catalog-observed.ts src/preferences/store.ts src/persist/atomic-file.ts test/unit/routing/catalog-observed.test.ts test/unit/preferences/ test/unit/persist/atomic-file.test.ts` — clean.
- `npx tsc --noEmit` (whole tree, with every other slot's in-flight edits present) — exit 0 when
  run right after the change. A later repeat reported exactly one diagnostic, in R4-2's new
  `test/integration/cluster/undelivered-mail.test.ts:10` (`TS2305`, importing
  `formatUndeliveredClusterMail` before `main.ts` exports it). No diagnostic in any file this
  slot touches, in either run.
- Downstream consumers of the changed modules: `test/unit/privacy/record-classes.test.ts`,
  `test/integration/m3/redaction.test.ts`, `test/integration/m4/preferences-cli.test.ts`,
  `test/unit/track/clarify-plan.test.ts`, `test/unit/routing/cost-calibration.test.ts` — all pass.
- **Not mine:** `test/unit/privacy/deletion.test.ts` fails 2 ("a run directory recreated by a live
  writer fails the delete loudly", "the run delete cannot report a subtree removal it did not
  verify"). Both are R4-1's in-flight run-lock work in `src/privacy/deletion.ts`: the first
  expects the old `/stop or cancel the run/` remedy wording against a message that now describes
  the cooperative lock, the second is a source-regex pin over `deleteRunRecords`'s body. Both
  assertions read `src/privacy/deletion.ts` (its uncommitted state) and neither path reaches
  preferences or the observed catalog. I did not revert R4-1's work to re-run them.
- No new skip introduced anywhere (`# skipped 0` on every owned run).

## Non-goals / left alone

- No `AtomicWriteOptions` seam on `persistCatalogObserved`: a crash-probe case would be the only
  consumer and `scripts/crash-probe.mjs` is R4-7's sole-owner file this round. The tear window is
  covered behaviourally by the concurrent-reader test.
- No re-export of the two error classes from `src/preferences/service.ts` (not in this slot's
  ownership, and the CLI's generic `DomainValidationError` handling already formats them).
- No row-level validation of preference observations, no schema version field, no change to
  `parseSnapshot`'s existing shape tolerance in `catalog-observed.ts`.
- `docs/` untouched — R4-8 owns the truth-up and coordinates at end of round. Two facts worth
  carrying there: `catalog-observed.json` throws `CATALOG_OBSERVED_CORRUPT` and is rebuildable,
  `adaptation/preferences.json` throws `PREFERENCE_SNAPSHOT_UNREADABLE` and is not.
