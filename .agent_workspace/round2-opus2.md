# Round 2 opus-2
MODEL_SLUG: claude-opus-5-thinking-high-fast

Scope: the four privacy/telemetry holes Round 1 left open. No git commit; no
plane crossing added; nothing auto-promoted; no R1/bandit/shadow module entered
the live import closure.

## Task 1 — the episode cascade now strips every free-text feedback field

`src/privacy/deletion.ts` exports `FREE_TEXT_FEEDBACK_FIELDS = ["body",
"summary"]` and `cascadeFeedbackTombstones` strips both. `summary` was the live
hole: the auto-adapt loop writes derived user text into it
(`src/learning/signals.ts` truncates user answers as `user: <answer>`, peer
message bodies, and subagent assistant text into `summary`, up to 400 chars),
and the cascade only cleared `body`. The stripped record keeps its audit shell
(id, kind, score, timestamps) and is written back through
`writeFeedbackRecords`; `JSON.stringify` omits the `undefined` fields, so the
rewritten JSONL line carries neither key.

`record-classes.ts` now lists `summary` alongside `body` in the feedback class's
`sensitiveFields`, and `record-classes.test.ts` derives that assertion from
`FREE_TEXT_FEEDBACK_FIELDS` — adding a third free-text field to the cascade
without declaring it sensitive now fails the test.

Resurrection is proven impossible at two layers, on raw bytes rather than on
the parsed record: `test/unit/privacy/deletion.test.ts` asserts the log text no
longer matches the seeded body/summary strings (and that `"summary"` is not
even a key), and `test/integration/cli/delete.test.ts` re-runs the delete and
re-reads the file to show the second pass cannot bring it back. A
summary-only record (no `body` at all) is covered separately, because the old
early-return keyed on `body === undefined` would have skipped it.

## Task 2 — `delete --run` reaches the shared invocation log

`deleteRunRecords` now filter-rewrites `runtime/invocations.jsonl`, dropping
every row that names the run, then removes the run subtree.

- **Fails closed on a corrupt middle line.** The scan goes through
  `readJsonlObjects` (`src/persist/jsonl.ts`), which throws on an unparseable
  non-final line. Rewriting around a row we cannot read would silently drop
  someone else's record and could equally silently keep one of this run's. The
  scan runs *before* the run subtree is unlinked, so a corrupt log leaves the
  state root untouched rather than half-deleted — pinned by a test.
- **Crash-truncated final line is dropped**, not preserved. It is already
  invisible to every reader and cannot be proven to belong to another run, so
  the privacy-safe direction is to let it go. Documented in-module and tested.
- **The runId match is structural, not `isInvocation`-gated.** A row that
  parses but fails validation still gets dropped if it names the run, so a
  malformed record cannot smuggle the run past the filter. Rows that do not
  name the run are re-serialized verbatim.
- **Cooperative lock.** The rewrite holds `invocations.jsonl.lock`, which
  serializes concurrent deletes. It does *not* stop the live appender —
  `onInvocation` in `src/cli/main.ts` appends without a lock — so deleting a run
  that is still executing can still race. That limit is stated in the module
  comment rather than implied away. The lock is skipped entirely when the log
  does not exist, so a delete never creates `runtime/` just to lock nothing.
- **`catalog-observed` is invalidated, not rebuilt.** The snapshot holds p50
  aggregates over every invocation row; a percentile cannot have one run
  subtracted from it. The stale file is unlinked only when rows were actually
  dropped (a delete of a run with no invocations leaves an unrelated aggregate
  alone — tested). Unlinking is safe because every reader already treats a
  missing snapshot as "no observations" rather than zeros
  (`loadCatalogObservedSnapshot` returns `{ versions: {} }` on ENOENT), and the
  class's declared recovery is already "rebuild from invocations.jsonl". A
  delete does not manufacture a fresh derived artifact of its own.
- **Episode `.lock` removal.** `runtime/episodes/<id>.lock` sits next to the
  episode files and is now removed by `delete --episode`. It holds no user text,
  but a deleted episode should not keep a footprint, and any holder of it is
  operating on records that no longer exist.

### CLI reporting (no `src/cli/main.ts` change)

`DeletionResult.removedPaths` is now documented as "one line per path this
delete changed": an unlinked path is listed bare, a filter-rewritten log is
listed as `<path> (N invocation row(s))`. That keeps the existing
`removed: <line>` CLI loop honest — it never claims a shared file vanished when
only rows did — and keeps the "nothing found, refusing to report success" guard
correct for a run whose only trace was in the shared log.
`DeletionResult.droppedInvocations` carries the same fact structurally for
programmatic callers. `src/cli/main.ts` was deliberately left untouched.

## Task 3 — declarations reconciled with behavior

`DurableRecordClass.deletionPropagatesTo` is now documented as a behavioral
claim, not a roadmap, and `record-classes.test.ts` pins each remaining entry to
the code that performs it (`IMPLEMENTED_PROPAGATION`). The test fails both ways:
a declaration with no pinned implementation, and an implementation whose pinned
target set drifts from the declaration.

| class | before | after | why |
|---|---|---|---|
| `run-event` | `["run-checkpoint", "episode"]` | `["run-checkpoint", "run-pause", "track-questions", "model-invocation"]` | Episode propagation was never implemented and must not be: episodes outlive runs under multi-run attach. The other three are what `rm -r runtime/runs/<runId>/` actually takes, and `model-invocation` is now real. |
| `model-invocation` | `["catalog-observed"]` | unchanged | Was aspirational; now implemented by the invalidation above. |
| `feedback` | `["preference-dataset"]` | `[]` | `preference-dataset` is a *preference* export (`exportForDataset` / `exportAuthorizedPreferences`); it never reads feedback. The tombstone filter in `readFeedback` is what actually keeps deleted feedback out of anything downstream, so that moved into `recovery`. |
| `candidate` | `["experiment"]` | `[]` | There is no live assignment store to propagate into — the `experiment` class itself says "in-memory / fixture plans (no live assignment store)". |
| `episode` / `preference` | `["feedback"]` / `["preference-dataset"]` | unchanged | Both implemented. |

A separate test asserts every `deletionPropagatesTo` entry names a known class
id and never names itself.

## Task 4 — calibration only trusts calls that finished

`calibrateCatalogRates` now gates on `isCostEligible` from
`src/telemetry/usage-aggregate.ts` (the helper Round 1 landed but never wired),
so a timeout, cancellation, or error can no longer move a per-token rate. Skip
reasons are counted separately on `CalibratedRates` — `excludedNotOk`,
`excludedUnattributed`, `skippedMissingUsage` — so "calibration stopped moving"
is diagnosable instead of silent. Counts are scoped to the model/version being
calibrated, which a test pins.

Skip-missing-usage is preserved and now includes the zeroed case: an eligible
row with `tokensIn`/`tokensOut` undefined, or `tokensOut <= 0`, is skipped
rather than folded in as zero.

**Judgement call worth reviewing:** a record with *no* `callOutcome` is also
excluded, matching what `usage-aggregate.ts` already decided for cost totals —
it is not a known failure, but it is not a known success either, and
calibration will not attribute spend it cannot prove. Consequence: a state root
whose `invocations.jsonl` predates `callOutcome` silently stops calibrating and
falls back to catalog defaults (`samples: 0` → `withCalibratedRates` returns the
row unchanged, `policyVersion` stays uncalibrated). That is the conservative
direction the rest of this codebase takes, and the exclusion counts make it
visible, but it is a behavior change for existing logs. Only
`src/pi-adapter/pi-executor.ts` writes invocations, and it has always set
`callOutcome`, so no live writer is affected.

## Files changed

Owned:
- `src/privacy/deletion.ts`
- `src/privacy/record-classes.ts`
- `src/routing/cost-calibration.ts` (+ `invocationsLogPath` helper, now the one
  place the log path is spelled)
- `test/unit/privacy/record-classes.test.ts`
- `test/unit/privacy/deletion.test.ts` (new, 9 tests)
- `test/integration/cli/delete.test.ts`
- `test/unit/routing/cost-calibration.test.ts`
- `.agent_workspace/round2-opus2.md`

One line outside the owned set:
- `test/integration/track/track-loop.test.ts` — its prior-invocation fixture
  predates `callOutcome`, so under Task 4 it stopped calibrating and the test's
  own assertion (`policyVersion` matches `/calibrated/`) failed. Added
  `callOutcome: "ok"` to the fixture, which is what that fixture means: a
  successful prior call. No other change to that file.

## Parent follow-ups (not mine to edit)

- `docs/data-dictionary.md` "Known limits of the current delete commands
  (2026-08-24 audit)" now **understates** the tooling. Four of its six bullets
  are fixed: `summary` stripping, `delete --run` reaching
  `invocations.jsonl` + `catalog-observed`, the `run-event → episode` false
  declaration, and the surviving episode `.lock`. Still true and should stay:
  episode objective text surviving in attached runs' `events.jsonl`, and no
  preference cascade on episode delete. Under-claiming is the safe direction,
  but it is now wrong.
- `docs/reports/2026-08-24-sota-isolation-privacy.md` §on run-scoped deletion
  and `docs/reports/2026-08-22-p0-privacy-review-package.md` carry the same
  stale claims.
- `docs/data-dictionary.md` also lists the per-class deletion table; the
  propagation column (if the parent adds one) should follow the table above.

## Known limits I did not close

- Deleting a run while it is executing races the unlocked live appender. The
  rewrite's lock only serializes deletes.
- `aggregateCatalogObserved` still folds non-`ok` rows into its p50s. That is
  `src/routing/catalog-observed.ts`, outside this slot's writes, and it is a
  latency/volume aggregate rather than a cost rate — but it has the same
  zeroed-usage exposure and is the obvious next wiring site for
  `costEligibleInvocations`.
- Preferences whose `evidenceEpisodeId` points at a deleted episode still keep
  their payload and the episode link.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm build` clean. Full `pnpm test`:
**1314 pass / 0 fail / 1 skip** (baseline 1282 pass / 1 skip; +32 from the new
and extended tests). Targeted: `test/unit/privacy` (all), `test/unit/routing`
(all), `test/integration/cli/delete.test.ts`.
