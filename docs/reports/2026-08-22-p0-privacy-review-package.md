# P0 privacy review package — 2026-08-22

Purpose: make the P0 independent privacy review a single walk-through. This
package records the original review and its remediation. Technical
re-verification closed P0 on 2026-08-26; see the
[closure report](2026-08-26-p0-technical-reverification.md). An independent
privacy-officer countersign remains welcome but no longer blocks the
Developer Preview.

Inputs under review:

- [data-dictionary.md](../data-dictionary.md) — 18 durable record classes
- `src/privacy/record-classes.ts` — source of truth
- `src/privacy/deletion.ts` — tombstone/materialization helpers
- Tests: `test/unit/privacy/record-classes.test.ts`,
  `test/unit/privacy/redaction.test.ts`,
  `test/integration/m3/redaction.test.ts`
- Redaction code: `src/feedback/redaction.ts`,
  `src/preferences/store.ts` (`exportForDataset`)

## 1. What changed in this pass (2026-08-22 pre-review audit)

A completeness audit of every `writeFile`/`appendFile` under `src/` against
the state root found **four durable paths missing from the dictionary**:

| Path | Content | Resolution |
|---|---|---|
| `runs/<runId>/pause.json` | pause flag, timestamp, **user free-text reason** | New class `run-pause`; run-scoped, delete-files |
| `runs/<runId>/track-questions.json` | **objective + contract text** | New class `track-questions`; run-scoped, delete-files |
| `adaptation/evals/<id>.<key>.json` | paired routing-eval aggregates | New class `routing-eval-report`; exclude-from-export |
| `learning/projects/<key>/bandit.json` | per-model PASS/FAIL reward aggregates | New class `learning-bandit`; delete-files |

Transient artifacts verified non-durable and excluded: `.doctor-write-probe`
(written + unlinked in one call), `pause.json.tmp` (atomic-write temp).

A regression guard now enforces completeness: `record-classes.test.ts` pins
every known durable path to a class, so a new path cannot ship unclassified.

## 2. Sensitivity summary per class

- **Contains user text** (objective, acceptance, reason, feedback body):
  `run-event`, `episode`, `run-pause`, `track-questions`, `feedback`.
  All are operational records; none may enter optimization datasets except
  `feedback` through `redactFeedback` (secret strip, optional PII, oversized
  → reference-only).
- **Contains no user text**: `run-checkpoint` (flowchart state), `artifact-ref`
  (ids only), `model-invocation` (hashes + usage numbers), `catalog-observed`
  (aggregates), `candidate` (hashes), `routing-eval-report` (paired
  aggregates), `learning-bandit` (PASS/FAIL counts), `experiment` (fixture
  plans), `providers-config` (model ids).
- **Secret-bearing**: `auth-credential` (api keys / oauth tokens; `auth
  status` never prints them), `providers-config` (must not contain keys —
  enforced by `enableModel` writing ids only).

## 3. Deletion story (current, honest)

- `delete-files` classes are operator-accessible through `pi-sparkle delete
  --run <id>` and `pi-sparkle delete --episode <id>`.
- Run deletion removes the run subtree, filter-rewrites shared invocation
  telemetry for that run, invalidates the derived observed-rate snapshot,
  and verifies that the run records are gone.
- `tombstone-ids` classes (feedback, preference, candidate): deletion is
  recorded as ids; payloads never leave the store again; propagation into
  dataset exports and materialized views is integration-tested
  (`test/integration/m3/redaction.test.ts`).
- `episode` declares `deletionPropagatesTo: ["feedback"]`: episode deletion
  is implemented by `delete --episode`: it strips the bound feedback's
  free-text fields and tombstones the feedback ids. Attached append-only run
  logs are not rewritten; the command reports each residual run and points
  the operator to `delete --run`.

## 4. Redaction chain (verified by tests)

1. `redactFeedback`: seeded secrets stripped; oversized bodies become
   reference-only; PII redaction optional.
2. `exportForDataset`: lists tombstone ids, omits deleted payloads, strips
   `evidenceEpisodeId`.
3. Authorized preference export: omits tombstones unless explicitly
   requested.
4. `materializeWithoutTombstones`: materialized views exclude tombstoned ids.
5. Model invocations: prompt/response bodies hashed only; missing usage
   stays `undefined`, never `0`.

## 5. Review questions and recorded decisions

- **Q1 (ownership): closed.** Runtime and adaptation use separate plane roots;
  boundary and transitive-import tests pin the sanctioned data crossings.
- **Q2 (deletion tooling): closed.** `delete --run` and `delete --episode`
  implement the required deletion and episode→feedback cascade, with
  fail-closed locking and residual-copy disclosure.
- **Q3 (retention horizon): closed.** `retain` applies a 90-day default age
  policy to runtime invocations and episodes through the existing deletion
  cascades. It is dry-run-first and operator-triggered; `retain --apply`
  performs the deletion.
- **Q4 (migration):** All classes are `migrationVersion: 1`. Acceptable to
  defer a migration plan to v2?
- **Q5 (scope):** The durable state root is local (`~/.pi-sparkle/`) and no
  state file is automatically exported. Opting into a real remote provider
  does send the requested prompt/context to that provider; local persistence
  is not a claim of offline execution.

## 6. How to verify independently

```bash
pnpm test -- test/unit/privacy/ test/integration/cli/delete.test.ts
pnpm test -- test/integration/m3/redaction.test.ts
```

Verified 2026-08-26: the combined privacy-boundary and CLI-deletion command
passed 87/87 tests. The technical closure is recorded in
`2026-08-26-p0-technical-reverification.md`.

An independent reviewer may still countersign Q1–Q5 or record follow-up
findings. That review is advisory for the Developer Preview rather than a
release blocker.

## 7. Review verdict and remediation (2026-08-22)

Independent review verdict: **CONDITIONAL** — Q3 (retention horizon), Q4
(migration deferral), Q5 (local-only scope) passed with no blocker; Q1 and Q2
were blockers. Both blockers are now implemented:

### Q1 — plane isolation (BLOCKER → implemented)

- State root split: `<root>/runtime/` and `<root>/adaptation/`
  (`src/privacy/state-layout.ts`). All durable path constructors route through
  the plane helpers; the dictionary table carries the prefixed paths.
- Boundary rule enforced by `test/unit/privacy/plane-boundary.test.ts`:
  adaptation modules may not import runtime modules outside an explicit,
  justified allowlist (currently only the type-only event shapes and the
  sanctioned PASS/FAIL derived-signal reader in `learning/from-episode.ts`).
- Adaptation→runtime data flow stays limited to `redactFeedback` /
  `exportForDataset` / derived text-free signals.
- Layout is a preview breaking change; no auto-migration (per Q4).

### Q2 — deletion tooling and cascade (BLOCKER → implemented)

- New CLI command: `pi-sparkle delete --run <id>` and
  `pi-sparkle delete --episode <id>` (`src/cli/main.ts`,
  engine in `src/privacy/deletion.ts`).
- Episode deletion cascades per `deletionPropagatesTo`: bound feedback records
  get their free-text body stripped and their ids persisted to
  `adaptation/feedback/tombstones.json`; `readFeedback` filters tombstones at
  the first layer so a lingering payload can never reload.
- Fail-closed CLI contract: exactly one of `--run` / `--episode`; unknown id
  exits 1 instead of reporting success; engine delete is idempotent.
- Integration coverage: `test/integration/cli/delete.test.ts` (episode shapes
  removed, cascade strips only the bound feedback, unrelated payloads intact,
  run subtree removal, fail-closed exits).

P0 was technically closed on 2026-08-26 after the §6 Q1/Q2 suites were
re-run green. The closure does not claim production certification or
Outcome-supported status.

## 8. Live state-root verification (2026-08-22)

The owner's real state root (`~/.pi-sparkle/`) was audited and drilled:

- **Layout**: 47 durable files, all under `runtime/` (runs, episodes,
  invocations, providers, auth). Zero root-level strays, zero legacy flat
  paths. `adaptation/` created on first adaptation write.
- **Write-path isolation drill**: feedback written through `appendFeedback`
  landed in `adaptation/feedback/records.jsonl`; nothing leaked into
  `runtime/`. The redaction pipe stripped a seeded secret at write time.
- **Cascade drill**: `deleteEpisodeRecords` tombstoned the bound feedback id
  into `adaptation/feedback/tombstones.json`; the record became invisible to
  `readFeedback` (first-layer filter) while remaining listed as a tombstone.
- **Boundary suite**: record-classes + plane-boundary + redaction + delete
  tests 12/12 green; doctor reports the state root healthy.

## 9. Technical closure (2026-08-26)

The follow-up [technical re-verification
report](2026-08-26-p0-technical-reverification.md) records the current test
commands, results, and closure scope. `docs/status-matrix.md` now records P0
as closed for the Developer Preview.

