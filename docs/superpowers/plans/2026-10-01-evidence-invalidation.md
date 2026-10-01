# C2-evidence-2: reference invalidation for stored evaluation evidence

Task: `TASK-20261001-evidence-invalidation`. Date: 2026-10-01.
Owner: implementation agent; independent review remains a separate open gate.
State: planned, before runtime edits.
Baseline: main `f5db35f4c76e214c1d450606b505ef40eac2ae1c` (PR #50 merged; includes PS-01 + PS-02).

## Problem and Scope

### Problem

`EvaluationRecord`s bind `target` (artifactId/artifactVersion), `rubricId`/`rubricVersion`, and `evaluator` identity at creation, but nothing ever re-checks those bindings later. A stored PASS from an older artifact version, an older rubric, or an older evaluator remains indistinguishable from a current one, and there is no notion of a dependency snapshot at all. [The queue](../../tasks/report-execution-todo.md) defines the remainder: invalidate evidence for relevant artifact/source/verifier changes while **retaining unaffected evidence**.

### In scope

- New library module `src/evaluation/invalidation.ts` (host-independent, deterministic, no I/O):
  - `EvidenceReference`: the current reference set — artifactId/artifactVersion, rubricId/rubricVersion, evaluatorVersion, and a dependency snapshot (`Record<string, string>`, name → version).
  - `assessEvidenceValidity(record, reference)`: per-record verdict `valid | invalidated` with a reason naming the changed reference. Fail-closed: record without a target binding, or without a dependency snapshot covering exactly the current dependency names, is invalidated (`unbound` / `dependency snapshot unverifiable`), never silently valid.
  - `partitionEvidenceValidity(records, reference)`: pure batch helper returning `{ valid, invalidated }` without mutating inputs.
- `createEvaluationRecord` gains an optional `dependencyVersions` input carried onto an additive optional `EvaluationRecord.dependencyVersions` field, so snapshots exist to compare against. No existing field changes meaning; no parser for `EvaluationRecord` exists to drift.
- Unaffected evidence is retained by construction: per-record assessment on exact artifactId equality; another artifact's record is never touched by this artifact's version change.

### Out of scope

- No redefinition of independent PASS/UNOBSERVED; no new runtime event source; no deletion or rewrite of stored records (callers keep bytes; this module only classifies).
- No inference of verifier/content identity from revision strings; identity comparison is exact string equality only.
- No touch to the frozen `HostTerminalOutcome` DTO, event union, `RunStatus`, inspect JSON, native apply, or learning modules.
- Host-dependent wiring (delivery adapter consuming verdicts) waits for B2/S0-min; `evidenceHash` stays an unused declared field (ADR-008: no cryptographic identity).

## Acceptance Criteria

- [ ] Evidence bound to the current artifact/rubric/evaluator/dependency references assesses `valid`; each single reference change (artifact version, artifact id, rubric id, rubric version, evaluator version, any dependency version) assesses `invalidated` with a reason naming the changed reference.
- [ ] A record without a target, and a record whose dependency snapshot does not exactly cover the current dependency names (missing, extra, or value-different), fail closed to `invalidated` — never valid.
- [ ] Unaffected records (bound to a different artifactId) are retained as `foreign` — never `invalidated`, never mixed into `valid` — while the target artifact's stale records invalidate; batch partitioning never mutates inputs.
- [ ] `createEvaluationRecord` carries the optional snapshot; existing construction tests stay green unchanged.
- [ ] Focused evaluation suites, typecheck, lint, full `pnpm gate` green; no existing test weakened.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `test/unit/evaluation/evidence-invalidation.test.ts` (new) | RED: validity, per-reference invalidation, fail-closed unbound/unverifiable, retention/partition, snapshot carrying | implementation agent | none; RED on current code (module absent) |
| `src/evaluation/invalidation.ts` (new) | `EvidenceReference`, `assessEvidenceValidity`, `partitionEvidenceValidity` | implementation agent | pure library; no callers yet |
| `src/evaluation/types.ts`, `src/evaluation/evaluator.ts` | Additive optional `dependencyVersions` on `EvaluationRecord` + `EvaluationInput` passthrough | implementation agent | optional-field additive; low risk |
| `docs/reports/2026-10-01-evidence-invalidation.md`, status-matrix row, checklist | Evidence and closeout | implementation agent | after GREEN |

## Test-First Plan

- Red test: `test/unit/evaluation/evidence-invalidation.test.ts` — expected RED on current code (module missing; snapshot field missing).
- Focused command: `node scripts/run-tests.mjs test/unit/evaluation`
- Integration/acceptance command: adjacent evaluation/adaptation/experiments suites, then `pnpm gate`.
- Negative and recovery cases: unbound record, dependency snapshot missing/extra/different, foreign artifact retention, input immutability.

## Gates and Handoff

- Human/policy gate: none closed; independent review open; host wiring explicitly deferred to B2.
- Rollback or abort condition: a frozen-schema dependency discovered mid-slice, or unexpected regression outside the new module — stop and reconcile.
- Required durable records: this plan, RED commit, GREEN commit, dated evidence report, status-matrix/checklist rows.
- Next command after handoff: `pnpm gate`, evidence commit, then reassess queue (independent acceptance dispatches remain blocked/unclaimed).

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending.
- Open risks/follow-ups: verdicts are advisory until a host-dependent consumer is authorized; dependency-name vocabulary is caller-defined in this slice.
- Evidence links: filled at closeout.
