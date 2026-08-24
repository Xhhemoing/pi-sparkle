# Durable record dictionary

Source of truth: `src/privacy/record-classes.ts` (`DURABLE_RECORD_CLASSES`).
Tests: `test/unit/privacy/record-classes.test.ts` (schema, required ids,
**path-completeness**, sensitivity-class consistency, **plane layout**) and
`test/unit/privacy/plane-boundary.test.ts` (**adaptation→runtime boundary**).

This dictionary is a Developer Preview control. It does **not** close P0 privacy
review by itself. The 2026-08-22 independent review returned **CONDITIONAL**:
Q3–Q5 passed; Q1 and Q2 required remediation, which is now implemented
(see `docs/reports/2026-08-22-p0-privacy-review-package.md` §7).

## State-root plane layout (Q1 remediation)

The state root (`~/.pi-sparkle/`, override `--state-root`) is split into two
explicit plane directories:

- `<root>/runtime/` — run-event, run-checkpoint, run-pause, track-questions,
  episode, model-invocation, catalog-observed, providers-config,
  auth-credential
- `<root>/adaptation/` — feedback (+tombstones), preference,
  preference-dataset, candidate, routing-eval-report, learned-routing-policy,
  learning-bandit, experiment

**Boundary rule:** adaptation modules never read runtime files directly.
Runtime data reaches the adaptation plane only as (a) derived signals with no
user text (taskSuccess PASS/FAIL via `src/learning/from-episode.ts`), or
(b) through the redaction pipes (`redactFeedback` / `exportForDataset`). The
current import exceptions are pinned in
`test/unit/privacy/plane-boundary.test.ts`; new ones require an explicit
allowlist entry with a justification.

> Precision note (2026-08-24, Loop 2 Round 1): the allowlist pin above is
> **direct-import only** — it does not walk transitive imports. One transitive
> value chain is known and pinned by a dedicated test in the same file:
> `adaptation/eval-routing.ts` value-imports `routing/assign.ts`, which
> value-imports `supervisor/model-router.ts` — so the live router **module is
> loaded at runtime** by the adaptation plane even though eval-routing's own
> model-router import is type-only. The boundary rule still holds because it
> is a claim about *records*, not code loading: `model-router.ts` and its
> entire value-import subtree are filesystem-free, so no runtime record is
> reachable through the chain (the test pins the router file itself; the
> subtree was verified by closure walk — see the
> [Loop 2 R1 isolation report](reports/2026-08-24-sota-loop2-isolation.md)
> §1). Transitive chains through module prefixes the test does not list
> (e.g. shared `routing/` helpers) would not be flagged automatically; the
> only runtime-record reader value-reachable from the adaptation plane is the
> sanctioned `from-episode` pipe.

> Layout note: this is a Developer Preview breaking change. Data written by
> builds before 2026-08-22 sits at the legacy flat locations and is not
> auto-migrated (per Q4 decision: migration planning deferred to v2).

## Classes (18)

| id | owner | path | retention | deletion | migration |
|---|---|---|---|---|---|
| run-event | runtime | `runtime/runs/<runId>/events.jsonl` | run-scoped | delete-files | 1 |
| run-checkpoint | runtime | `runtime/runs/<runId>/checkpoint.json` | run-scoped | delete-files | 1 |
| run-pause | runtime | `runtime/runs/<runId>/pause.json` | run-scoped | delete-files | 1 |
| track-questions | runtime | `runtime/runs/<runId>/track-questions.json` | run-scoped | delete-files | 1 |
| episode | runtime | `runtime/episodes/<episodeId>.jsonl` (+ `<episodeId>.events.jsonl`) | episode-scoped | delete-files | 1 |
| artifact-ref | runtime | TASK_RESULT ids only | run-scoped | exclude-from-export | 1 |
| feedback | adaptation | `adaptation/feedback/records.jsonl` (+ `tombstones.json`) | until-deleted | tombstone-ids | 1 |
| preference | adaptation | `adaptation/preferences.json` | until-deleted | tombstone-ids | 1 |
| preference-dataset | adaptation | derived export | until-deleted | exclude-from-export | 1 |
| model-invocation | runtime | `runtime/invocations.jsonl` | run-scoped | delete-files | 1 |
| catalog-observed | runtime | `runtime/routing/catalog-observed.json` | until-deleted | delete-files | 1 |
| candidate | adaptation | `adaptation/registry.json` | until-rollback | tombstone-ids | 1 |
| routing-eval-report | adaptation | `adaptation/evals/<candidateId>.<cacheKey>.json` | until-deleted | exclude-from-export | 1 |
| learned-routing-policy | adaptation | `adaptation/learning/projects/<stableProjectKey>/routing.json` | until-deleted | delete-files | 1 |
| learning-bandit | adaptation | `adaptation/learning/projects/<stableProjectKey>/bandit.json` | until-deleted | delete-files | 1 |
| experiment | adaptation | in-memory / fixture plans | until-deleted | exclude-from-export | 1 |
| providers-config | runtime | `runtime/providers.json` | until-deleted | delete-files | 1 |
| auth-credential | runtime | `runtime/auth.json` | until-deleted | delete-files | 1 |

## Deletion tooling (Q2 remediation, extended 2026-08-24 Rounds 2–3)

`pi-sparkle delete --run <id>` removes the run's whole subtree under
`runtime/runs/<id>/`, **filter-rewrites the shared `runtime/invocations.jsonl`**
so the run's rows are dropped (under the log's cooperative lock; a corrupt
middle line fails the whole rewrite closed rather than reporting a partial
delete as success), and — when rows were dropped — **invalidates the derived
`runtime/routing/catalog-observed.json` snapshot** (unlinked, not recomputed;
the class's recovery is "rebuild from invocations.jsonl" and readers treat a
missing file as "no observations").

`pi-sparkle delete --episode <id>` removes both episode file shapes while
holding the operational `<id>.lock`, **and cascades into the adaptation
plane**: every feedback record bound to that episode has **both free-text
fields (`body` and `summary`) physically stripped from disk** and its id
persisted to `adaptation/feedback/tombstones.json` (the record's audit shell —
including its persisted `redactionClasses` — is kept). `readFeedback` filters
tombstoned ids at the first layer, so a lingering shell is never re-surfaced
**through that API**, and dataset exports keep listing tombstone ids without
payloads. The episode delete also **discloses residual copies it is leaving
in place**: it reports every run whose records still hold the episode's text
(`residualEpisodeTextRunIds`; the CLI prints one
`residual episode text: run <id> …` line per run with the `delete --run`
remediation). Only runs that *name* the episode are scanned; reasons are
`episode-opened` (the run log carries the `EPISODE_OPENED` snapshot),
`objective-copy` (objective/acceptance text found elsewhere in the run's
event log or `track-questions.json`), and `unreadable-log` (a corrupt line
names the episode, so the log cannot be declared clean). Run event logs are
append-only evidence and are deliberately **not rewritten**; a repeat delete
of an already-deleted episode still re-discloses the copies. The CLI fails
closed: missing/ambiguous target flags exit 1, an unknown id ("nothing
found") exits 1 rather than reporting success. The delete does not unlink or
report the lock as an episode record; normal owned lock release removes the
sidecar. An abandoned lock is not stolen, so acquisition times out and the
episode files remain for manual lock cleanup and a retry.

### Known limits of the current delete commands (2026-08-24, Round 3 audit; revised Loop 2 Round 1)

Honest gaps that remain after the Round 2 cascade, Round 3 disclosure work,
and the Loop 2 Round 1 invocation-lock fix
([Round 1](reports/2026-08-24-sota-isolation-privacy.md),
[Round 2](reports/2026-08-24-sota-r2-isolation.md),
[Round 3](reports/2026-08-24-sota-r3-isolation.md),
[Loop 2 R1](reports/2026-08-24-sota-loop2-isolation.md) reports); none of
these are covered by the claims above:

- **Episode text still physically survives inside attached runs** until each
  reported run is itself deleted. `delete --episode` now *names* those runs
  (see above) but never edits their append-only event logs. The residual scan
  covers run event logs and `track-questions.json` only — a copy quoted in
  `checkpoint.json` (flowchart snapshot) or `pause.json` (free-text reason)
  would not be reported.
- **Preferences are not cascaded — a documented non-goal, not an oversight.**
  Observations whose `evidenceEpisodeId` references a deleted episode keep
  their payload and the (now dangling) episode link; the id is not episode
  text. The three-reason rationale lives in `src/privacy/deletion.ts`, and
  the deletion suite pins that an episode delete leaves
  `adaptation/preferences.json` byte-identical. Use `pref delete` per
  observation.
- **Deleting a run that is still executing no longer risks clobbering, but
  delete-after-terminate is still the supported flow.** Since Loop 2 Round 1
  both writers of the shared log go through the same cooperative lock
  (`src/telemetry/invocation-log.ts`): the live appender uses
  `appendInvocationRecord` and the delete's read-filter-write cycle runs
  inside `withInvocationLogLock`, so a live append lands wholly before or
  wholly after the rewrite (test-pinned, including the cannot-clobber case
  and the append-times-out-instead-of-writing-unlocked case). What remains
  true: rows a still-running run appends *after* the rewrite completes are
  new rows and survive the delete, and an appender that cannot take the lock
  in time silently drops its telemetry row rather than fail the run.
- **`model-invocation` deletion is a filter-rewrite, not an unlink.** The
  class declares `delete-files`, but the log is one global file shared by all
  runs, so a run-scoped delete rewrites it without the run's rows instead of
  removing the file. The CLI output makes this visible
  (`removed: …/invocations.jsonl (N invocation row(s))`).

Closed in Round 2 (2026-08-24, verified on-disk against a scratch state root):
the cascade previously stripped only `body` and left derived user text in
`summary`; `delete --run` previously never touched `invocations.jsonl` or
`catalog-observed.json`; episode record unlinking moved inside the cooperative
`<id>.lock` (the delete no longer hand-unlinks or reports that sidecar); and
`record-classes.ts` previously declared an unimplemented `run-event → episode`
propagation (now reconciled — `deletionPropagatesTo` is a behavioral claim).

Closed in Round 3 (2026-08-24, verified on-disk against a scratch state
root): episode deletes previously left run-log copies **silently** (now
disclosed per delete, with remediation); the preference gap previously had no
stated rationale or pin (now both); the cascade's interaction with persisted
`redactionClasses` is verified (classes survive the strip).

Closed in Loop 2 Round 1 (2026-08-24): the delete-vs-live-appender race on
`invocations.jsonl` — the appender previously wrote without the lock the
rewrite takes; both writers now share it (see the revised bullet above).

## Completeness audit (2026-08-22)

Every `writeFile` / `appendFile` call under `src/` was audited against the
state root. Findings and resolutions:

- **5 previously unlisted durable paths** were found and added as classes:
  `runs/<runId>/pause.json` (user free-text reason — same sensitivity class as
  episode events), `runs/<runId>/track-questions.json` (objective + contract
  text — same), `adaptation/evals/*.json` (paired aggregates only, no episode
  bodies), `learning/projects/*/bandit.json` (PASS/FAIL reward aggregates
  only, no task text), and `learning/projects/*/routing.json`
  (learned-routing-policy; model ids and avoid-list patterns only).
- `.doctor-write-probe` (doctor preflight) is written and unlinked within one
  call — transient, not durable; no class needed.
- Pause and checkpoint atomic writes use unique same-directory temp names:
  `pause.json.<pid>.<random>.tmp` and
  `checkpoint.json.<pid>.<random>.tmp`. The shared writer opens a new temp
  exclusively, fsyncs it, then renames it over the destination. A handled
  failure removes its temp; an abrupt process exit can leave a stale temp, but
  later writes generate a different name and never adopt it.
- Other rename sidecars currently below the state root are
  `providers.json.tmp`, `auth.json.tmp`, and
  `registry.json.<pid>.<random>.tmp`; they are transient and do not get their
  own durable classes.
- Operational lock files currently written below the state root are:
  - `runtime/invocations.jsonl.lock`, shared by invocation appends and the
    run-deletion filter rewrite;
  - `runtime/episodes/<id>.lock`, shared by CLI `episode close` and run-side
    episode settlement;
  - `runtime/auth.json.lock`, guarding credential changes;
  - `adaptation/feedback/records.jsonl.lock`, shared by feedback appends and
    the episode-deletion cascade rewrite;
  - `adaptation/registry.json.lock`, guarding registry changes; and
  - `adaptation/learning/projects/<stableProjectKey>/bandit.json.lock`,
    guarding each project's bandit update.
  These are transient operational sidecars, not durable record classes.
  Normal release removes an owned lock; an abandoned lock is not stolen
  automatically and may require manual cleanup.
- `test/**` fixture writes are outside the state root and out of scope.

The completeness guard lives in
`test/unit/privacy/record-classes.test.ts`: any durable path added to `src/`
must be added to `knownPaths` and to a record class together, or the suite
fails.

## Rules

- Raw prompts, response bodies, secrets, and hidden reasoning are excluded from
  optimization datasets. Invocations store hashes and optional usage only.
- The persisted `redacted: true` flag on a feedback record means the redaction
  pass **ran** over it (the write-path policy sets `redactPII: true`
  unconditionally), not that sensitive content was necessarily found and
  removed. Since 2026-08-24 (Round 3) the record additionally persists
  `redactionClasses`, which does distinguish the cases — three states, all
  meaningful: **`undefined`** = the row predates the field (unknown, not
  "clean"); **a list without `secret`/`path`/`oversized`** (the store's shape
  is `["pii"]`) = the pass ran and found nothing; **`secret`/`path`/
  `oversized` present** = that class was found and removed. Readers fail
  closed on an unrecognised class string and never hand back a `body` on a
  row whose classes say it was dropped (`oversized`). The feedback class
  keeps `migrationVersion: 1`: the field is optional and legacy rows stay
  valid, a compatibility choice the pending P0 re-review should ratify. The
  declared `prompt-injection` class is deliberately never emitted
  (see the rationale in `src/feedback/redaction.ts`).
- The auto-adapt kill switch (`SPARKLE_AUTO_ADAPT=0|false|off`) gates the
  **automatic post-run loop only**: with the switch off, signals are still
  collected into `adaptation/feedback/records.jsonl` (observation), but the
  `learning-bandit` file is not written and no candidate is proposed
  (verified on disk, 2026-08-24 Round 3). Explicit commands (`adapt learn`,
  preference tooling) are user intent and are not gated by it. Any value
  other than the three listed strings leaves the loop enabled.
- Missing provider usage is `undefined`, never `0`.
- Preference dataset export always lists tombstone ids and never the deleted
  payloads (`exportForDataset`).
- Closed 2026-08-21 (M3-T1/M3-T6): cross-stream references and multi-run
  attach fail closed in the episode reducer; tombstone propagation covers
  dataset exports (`exportForDataset`) and authorized exports, and
  materialized views exclude tombstoned ids. See
  `test/integration/m3/redaction.test.ts`.
