# Round 5 R5-3 — the bandit store stops silently resetting on damage

Slot: R5-3 (P2, learned-state atomicity). Base `agent/opt-continuous` at `6975aab`, no commit, no
branch change (as instructed). Owned files only: `src/learning/bandit-store.ts`,
`test/unit/learning/bandit-store.test.ts`, new `test/unit/learning/bandit-store-atomic.test.ts`.

## Outcome

`updateProjectBandit` publishes through the frozen `writeFileAtomic`, and the reader fails closed
with `BanditStateUnreadableError` / `BANDIT_STATE_UNREADABLE` instead of turning every parse or
shape failure into `undefined`. The silent reset the brief describes is reproduced against the old
code and closed by the new code (evidence below). Adaptation plane only: no live routing wiring, no
reward-semantics change, `writeFileAtomic` consumed as published, `persist/` and `package.json`
untouched.

## Census first (what the brief said, and what HEAD actually holds)

The brief's evidence reproduced exactly, with three additions worth having on the record:

1. **Both defects confirmed.** `updateProjectBandit` wrote pretty multi-line JSON with plain
   `writeFile` under the lock (`:125-126` at HEAD), and `readBanditFile` (`:58-70`) returned
   `undefined` for a parse failure *and* for any `isBanditState` mismatch.
2. **The tear window is the truncate, not the payload size.** `writeFile` opens `O_TRUNC`, so a
   reader that catches the window sees a *zero-byte* file, not a half-document. That is why the old
   `raw === ""` branch — which conflated ENOENT with an empty file — was itself part of the defect:
   the most likely torn state read as "this project has never learned". Measured in the negative
   control below: every torn read observed an empty file.
3. **Blast radius of a throw.** `updateProjectBandit` has exactly one production caller,
   `learning/auto-loop.ts:174`, behind the `isAutoAdaptEnabled()` gate; `loadProjectBandit` still
   has zero production callers (pinned by `test/unit/routing/live-isolation.test.ts`). Reaching the
   operator, the new error lands in three different postures, none of which I changed:
   - `pi run --children` (`cli/main.ts:886-902`) already wraps the loop in try/catch and prints
     `adapt skipped: <message>` — a damaged bandit file discloses itself and the run still reports
     its own status.
   - `pi adapt auto` and the tracked-run path (`track/loop.ts:173`, uncaught) propagate it, and
     `main.ts:1776` classifies a `DomainValidationError` as `stage: "validation"`, so the repair
     guidance in the message is what the operator sees. Before this change the same paths would
     have quietly relearned from zero.

## Decision — torn is damage, unknown keys are skew

Per R4-9's doctrine, the read posture follows what the state *is*. Bandit pulls and rewards are
learned and not recomputable from any log — unlike `catalog-observed.json`, which is derived and
rebuildable — so there is no cheap recovery to offer and refusing is the only honest answer. Both
halves are documented on the error class and pinned in tests:

| Half | Content | Behaviour |
|---|---|---|
| **Damage** | unparseable JSON; an empty file; non-object envelope; `arms` not an array of distinct non-empty ids; `pulls`/`rewardSum` not objects; a counter naming an arm absent from `arms`; a missing or ill-typed per-arm counter; `rewardSum[arm] > pulls[arm]`; `explorationsUsed`/`highRiskExplorations` not non-negative integers | `BanditStateUnreadableError` (`code: "BANDIT_STATE_UNREADABLE"`, `path`, `cause` for the JSON case). The file is left byte-identical and nothing is written back — the read happens inside the lock, before the publish. |
| **Version skew** | a document whose bandit core reads cleanly but which carries additional top-level keys this version does not know (e.g. `schemaVersion`, `decayHalfLifeRuns`) | Loads. The learned core is preserved and updated; the unknown keys are dropped at the read boundary and absent from the next publish. Documented as an accepted loss: refusing them would leave an older binary unable to run at all against a newer file, and the counters are the only thing this plane learns. |

The damage gate is the *same* structural gate the old `isBanditState` applied — I did not tighten
or loosen what counts as a valid document, only what happens when it fails. `readBanditDocument`
returns the defect string so the error can name it (`rewardSum.model-a exceeds its pull count`),
and rebuilds the state from validated fields only, which is where skew keys are dropped.

`ENOENT` stays the one silent path and is the only one: a project that has never had a bandit
written still reads as `undefined`.

## Negative control (old behaviour restored, then reverted)

**(a) The silent reset, full old file** (`git show HEAD:src/learning/bandit-store.ts`), driven by a
throwaway script under `/tmp`: learn 40 pulls across two arms, truncate the file to half its bytes,
read and update.

```
old:  learned:  {"arms":["model-a","model-b"],"pulls":{"model-a":20,"model-b":20},"rewardSum":{"model-a":15,"model-b":10},…}
old:  read of the damaged file: returned undefined
old:  next update: succeeded, state is now {"arms":["model-a"],"pulls":{"model-a":1},"rewardSum":{"model-a":1},…}
new:  read of the damaged file: threw BanditStateUnreadableError code=BANDIT_STATE_UNREADABLE
new:  next update: threw BanditStateUnreadableError code=BANDIT_STATE_UNREADABLE
new:  bytes on disk after: {\n  "arms": [\n    "model-a",\n    "model-b"\n  ],\n  "pulls": {
```

40 learned pulls became 1, and the damaged bytes were overwritten — irrecoverably, since nothing
replays them.

**(b) The tear itself, writer-only revert** (new reader kept, `writeFileAtomic` swapped back for
`mkdir` + `writeFile`): the concurrent-reader case fails with **4 of 55 reads torn**, every one of
them `is unreadable (the file is empty)` — the `O_TRUNC` window, caught in the act. The
shared-writer source pin fails too. Both controls reverted; the tree now holds only the change.

## Tests

`test/unit/learning/bandit-store.test.ts` (3 → 7 cases; the pre-existing case named "corrupt or
structurally invalid bandit JSON fails closed" **asserted the opposite** — `undefined` on damage,
then a successful overwrite — so it is rewritten, disclosed here as the one behavioural pin this
slot changes):

- ENOENT reads as absent (the one silent path);
- a torn file rejects from both `loadProjectBandit` and `updateProjectBandit` with the code, name,
  `path`, `instanceof DomainValidationError`, `cause instanceof SyntaxError`, and a message naming
  the repair — and the damaged bytes plus the released lock are checked afterwards;
- a zero-byte file is damage, not a project that never learned;
- a 13-row damaged-shape table, each row pinned to its defect string, each asserting the update
  refuses too and the file survives untouched;
- the skew half: extra keys load, the learned counters advance (`pulls 7 → 8`), and the
  republished document carries exactly the five known keys.

`test/unit/learning/bandit-store-atomic.test.ts` (new, 5 cases):

- a reader looping without the lock across 12 republishes of a 1200-arm document never observes a
  spliced or absent state (timing-sensitive — this is the case the writer-only control fails);
- published bytes are byte-identical to the old writer's (`JSON.stringify(state, null, 2) + "\n"`),
  the lock is gone, and the directory holds nothing but `bandit.json`;
- a temp abandoned by a crashed writer is neither adopted nor truncated and does not block the
  next publish;
- a source pin keeping the store on the shared writer: the `writeFileAtomic` call must be present,
  and `writeFile(`, `rename(`/`renameSync(` and `.tmp` naming must all be absent;
- **kill switch:** with `SPARKLE_AUTO_ADAPT=0` and a damaged bandit file present,
  `runAutoAdaptLoop` still collects and diagnoses, `banditUpdated === false`, the damaged bytes are
  byte-identical and no lock is created — fail-closed does not reach past the switch. With the
  switch on, the same file rejects with `BANDIT_STATE_UNREADABLE` and still does not overwrite.

## Verification (this VM, Node v22.14.0, whole tree with every other slot's in-flight edits present)

- `pnpm test -- test/unit/learning/` — **65/65 pass, 0 skipped, 3 consecutive runs** (the
  concurrent-reader case is timing-sensitive). The two owned bandit files account for 12 of those,
  up from 3.
- `npx eslint src/learning/bandit-store.ts test/unit/learning/bandit-store.test.ts test/unit/learning/bandit-store-atomic.test.ts` — clean.
- `npx tsc --noEmit` (whole tree) — exit 0, run both immediately after the change and again at
  report time. No diagnostic anywhere, mine or otherwise.
- Downstream consumers: `test/unit/routing/live-isolation.test.ts` 8/8 (the bandit allowlist,
  `selectArm`-has-no-caller, and `loadProjectBandit`-has-no-live-reader pins all still green — the
  two new imports are `domain/errors.js` and `persist/atomic-file.js`, neither watched),
  `test/integration/cli/commands.test.ts` 6/6 (the only integration file mentioning the bandit).
- No new skip introduced (`# skipped 0` on every owned run). No scratch files left in the tree.

## Frozen contracts respected

- `writeFileAtomic(path, contents, options?)` consumed as published; no `persist/` edit, no new
  private temp+rename copy (source-pinned against one reappearing), no `package.json` change.
- Kill-switch collect-only behaviour unchanged and now pinned from the bandit side as well;
  `auto-loop.ts` untouched.
- Reward semantics untouched: the merge, the `taskSuccess`-only filter, the
  `user`/`human`/non-deterministic exclusions, and PASS=1 / FAIL=0 are byte-identical, as is the
  published JSON formatting.
- No live R1/bandit/topology wiring; `loadProjectBandit` still has zero production callers.

## For other slots

- **R5-7 (docs):** a third code joins R4-9's pair —
  `BANDIT_STATE_UNREADABLE` (`adaptation/learning/projects/<key>/bandit.json`, **learned, not
  recomputable**, repair or move aside; ENOENT is the only silent path), alongside
  `PREFERENCE_SNAPSHOT_UNREADABLE` (learned) and `CATALOG_OBSERVED_CORRUPT` (derived, rebuildable).
  Worth recording in operator docs that a damaged bandit file shows up as `adapt skipped: …` under
  `pi run --children` but fails `pi adapt auto` / the tracked run at `stage: "validation"`.
- **R5-9:** `BanditStateUnreadableError` is a `DomainValidationError` with a `code`, so it is
  already code-discriminable if the error-routing surface ever wants it; I added no CLI output and
  touched no string on a shared CLI path.
- **R5-4:** the bandit store was not on your list of private temp+rename copies and still is not —
  it now consumes the shared writer, and a source pin keeps it there.
