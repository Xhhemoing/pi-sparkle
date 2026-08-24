# Round 3 opus-2
MODEL_SLUG: claude-opus-5-thinking-high-fast

Branch `agent/sota-persistent-opt-7e63`, no commit (parent commits). Strict TS.
`pnpm typecheck` / `pnpm lint` green; full suite green at the time of writing
(1350 pass / 0 fail / 1 skip, shared workspace so the total moves with other
slots). 13 new tests.

## Task 1 — kill switch stops the learner, not the collector

`src/learning/auto-loop.ts`

Before: `updateProjectBandit` ran at line 90, *above* the `isAutoAdaptEnabled()`
gate, so `SPARKLE_AUTO_ADAPT=0` still moved the project's reward aggregates on
every run. The doc comment said "still collects", which was true but incomplete.

- The bandit update now happens **after** the gate. The disabled path returns
  before it, so no `bandit.json` is created, no existing one is rewritten, and
  no `bandit.json.lock` is taken.
- Collection is unchanged when disabled: signals are parsed, persisted through
  `persistSignals` → `appendFeedback` (adaptation-plane feedback log), and
  `diagnoseModelProjectIssues` still runs, so `result.issues` stays populated.
  Only the two things that *learn* stop — bandit update and candidate proposal.
- New field `AutoAdaptResult.banditUpdated: boolean`. Every return path sets it
  (including `runAutoAdaptFromEvents`'s "run has no project snapshot" early
  return). It is `true` only when the call actually wrote the file, i.e. enabled
  **and** at least one signal carried a `modelId` — the same condition that
  guarded the call before.
- Disabled `reason` is now `"auto-adapt disabled; collected and diagnosed only,
  bandit not updated"` (was `"auto-adapt disabled; collected only"`). Nothing in
  `src/` or `test/` matched on the old string.
- Rationale is written into the function's doc comment: the bandit is
  adaptation-plane state that survives the run and shapes later analysis, so an
  operator who flipped the switch off must not keep finding it moving — even
  though nothing live reads it back (`loadProjectBandit` still has zero callers
  in `src/`, unchanged, so `live-isolation.test.ts` is unaffected).

Auto-promotion was already structurally impossible and still is: `promoted` is
hardcoded `false` and `autoPromote` is ignored.

`test/unit/learning/auto-loop.test.ts` — 4 new tests:

1. enabled (`SPARKLE_AUTO_ADAPT=1`) writes the bandit: `banditUpdated === true`,
   `arms === ["cheap"]`, `pulls.cheap === 2`, `rewardSum.cheap === 0`, file
   exists at the real `adaptation/learning/projects/<key>/bandit.json` path;
2. disabled (`=0`) collects but does not touch the bandit: `collected >= 2`,
   issues still diagnosed, feedback records on disk, `banditUpdated === false`,
   `loadProjectBandit` undefined, **no bandit file and no `.lock` file**;
3. `=off` after an enabled run leaves pre-existing bandit bytes identical (the
   kill switch is not "update the file you already have");
4. the pre-existing kill-switch test is kept as-is.

## Task 2 — episode delete discloses residual copies instead of rewriting logs

`src/privacy/deletion.ts`

Event logs are append-only evidence; rewriting one to erase an episode would
make every hash, replay and checkpoint over it unverifiable. So the delete
**reports** the copies.

- New `DeletionResult.residualEpisodeTextRunIds: readonly RunId[]` — sorted,
  de-duplicated, always `[]` for run deletes. Nothing in the list was modified.
- New exported `findResidualEpisodeText(stateRoot, episodeId, seedText?)`
  returning `ResidualEpisodeText[]` (`{ runId, path, reason }`), with
  `ResidualTextReason`:
  - `episode-opened` — the run's `events.jsonl` has an `EPISODE_OPENED` event
    for this episode, i.e. a full `ProjectEpisode` including objective and every
    acceptance criterion;
  - `objective-copy` — the objective or an acceptance description appears
    elsewhere in a run that names the episode: another event in `events.jsonl`,
    or the run's `track-questions.json` (the track loop writes the objective
    there, and it is run-scoped, so an episode delete never reaches it);
  - `unreadable-log` — the run names the episode but a line does not parse, so
    residual text cannot be ruled out. Reported rather than assumed clean.
- `deleteEpisodeRecords` reads the episode's own objective/acceptance text from
  `runtime/episodes/<id>.jsonl` and `<id>.events.jsonl` **before** the unlink and
  passes it as `seedText`. Both durable shapes are tolerated (bare
  `ProjectEpisode` rows and `{ type, episode }` event rows).
- Idempotent: on a repeat delete the episode records are gone, so the scan
  recovers the objective from the runs' own `EPISODE_OPENED` payloads and still
  reports them.
- Scope rule: **only runs that name the episode** are considered. A run that
  happens to contain the same sentence but never references the episode cannot
  be proven related; listing it would send operators deleting unrelated runs.
  Conversely, an attached run that holds only ids (`RUN_ATTACHED` and nothing
  else) is *not* listed — a reference is not text.
- Corrupt lines do not throw here. This is a report about bytes being left in
  place, so one bad line in an unrelated run must not fail an otherwise complete
  delete (contrast `dropRunFromInvocationLog`, which rewrites and therefore
  fails closed).
- Cost: one pass over every run's `events.jsonl`. Acceptable for an interactive
  delete; noted in the doc comment.

`src/cli/main.ts` — **one line only** (the exclusive-write rule allowed a
one-liner and the task required CLI stdout):

```ts
for (const runId of result.residualEpisodeTextRunIds) io.stdout(`residual episode text: run ${runId} still holds a copy (append-only log; delete --run ${runId} to remove it)\n`);
```

Placed **before** the "nothing found → exit 1" check on purpose: an episode
whose own records are already gone but whose attached run still holds the text
must still tell the operator, even though the command fails closed. Pinned by a
test.

Tests: 7 in `test/unit/privacy/deletion.test.ts` (open-event listing + byte
identity of the log, empty list with no attached runs, id-only run not listed,
objective copy in a non-open event *and* in `track-questions.json`, acceptance
text alone, repeat delete, unparsable line, run delete never claims residuals)
and 3 in `test/integration/cli/delete.test.ts` (stdout names the run and the
`delete --run` remedy; no line when nothing holds a copy; disclosure survives
the "nothing found" exit-1 path). Run event logs in the tests are written
through the real `EventStore`, so the fixtures are validated events, not
hand-shaped JSON.

## Task 3 — preference cascade is an explicit non-goal

Not implemented; documented in a block comment in `deletion.ts` and pinned by a
test. It is not cheap-and-correct today:

1. The preference store is a **process-global singleton** bound to one file by
   `configurePreferencePersistence`. A cascade from `deleteEpisodeRecords`
   (which takes an arbitrary `stateRoot`) would have to rebind and reload
   whatever store the calling process already had open — a privacy operation
   corrupting unrelated live state. Correct support needs a state-root-scoped
   preference API.
2. `deleteObservation` physically drops the row and rebuilds the materialized
   views, so the cascade would change *behaviour* (what the agent believes the
   user prefers), not just remove text. The feedback cascade deliberately went
   the other way (keep the audit shell, strip the free text); picking a
   different rule for preferences is a product decision, not a refactor.
3. `deletionPropagatesTo` is a behavioural claim pinned by
   `record-classes.test.ts`; implementing the cascade requires widening
   `record-classes.ts` (`episode` → `preference`) and that test in the same
   change. Both are outside this slot's exclusive writes, and a half-done
   cascade would fail the pin by design.

What survives is a preference row whose `evidenceEpisodeId` dangles — the same
shape as `artifact-ref`'s documented "missing ids stay inspectable as dangling
references". No objective or acceptance text ever reaches a preference row, so
the dangling id is a reference, not episode text.

Pinning test (`deletion.test.ts`): record an explicit preference bound to the
episode, delete the episode, assert `adaptation/preferences.json` is
**byte-identical**, then reload the store from disk and assert the observation
is still live with its `evidenceEpisodeId` intact.

## Handoff / not done (needs files this slot did not own)

1. `DELETE_USAGE` in `src/cli/main.ts` still describes only the feedback
   cascade. It should mention that attached runs holding copies are listed and
   that `delete --run` is the way to remove them. Deliberately not edited (one
   functional line was already the budget).
2. `docs/reports/2026-08-24-sota-isolation-privacy.md:78` states that
   `updateProjectBandit` runs **before** the `isAutoAdaptEnabled()` gate. That
   was accurate for the audited baseline and is now stale. It is a dated report,
   so it may be correct to leave it and record the change in the round summary
   instead.
3. `docs/data-dictionary.md` / `record-classes.ts` could note, on the `episode`
   class, that a delete discloses residual run copies (no propagation claim
   changes — the delete still touches only episode + feedback, so
   `deletionPropagatesTo` stays exactly as it was).
4. If a preference cascade is ever wanted, the prerequisite is a
   state-root-scoped preference store API; then the dictionary and its pinning
   test move together with the code.
