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

## Deletion tooling (Q2 remediation)

`pi-sparkle delete --run <id>` removes the run's whole subtree under
`runtime/runs/<id>/`. `pi-sparkle delete --episode <id>` removes both episode
file shapes **and cascades into the adaptation plane**: every feedback record
bound to that episode has its free-text body stripped and its id persisted to
`adaptation/feedback/tombstones.json`. `readFeedback` filters tombstoned ids
at the first layer, so a lingering payload can never be re-surfaced, and
dataset exports keep listing tombstone ids without payloads. The CLI fails
closed: missing/ambiguous target flags exit 1, an unknown id ("nothing found")
exits 1 rather than reporting success.

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
- `pause.json.tmp` is an atomic-write temp file, renamed or discarded within
  one call — transient.
- `episodes/<id>.lock` is an operational lock beside the episode log; it
  shares the episode class's plane and lifetime.
- `test/**` fixture writes are outside the state root and out of scope.

The completeness guard lives in
`test/unit/privacy/record-classes.test.ts`: any durable path added to `src/`
must be added to `knownPaths` and to a record class together, or the suite
fails.

## Rules

- Raw prompts, response bodies, secrets, and hidden reasoning are excluded from
  optimization datasets. Invocations store hashes and optional usage only.
- Missing provider usage is `undefined`, never `0`.
- Preference dataset export always lists tombstone ids and never the deleted
  payloads (`exportForDataset`).
- Closed 2026-08-21 (M3-T1/M3-T6): cross-stream references and multi-run
  attach fail closed in the episode reducer; tombstone propagation covers
  dataset exports (`exportForDataset`) and authorized exports, and
  materialized views exclude tombstoned ids. See
  `test/integration/m3/redaction.test.ts`.
