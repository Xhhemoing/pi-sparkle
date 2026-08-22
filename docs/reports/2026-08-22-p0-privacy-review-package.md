# P0 privacy review package — 2026-08-22

Purpose: make the P0 independent privacy review a single walk-through. This
package does **not** close P0; the closing act is an independent reviewer
signing "no blocker" against the questions in §5.

Inputs under review:

- [data-dictionary.md](../data-dictionary.md) — 17 durable record classes
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

- `delete-files` classes: deletion is by removing the files under the state
  root. **There is no `pi-sparkle delete --run <id>` CLI command yet** —
  deletion today is manual file removal. (Open question Q2.)
- `tombstone-ids` classes (feedback, preference, candidate): deletion is
  recorded as ids; payloads never leave the store again; propagation into
  dataset exports and materialized views is integration-tested
  (`test/integration/m3/redaction.test.ts`).
- `episode` declares `deletionPropagatesTo: ["feedback"]`: episode deletion
  must also tombstone its feedback records. **This propagation is declared
  but not implemented as a single command** (open question Q2).

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

## 5. Questions for the independent reviewer

- **Q1 (ownership):** Are the owner assignments (runtime vs adaptation)
  acceptable, given both planes share one state root?
- **Q2 (deletion tooling):** Is manual file removal acceptable for
  Developer Preview, or must a `delete` CLI (with episode→feedback tombstone
  propagation) exist before P0 sign-off?
- **Q3 (retention horizon):** `until-deleted` classes have no time bound.
  Acceptable for a local single-user runtime?
- **Q4 (migration):** All classes are `migrationVersion: 1`. Acceptable to
  defer a migration plan to v2?
- **Q5 (scope):** The state root is local (`~/.pi-sparkle/`). No network
  transmission of any class is claimed. Confirm no class escapes the machine.

## 6. How to verify independently

```bash
pnpm test -- test/unit/privacy/ test/integration/m3/redaction.test.ts
grep -rn "writeFile\|appendFile" src/ --include="*.ts"   # re-run the completeness audit
```

Sign-off = answering Q1–Q5 with "no blocker" (or listing blockers), recorded
in `tasks/todo.md` and `docs/status-matrix.md` (P0 row → Exit column).

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

P0 remains open until the reviewer re-verifies §6 commands against this
remediation and records the final sign-off.
