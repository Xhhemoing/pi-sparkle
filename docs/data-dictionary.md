# Durable record dictionary

Source of truth: `src/privacy/record-classes.ts` (`DURABLE_RECORD_CLASSES`).
Tests: `test/unit/privacy/record-classes.test.ts`.

This dictionary is a Developer Preview control. It does **not** close P0 privacy
review. Independent review must still confirm owner, retention, redaction,
deletion, and migration for every class before any production claim.

| id | owner | path | retention | deletion | migration |
|---|---|---|---|---|---|
| run-event | runtime | `runs/<runId>/events.jsonl` | run-scoped | delete-files | 1 |
| run-checkpoint | runtime | `runs/<runId>/checkpoint.json` | run-scoped | delete-files | 1 |
| episode | runtime | `episodes/<episodeId>/events.jsonl` | episode-scoped | delete-files | 1 |
| artifact-ref | runtime | TASK_RESULT ids only | run-scoped | exclude-from-export | 1 |
| feedback | adaptation | `feedback/records.jsonl` | until-deleted | tombstone-ids | 1 |
| preference | adaptation | `preferences.json` | until-deleted | tombstone-ids | 1 |
| preference-dataset | adaptation | derived export | until-deleted | exclude-from-export | 1 |
| model-invocation | runtime | `invocations.jsonl` | run-scoped | delete-files | 1 |
| catalog-observed | runtime | `routing/catalog-observed.json` | until-deleted | delete-files | 1 |
| candidate | adaptation | `adaptation/registry.json` | until-rollback | tombstone-ids | 1 |
| experiment | adaptation | in-memory / fixture plans | until-deleted | exclude-from-export | 1 |
| providers-config | runtime | `providers.json` | until-deleted | delete-files | 1 |
| auth-credential | runtime | `auth.json` | until-deleted | delete-files | 1 |

Rules:

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
