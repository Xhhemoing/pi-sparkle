# Loop 5 · Round 1 — Fable-persist: operator-facing persist/privacy/storage gaps

Agent: Fable-persist (claude-fable-5-thinking-xhigh), analysis only — no `src/` edits, no commit.
Scope read: `src/persist/` (atomic-file, file-lock, jsonl), `src/privacy/` (deletion,
state-layout, record-classes), `src/cli/doctor.ts` + `doctor-overlay.ts`,
`src/cli/migrate-legacy.ts`, `src/cli/main.ts` (delete/pref/USAGE surfaces),
`src/feedback/store.ts`, `src/telemetry/invocation-log.ts`,
`scripts/retention-probe.mjs`, `docs/reports/2026-08-22-p0-privacy-review-package.md`,
`docs/status-matrix.md` retention row (line 48), `docs/data-dictionary.md`,
`docs/agent-decisions.md`, relevant tests (`deletion.test.ts`, `delete.test.ts`),
plus git history at `09f325c` (last pre-plane-split commit, 2026-08-21) to verify
legacy-layout claims.

Posture honored throughout: unbounded retention is an **accepted open policy**
(Q3) — every recommendation below is a diagnostic, a list, or an honesty fix.
**No gc, no silent deletes, no retention bound, nothing that fake-closes P0.**

---

## What was checked and found sound (no action)

- `writeFileAtomic`/`writeFileAtomicSync`: unique `wx` temp + fsync + rename with
  the EPERM/EEXIST/EACCES unlink fallback; failed publishes clean their own temp.
- `withExclusiveFileLock`: `wx` create, owner-token release, timeout-only, never
  steals — matches the documented posture everywhere it is consumed.
- `readJsonlObjects`: truncated tail recovered, corrupt middle fails closed;
  every store that matters routes through it.
- Delete engine ordering, double verification (`RunRecordsSurvivedError` in-lock
  and post-lock), feedback cascade under the log lock, tombstone-first-layer
  filter in `readFeedback`, and the preference-cascade non-goal are all
  implemented as documented in source, and the 2026-08-22 review package §7/§8
  matches the code as it stands today.
- `migrate-legacy` publish protocol (temp + hard-link/COPYFILE_EXCL, never
  overwrite, corrupt JSONL refused) is survivable and honest about its fallback.
- Doctor lock/run-state/learned-state inventories are read-only and advisory,
  exactly as their advisories claim.

---

## Findings (ordered by operator impact)

### F1 — HIGH (honesty): `delete` operator surfaces claim "a wait that runs out removes nothing"; the engine deliberately completes the privacy-safe half first

Evidence:

- `DELETE_USAGE` in `src/cli/main.ts` (~line 1968–1972): "The delete fails
  closed either way: a wait that runs out removes nothing."
- `docs/data-dictionary.md` (~line 112–114): "if the run outlives the wait,
  deletion fails with `LOCK_TIMEOUT` and removes nothing."
- The engine, by design, does the opposite for both targets:
  - `deleteRunRecords` (`src/privacy/deletion.ts:303`) drops the run's rows from
    `runtime/invocations.jsonl` and invalidates `catalog-observed.json` **before**
    it ever asks for the run lock; the docstring (lines 273–276) says the dropped
    rows "stay dropped … which is the privacy-safe half to have completed".
  - `deleteEpisodeRecords` (lines 385–386) strips feedback free text and persists
    tombstones **before** taking the episode lock; the docstring (lines 371–378)
    discloses exactly this cost.

So a `delete --run` against a live run that times out on the run lock has
already rewritten the shared invocation log and unlinked the derived p50
snapshot; a `delete --episode` that times out has already stripped and
tombstoned feedback. The engine's ordering is correct (completing the
privacy-safe half first is the right trade), and the source comments are honest
— but the two **operator-facing** surfaces say "removes nothing", and the CLI
failure path (routed `LOCK_TIMEOUT` → doctor `locks[]`) discloses nothing about
the partial completion, because `DeletionResult` is lost when the engine throws.

The existing tests do not pin the false claim: the "removes nothing" unit test
(`test/unit/privacy/deletion.test.ts:1366`) uses a run with **no invocation
rows**, and the `--lock-wait-ms 0` CLI test short-circuits on an absent
invocation log, so a docs/output fix breaks no pins.

Recommendation (docs + one output line; no engine change):

1. Correct `DELETE_USAGE` and `docs/data-dictionary.md` to state the real
   contract: the adaptation/telemetry half completes first and stays completed;
   the lock-guarded record removal is the part a timeout refuses; re-delete is
   idempotent.
2. On the `--run` path, surface what was already done before the throw — either
   a stderr line emitted before the lock wait ("dropped N invocation row(s);
   invalidated catalog-observed") or by attaching the partial result to the
   thrown error for `main`'s failure printer. Diagnostics only; changes no
   deletion behavior.

### F2 — HIGH (privacy/coverage): pre-split `auth.json` (secrets), `preferences.json`, `providers.json`, and `learning/` are invisible to both `migrate-legacy` and doctor's legacy-layout check

Verified against the last pre-split commit (`09f325c`, 2026-08-21): the flat
state root then held `<root>/auth.json` (api keys / oauth tokens),
`<root>/preferences.json` (learned user preferences),
`<root>/providers.json`, `<root>/learning/projects/<key>/bandit.json`, and
`<root>/routing/catalog-observed.json` (derived, rebuildable — losing it is
acceptable). The plane split landed the next day.

Coverage today:

- `LEGACY_SOURCES` (`src/cli/migrate-legacy.ts:46–51`) migrates only
  `feedback/`, `runs/`, `episodes/`, `invocations.jsonl`.
- `LEGACY_STATE_ENTRIES` (`src/cli/doctor-overlay.ts:91–102`) detects only
  `feedback/records.jsonl` and `runs/` — a strict subset of even the migrator.

Operator consequences:

1. **Secret-bearing orphan.** A pre-split `~/.pi-sparkle/auth.json` holds
   plaintext credentials that nothing reads, nothing migrates, doctor never
   mentions, and no delete verb reaches. `auth logout` deletes
   `runtime/auth.json` only — the operator believes the key is gone; the
   pre-split copy stays on disk indefinitely. This is the one legacy file whose
   *existence* is the problem, independent of migration.
2. **Silent state loss.** Upgraded installs silently lose model config,
   credentials, learned preferences, and per-project bandit state — the exact
   "silently sees an empty history" failure the 2026-08-22 weak-area report
   called out for records, still open for config/learned state.
3. `legacy-layout`'s remediation text ("migrate it before treating this state
   root as complete") points at a migrator that cannot migrate three of the
   five missing classes, so following the advice still strands them.

Recommendation (detection first, migration second):

1. Extend `LEGACY_STATE_ENTRIES` with `auth.json`, `preferences.json`,
   `providers.json`, `learning/`, `episodes/`, `invocations.jsonl` — the check
   is already informational-only (never fails preflight), so this is purely
   additive detection, and the `auth.json` entry should say explicitly that the
   file may contain credentials and is read by nothing.
2. Extend `LEGACY_SOURCES` with `preferences.json` → adaptation,
   `providers.json` → runtime, `learning/` → adaptation. For `auth.json`,
   copying secrets around is a policy decision — at minimum the migrate-legacy
   USAGE must name it as deliberately not migrated and tell the operator to
   re-login and remove the flat file by hand. `routing/catalog-observed.json`
   can be documented as intentionally skipped (derived; rebuilds).

### F3 — MEDIUM (privacy/deletion interplay): migrated legacy copies survive every delete verb and are invisible to the residual-text disclosure

`migrate-legacy` copies, never deletes (by design, `src/cli/migrate-legacy.ts:24–27`).
After `--apply`, episode objectives, run event logs, and feedback bodies exist
**twice**: at `runtime/`/`adaptation/` and at the flat root. But:

- `deleteRunRecords` removes `runtime/runs/<id>/` only; `deleteEpisodeRecords`
  unlinks `runtime/episodes/<id>.*` only; the feedback cascade rewrites
  `adaptation/feedback/records.jsonl` only. The legacy copies of the same
  user text keep every byte.
- `findResidualEpisodeText` (`src/privacy/deletion.ts:565–582`) walks
  `runtime/runs/` only, so the disclosure that exists precisely to name
  leftover copies cannot see the legacy tree.

An operator who migrated and then ran `delete --episode` gets a success report
listing tombstoned feedback and zero residual runs — while the objective and
the un-stripped feedback body sit at `<root>/episodes/…` and
`<root>/feedback/records.jsonl`. That is a delete reporting more than it did,
which is the exact failure mode the rest of this engine is built to refuse.

Recommendation (disclosure, not deletion): teach the residual scan — or, more
cheaply, the `delete` CLI output — to check the four legacy source paths for
the target id and print a "legacy flat-root copy still on disk at <path>;
migrate-legacy never deletes sources" line. Also state the double-retention
fact in migrate-legacy's USAGE, which currently only promises the originals
survive (as a feature) without noting deletes will never reach them.

### F4 — MEDIUM (contract): `--lock-wait-ms` does not bound the invocation-log lock inside `delete --run`

`deleteRunRecords` forwards `options` to the run-lock acquisition but calls
`dropRunFromInvocationLog(stateRoot, runId)` without them
(`src/privacy/deletion.ts:303` vs `:797–819`), so that rewrite always uses the
5 s default:

- `--lock-wait-ms 0` ("refuses immediately rather than waiting at all", per
  USAGE) can still wait up to 5 s on `invocations.jsonl.lock`.
- A large `--lock-wait-ms` meant to wait out a busy writer does not extend the
  invocation-lock wait, so the delete can fail earlier than the flag promises,
  on a lock the flag was documented to bound ("bounds how long the delete waits
  for the cooperative lock its target is under" — the invocation log is one of
  the target's locks).

The episode path is consistent (`cascadeFeedbackTombstones` receives
`options`). One-line fix: pass `options` through; the existing `--lock-wait-ms 0`
CLI test keeps passing (no invocation log in that fixture) and a new unit case
can pin the propagation.

### F5 — MEDIUM (retention diagnostics): the only retention evidence is an unregistered, undocumented script with a misleading metric; doctor says nothing about state-root growth

Status-matrix line 48 names `scripts/retention-probe.mjs` as the sole evidence
for the retention row, but:

- It is not in `package.json#scripts` (unlike `pi:probe`, `security:probe`,
  `invocation:probe`), not in the README script table, and not in any CLI
  USAGE. An operator cannot discover it.
- `perRunEstimateBytes` divides the **entire state root** (both planes, plus
  `auth.json`, locks, evals, feedback) by the run-directory count
  (`scripts/retention-probe.mjs:115–135`) — mislabeled as a per-run figure.
- No per-plane or per-class breakdown, which is what an operator deciding
  *what to delete* actually needs; and the self-sample mode measures a
  fabricated tree with empty run dirs, so its numbers characterize nothing.
- The status-matrix row also understates the unbounded set: it names
  `runtime/invocations.jsonl` and `runtime/episodes/`, but terminal run
  subtrees under `runtime/runs/` (nothing ever deletes them without an
  operator verb), `adaptation/feedback/records.jsonl`,
  `feedback/tombstones.json` (monotonic by design), and
  `adaptation/evals/*.json` grow unbounded too.

Recommendation (aligned with the tracker's stated next-round focus,
"retention diagnostics"): an additive `storage`/retention inventory in
`DoctorJsonReport` — the contract is frozen-additive, so a new top-level field
is legal — reporting bytes/file-count per plane and per record-class directory,
run/episode counts, and oldest-entry ages, with an advisory that retention is
unbounded by accepted policy and that doctor never deletes. That makes growth
observable through the tool operators already run, replaces nothing, and
closes no policy question. Registering `retention:probe` in `package.json` and
correcting the per-run metric is the cheap interim step. (Do not fold sizes
into the D2 `list` verb — that file set is owned by Opus-list this round.)

### F6 — MEDIUM (operator surface): retained feedback text and tombstones have no list/export verb, and no per-record delete

Preferences got the full treatment (`pref list|export|delete --id`), but
feedback — the class that *holds derived user text* (`body`, `summary`) — has
no read surface and no per-record deletion:

- Nothing in the CLI lists `adaptation/feedback/records.jsonl` or
  `tombstones.json`; `adapt status` shows candidates only. An operator auditing
  "what user text does the adaptation plane retain?" must read JSONL by hand.
- The only feedback deletion path is the episode cascade. A single bad record
  (e.g., feedback whose `summary` captured something the operator wants gone
  now) can only be removed by deleting the whole episode. The class is
  `until-deleted` with no direct delete verb — in practice "until episode
  delete".

Recommendation: a read-only `feedback list [--episode <id>] [--json]`
(shows id, episodeId, kind, score, redactionClasses, tombstone status —
free-text fields elided by default) is a pure diagnostic and the prerequisite
for any operator to *use* the deletion tooling deliberately. A per-record
`feedback delete --id` reusing the cascade's strip+tombstone machinery under
the same lock is a small, well-precedented extension (mirrors `pref delete`)
— but it changes the deletion story, so it should be its own reviewed slot,
not a rider.

### F7 — LOW (diagnostics): doctor's learned-state inventory omits the adaptation plane's fail-closed logs

`learnedStateInventory` (`src/cli/doctor.ts:440–619`) covers bandit,
preferences, and catalog-observed. It does not probe:

- `adaptation/feedback/records.jsonl` — a corrupt middle line fails
  `readFeedback` **and** fails every future `delete --episode` cascade closed;
  today the operator discovers that at delete time, from the delete's error,
  instead of from the preflight whose whole point is inventorying damaged state.
- `feedback/tombstones.json` — malformed JSON throws in `readFeedback` and in
  the cascade.
- `adaptation/registry.json` and
  `adaptation/learning/projects/<key>/routing.json` — both classed, both
  fail-closed readers, both absent from the inventory.

All four have shipped readers that can classify damage without binding
anything (the same trick `readPreferenceSnapshot` already plays in doctor).
Additive `learnedState` entries; no contract issue.

### F8 — LOW (disclosure completeness): the residual-episode-text scan does not name `checkpoint.json` or `pause.json` in its scope

`findResidualEpisodeText` scans run `events.jsonl` and `track-questions.json`
(`src/privacy/deletion.ts:523–557`). A flowchart checkpoint durably carries the
full `Flowchart` definition including node `objective` strings
(`FlowchartCheckpointState.definition`, `src/run/replay.ts:63–65`;
`src/domain/flowchart.ts:146`), and `pause.json` carries user free text — both
declared sensitive in `record-classes.ts`. In the common case any run holding
episode text in its checkpoint also holds it in its event log and is flagged
anyway, and the remedy (`delete --run`) removes the whole subtree either way —
so this is a completeness/honesty note about the *scan's claim*, not a leak:
the doc comment says copies are "reported", but two sensitive per-run files are
outside the report's read set. Cheapest fix is a sentence in the
`findResidualEpisodeText` contract and in the data dictionary's deletion
section naming the scanned set exactly.

### F9 — LOW (routing the operator): episode delete output does not point at surviving preference evidence

The preference cascade is a documented, well-argued non-goal
(`src/privacy/deletion.ts:468–498`), and `pref list` already displays
`evidenceEpisodeId`, so the affordance exists — but nothing connects them: a
`delete --episode` success says nothing about preference observations that
still name the deleted episode, and `DELETE_USAGE` mentions only the feedback
cascade. One output line ("preferences evidencing this episode are not
cascaded; review with `pref list`, remove with `pref delete --id`") or a
USAGE sentence routes the operator to the existing tools. Pure text.

---

## Suggested Round-2 slot priorities from this report

1. **F1 + F4 together** (delete honesty + lock-wait propagation): small,
   test-pinnable, corrects operator-visible false claims about the privacy
   tooling itself. Touches `main.ts` USAGE/output, `deletion.ts` (one
   parameter), `data-dictionary.md`, plus new unit cases.
2. **F2** (legacy detection for secrets/config/learned state): doctor-overlay
   entries + migrate-legacy sources + USAGE honesty about `auth.json`.
3. **F5** (doctor storage inventory, additive JSON field) — matches the
   tracker's declared "retention diagnostics" focus; strictly advisory.
4. **F6 list half**, then F3/F7/F8/F9 as riders or a combined
   diagnostics slot.

Explicit non-recommendations, restated: no automatic gc, no age/size bounds
(Q3 stays an open policy decision), no auto-migration or auto-deletion of the
legacy `auth.json` secrets without an explicit operator action, and none of the
above closes or claims to close P0 — the P0 closing act remains the independent
reviewer's sign-off, per the review package.
